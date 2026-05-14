/**
 * Stateless Chat API Endpoint
 *
 * POST /api/chat - Send message, receive SSE stream
 *
 * When AUTH_ENABLED=true:
 *   - If user has a provider configured in user_providers, it overrides any
 *     client-sent API key for that provider.
 *   - If no user provider, falls back to institutional (server-providers.yml/env).
 *   - Students can only use institutional providers (unless INSTITUTIONAL_KEY_ROLES restricts further).
 */

import { NextRequest } from 'next/server';
import { statelessGenerate } from '@/lib/orchestration/stateless-generate';
import { isProviderKeyRequired, parseModelString } from '@/lib/ai/providers';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import { apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModel } from '@/lib/server/resolve-model';
import { resolveProvider, canUseProvider, checkQuota } from '@/lib/server/provider-resolver';
import type { ThinkingConfig } from '@/lib/types/provider';
import { getSessionUser, isInstructorOrAbove } from '@/lib/auth';
import { getConfig } from '@/lib/server/provider-config';
import { logUsageDeferred } from '@/lib/server/usage-logger';

const log = createLogger('Chat API');

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

/**
 * POST /api/chat
 * Send a message and receive SSE stream of generation events
 */
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  let chatModel: string | undefined;
  let chatMessageCount: number | undefined;

  try {
    const body: StatelessChatRequest = await req.json();
    chatModel = body.model;
    chatMessageCount = body.messages?.length;

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
    }

    if (!body.storeState) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: storeState');
    }

    if (!body.config || !body.config.agentIds || body.config.agentIds.length === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: config.agentIds');
    }

    // -----------------------------------------------------------------------
    // Auth-aware provider resolution
    // -----------------------------------------------------------------------
    const authEnabled = process.env.AUTH_ENABLED === 'true';
    const user = await getSessionUser(req);

    let effectiveApiKey = body.apiKey;
    let effectiveBaseUrl = body.baseUrl;
    let effectiveModel = body.model;

    if (authEnabled && user) {
      // Parse the model string to determine the provider
      const { providerId } = parseModelString(body.model || '');

      // Get full server config (with apiKeys) for provider resolution
      const serverConfig = getConfig();

      // Try user's own provider first, then institutional default
      const resolved = resolveProvider(user.id, providerId, serverConfig);

      if (resolved) {
        // Check role permissions
        if (!canUseProvider(user.role, resolved.source)) {
          const msg = resolved.source === 'institutional'
            ? `Your role does not have access to institutional AI providers. Contact your administrator.`
            : `Only instructors and admins can use personal AI provider keys.`;
          return apiError('INVALID_REQUEST', 403, msg);
        }

        // Override with resolved provider
        effectiveApiKey = resolved.apiKey;
        if (resolved.baseUrl) effectiveBaseUrl = resolved.baseUrl;
        if (resolved.defaultModel && !body.model) {
          effectiveModel = resolved.defaultModel;
        }

        log.info(`Using ${resolved.source} provider for user ${user.id}: ${providerId}`);

        // Quota enforcement
        const quotaResult = checkQuota(user.id, providerId, 0);
        if (!quotaResult.allowed) {
          return apiError(API_ERROR_CODES.INVALID_REQUEST, 429,
            `Daily token quota exceeded for ${providerId}. Used: ${quotaResult.used}/${quotaResult.limit}. Resets tomorrow.`);
        }
      } else if (!effectiveApiKey) {
        // No provider available
        return apiError('MISSING_API_KEY', 401,
          `No API key configured for ${providerId}. ` +
          (isInstructorOrAbove(user)
            ? 'Configure your API key in Settings > My AI Stack.'
            : 'Contact your instructor to configure institutional AI providers.'));
      }
    }

    const {
      model: languageModel,
      apiKey: resolvedApiKey,
      providerId,
    } = await resolveModel({
      modelString: effectiveModel,
      apiKey: effectiveApiKey,
      baseUrl: effectiveBaseUrl,
      providerType: body.providerType,
    });

    if (isProviderKeyRequired(providerId) && !resolvedApiKey) {
      return apiError('MISSING_API_KEY', 401, 'API Key is required');
    }

    log.info('Processing request');
    log.info(
      `Agents: ${body.config.agentIds.join(', ')}, Messages: ${body.messages.length}, Turn: ${body.directorState?.turnCount ?? 0}`,
    );

    // Use the native request signal for abort propagation
    const signal = req.signal;

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Stream generation in background with heartbeat to prevent connection timeout
    const HEARTBEAT_INTERVAL_MS = 15_000;
    (async () => {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const startHeartbeat = () => {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          try {
            writer.write(encoder.encode(`:heartbeat\n\n`)).catch(() => stopHeartbeat());
          } catch {
            stopHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      try {
        startHeartbeat();

        const thinkingConfig: ThinkingConfig = body.thinkingConfig ??
          body.thinking ?? { mode: 'disabled', enabled: false };

        const generator = statelessGenerate(
          {
            ...body,
            apiKey: resolvedApiKey,
          },
          signal,
          languageModel,
          thinkingConfig,
        );

        for await (const event of generator) {
          if (signal.aborted) {
            log.info('Request was aborted');
            break;
          }

          const data = `data: ${JSON.stringify(event)}\n\n`;
          await writer.write(encoder.encode(data));
        }

        // Phase 4.2: Log LLM usage after stream completes
        if (authEnabled && user && providerId) {
          try {
            logUsageDeferred({
              userId: user.id,
              providerSlug: providerId,
              model: body.model || 'unknown',
              inputTokens: 0, // Enhanced in Phase 4.5 with actual token counts
              outputTokens: 0,
            });
          } catch { /* best-effort */ }
        }

        stopHeartbeat();
        await writer.close();
      } catch (error) {
        stopHeartbeat();

        if (signal.aborted) {
          log.info('Request aborted during streaming');
          try {
            await writer.close();
          } catch {
            /* already closed */
          }
          return;
        }

        log.error(
          `Chat stream error [model=${body.model ?? 'unknown'}, agents=${body.config?.agentIds?.length ?? 0}, messages=${body.messages?.length ?? 0}]:`,
          error,
        );

        try {
          const errorEvent: StatelessEvent = {
            type: 'error',
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          await writer.close();
        } catch {
          // Writer may already be closed
        }
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error(
      `Chat request failed [model=${chatModel ?? 'unknown'}, messages=${chatMessageCount ?? 0}]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to process request',
    );
  }
}
