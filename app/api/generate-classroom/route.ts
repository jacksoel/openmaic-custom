import { after, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import { runClassroomGenerationJob } from '@/lib/server/classroom-job-runner';
import { createClassroomGenerationJob } from '@/lib/server/classroom-job-store';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { getSessionUser, isInstructorOrAbove } from '@/lib/auth';
import { resolveProvider, canUseProvider, checkQuota } from '@/lib/server/provider-resolver';
import { getConfig } from '@/lib/server/provider-config';
import { parseModelString } from '@/lib/ai/providers';
import { logUsageDeferred } from '@/lib/server/usage-logger';

const log = createLogger('GenerateClassroom API');

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let requirementSnippet: string | undefined;
  try {
    const rawBody = (await req.json()) as Partial<GenerateClassroomInput>;
    requirementSnippet = rawBody.requirement?.substring(0, 60);

    // -----------------------------------------------------------------
    // Auth-aware provider resolution
    // -----------------------------------------------------------------
    const authEnabled = process.env.AUTH_ENABLED === 'true';
    const user = await getSessionUser(req);

    if (authEnabled && !user) {
      return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
    }
    if (authEnabled && user && !isInstructorOrAbove(user)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Only instructors and admins can generate classrooms');
    }

    let effectiveApiKey = rawBody.apiKey as string | undefined;
    let effectiveBaseUrl = rawBody.baseUrl as string | undefined;
    let effectiveModel = rawBody.model as string | undefined;

    if (authEnabled && user) {
      const { providerId } = parseModelString(effectiveModel || '');

      // Get full server config (with apiKeys) for provider resolution
      const serverConfig = getConfig();
      const resolved = resolveProvider(user.id, providerId, serverConfig);

      if (resolved) {
        if (!canUseProvider(user.role, resolved.source)) {
          return apiError(API_ERROR_CODES.INVALID_REQUEST, 403,
            'Students can only use institutional AI providers. Contact your instructor for access.');
        }
        effectiveApiKey = resolved.apiKey;
        if (resolved.baseUrl) effectiveBaseUrl = resolved.baseUrl;
        if (resolved.defaultModel && !effectiveModel) {
          effectiveModel = resolved.defaultModel;
        }
        log.info(`Using ${resolved.source} provider for user ${user.id}: ${providerId}`);

        // Quota enforcement
        const quotaResult = checkQuota(user.id, providerId, 0);
        if (!quotaResult.allowed) {
          return apiError(API_ERROR_CODES.INVALID_REQUEST, 429,
            `Daily token quota exceeded for ${providerId}. Used: ${quotaResult.used}/${quotaResult.limit}. Resets tomorrow.`);
        }
      }
    }

    const body: GenerateClassroomInput = {
      requirement: rawBody.requirement || '',
      ...(rawBody.pdfContent ? { pdfContent: rawBody.pdfContent } : {}),
      ...(rawBody.enableWebSearch != null ? { enableWebSearch: rawBody.enableWebSearch } : {}),
      ...(rawBody.webSearchProviderId ? { webSearchProviderId: rawBody.webSearchProviderId } : {}),
      ...(rawBody.webSearchApiKey ? { webSearchApiKey: rawBody.webSearchApiKey } : {}),
      ...(rawBody.baiduSubSources ? { baiduSubSources: rawBody.baiduSubSources } : {}),
      ...(rawBody.enableImageGeneration != null
        ? { enableImageGeneration: rawBody.enableImageGeneration }
        : {}),
      ...(rawBody.enableVideoGeneration != null
        ? { enableVideoGeneration: rawBody.enableVideoGeneration }
        : {}),
      ...(rawBody.enableTTS != null ? { enableTTS: rawBody.enableTTS } : {}),
      ...(rawBody.agentMode ? { agentMode: rawBody.agentMode } : {}),
      ...(effectiveApiKey ? { apiKey: effectiveApiKey } : {}),
      ...(effectiveBaseUrl ? { baseUrl: effectiveBaseUrl } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
    };

    const { requirement } = body;
    if (!requirement) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing required field: requirement');
    }

    const baseUrl = buildRequestOrigin(req);
    const jobId = nanoid(10);
    const job = await createClassroomGenerationJob(jobId, body);
    const pollUrl = `${baseUrl}/api/generate-classroom/${jobId}`;

    after(() => {
      // Phase 4.2: Log classroom generation usage
      if (authEnabled && user && effectiveModel) {
        try {
          logUsageDeferred({
            userId: user.id,
            providerSlug: parseModelString(effectiveModel).providerId || 'unknown',
            model: effectiveModel,
            inputTokens: 0,
            outputTokens: 0,
          });
        } catch { /* best-effort */ }
      }
      return runClassroomGenerationJob(jobId, body, baseUrl);
    });

    return apiSuccess(
      {
        jobId,
        status: job.status,
        step: job.step,
        message: job.message,
        pollUrl,
        pollIntervalMs: 5000,
      },
      202,
    );
  } catch (error) {
    log.error(
      `Classroom generation job creation failed [requirement="${requirementSnippet ?? 'unknown'}..."]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to create classroom generation job',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
