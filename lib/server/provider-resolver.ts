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
  serverConfig: ServerProviderConfig
): ResolvedProvider | null {
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
          defaultModel: row.defaultModel || undefined,
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
      defaultModel: serverProvider.defaultModel || undefined,
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