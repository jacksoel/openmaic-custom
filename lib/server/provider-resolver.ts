/**
 * Provider Resolver — resolves AI provider config for a given user and provider slug.
 *
 * Resolution order:
 * 1. User's own provider config (from user_providers table, decrypted)
 * 2. Institutional/server default (from server-providers.yml or env vars)
 * 3. Error — no key available
 *
 * This module is called from API routes before invoking callLLM/streamLLM.
 * It never sends API keys to the frontend.
 */

import { getDb } from './auth-db';
import { encryptApiKey, decryptApiKey } from './encryption';

interface ResolvedProvider {
  /** Provider slug (e.g., 'openai', 'google', 'deepseek') */
  providerSlug: string;
  /** Decrypted API key */
  apiKey: string;
  /** Base URL override (optional, for self-hosted providers like Ollama) */
  baseUrl?: string;
  /** Default model for this provider */
  defaultModel?: string;
  /** Whether this is the user's own key or institutional */
  source: 'user' | 'institutional';
  /** Token limits (if configured) */
  limits?: {
    maxTokensPerDay?: number;
    maxTokensPerRequest?: number;
  };
}

interface ServerProviderConfig {
  providers: Record<string, {
    apiKey?: string;
    baseUrl?: string;
    models?: string[];
    defaultModel?: string;
  }>;
}

/**
 * Resolve provider config for a user.
 *
 * @param userId - The authenticated user's ID (null if no auth)
 * @param providerSlug - Which provider to resolve (e.g., 'openai')
 * @param serverConfig - The parsed server-providers.yml config
 * @returns Resolved provider config, or null if no key is available
 */
export function resolveProvider(
  userId: string | null | undefined,
  providerSlug: string,
  serverConfig: ServerProviderConfig,
  classroomProviderConfig?: { providerSlug: string; defaultModel?: string }
): ResolvedProvider | null {
  // Per-classroom provider override takes precedence over user's default provider slug
  if (classroomProviderConfig) {
    providerSlug = classroomProviderConfig.providerSlug;
  }

  // 1. Check user's own provider config (if authenticated)
  if (userId) {
    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT encryptedApiKey, defaultModel, limits FROM user_providers WHERE userId = ? AND providerSlug = ?'
      ).get(userId, providerSlug) as any;

      if (row) {
        const apiKey = decryptApiKey(row.encryptedApiKey);
        return {
          providerSlug,
          apiKey,
          defaultModel: row.defaultModel || classroomProviderConfig?.defaultModel || undefined,
          source: 'user',
          limits: row.limits ? JSON.parse(row.limits) : undefined,
        };
      }
    } catch (error) {
      // If auth DB lookup fails, fall through to institutional default
      console.error('[ProviderResolver] Failed to look up user provider:', error);
    }
  }

  // 2. Fall back to institutional/server default
  const serverProvider = serverConfig.providers?.[providerSlug];
  if (serverProvider?.apiKey) {
    return {
      providerSlug,
      apiKey: serverProvider.apiKey,
      baseUrl: serverProvider.baseUrl || undefined,
      defaultModel: serverProvider.defaultModel || classroomProviderConfig?.defaultModel || undefined,
      source: 'institutional',
    };
  }

  // 3. No key available
  return null;
}

/**
 * Check if a user can use a given provider.
 * Students can only use institutional providers; instructors/admins can use their own.
 */
export function canUseProvider(
  userRole: string | null | undefined,
  providerSource: 'user' | 'institutional'
): boolean {
  // Institutional providers are available to all authenticated users
  if (providerSource === 'institutional') return true;

  // Own providers: only instructors and above (Phase 1: conservative)
  if (userRole === 'admin' || userRole === 'instructor') return true;

  return false;
}
export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number | null;
  resetAt?: string;
}

/**
 * Check daily token quota for a user+provider combination.
 *
 * @param userId - The authenticated user's ID
 * @param providerSlug - Which provider to check (e.g., 'openai')
 * @param requestedTokens - Tokens about to be consumed (0 for pre-call check)
 * @returns QuotaResult with allowed flag, current usage, and limit info
 */
export function checkQuota(
  userId: string,
  providerSlug: string,
  requestedTokens: number
): QuotaResult {
  try {
    const db = getDb();

    // Look up limits for this user+provider
    const row = db.prepare(
      'SELECT limits FROM user_providers WHERE userId = ? AND providerSlug = ?'
    ).get(userId, providerSlug) as { limits: string | null } | undefined;

    // No provider row — no limits configured
    if (!row) {
      return { allowed: true, used: 0, limit: null };
    }

    const limits: { maxTokensPerDay?: number; maxTokensPerRequest?: number } =
      row.limits ? JSON.parse(row.limits) : {};

    // If no maxTokensPerDay, nothing to enforce
    if (!limits.maxTokensPerDay) {
      return { allowed: true, used: 0, limit: null };
    }

    const maxTokensPerDay = limits.maxTokensPerDay;

    // Sum today's usage (inputTokens + outputTokens)
    const usageRow = db.prepare(
      `SELECT COALESCE(SUM(inputTokens + outputTokens), 0) AS total
       FROM usage_logs
       WHERE userId = ? AND providerSlug = ? AND createdAt >= date('now')`
    ).get(userId, providerSlug) as { total: number };

    const dailyUsed = usageRow?.total ?? 0;

    if (dailyUsed + requestedTokens > maxTokensPerDay) {
      return {
        allowed: false,
        used: dailyUsed,
        limit: maxTokensPerDay,
        resetAt: 'tomorrow midnight UTC',
      };
    }

    return { allowed: true, used: dailyUsed, limit: maxTokensPerDay };
  } catch (error) {
    console.error('[ProviderResolver] checkQuota error:', error);
    // Fail open — don't block requests if quota check fails
    return { allowed: true, used: 0, limit: null };
  }
}

/**
 * Check per-request token quota against limits.maxTokensPerRequest.
 *
 * @param userId - The authenticated user's ID
 * @param providerSlug - Which provider to check
 * @param requestedTokens - Tokens requested for this single call
 * @returns QuotaResult with allowed flag and limit info
 */
export function checkRequestQuota(
  userId: string,
  providerSlug: string,
  requestedTokens: number
): QuotaResult {
  try {
    const db = getDb();

    const row = db.prepare(
      'SELECT limits FROM user_providers WHERE userId = ? AND providerSlug = ?'
    ).get(userId, providerSlug) as { limits: string | null } | undefined;

    if (!row) {
      return { allowed: true, used: 0, limit: null };
    }

    const limits: { maxTokensPerDay?: number; maxTokensPerRequest?: number } =
      row.limits ? JSON.parse(row.limits) : {};

    if (!limits.maxTokensPerRequest) {
      return { allowed: true, used: 0, limit: null };
    }

    const maxTokensPerRequest = limits.maxTokensPerRequest;

    if (requestedTokens > maxTokensPerRequest) {
      return {
        allowed: false,
        used: requestedTokens,
        limit: maxTokensPerRequest,
      };
    }

    return { allowed: true, used: requestedTokens, limit: maxTokensPerRequest };
  } catch (error) {
    console.error('[ProviderResolver] checkRequestQuota error:', error);
    return { allowed: true, used: 0, limit: null };
  }
}
