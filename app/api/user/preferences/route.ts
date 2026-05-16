import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/server/auth-db';

export type UserPreferences = {
  theme?: 'light' | 'dark' | 'system';
  dashboardArchivedExpanded?: boolean;
  adminVisFilter?: string;
  adminLcFilter?: string;
};

const ALLOWED_KEYS: Set<keyof UserPreferences> = new Set([
  'theme',
  'dashboardArchivedExpanded',
  'adminVisFilter',
  'adminLcFilter',
]);

function readPrefs(userId: string): UserPreferences {
  const db = getDb();
  const row = db
    .prepare('SELECT preferences FROM "user" WHERE id = ?')
    .get(userId) as { preferences: string | null } | undefined;
  if (!row?.preferences) return {};
  try { return JSON.parse(row.preferences) as UserPreferences; } catch { return {}; }
}

function writePrefs(userId: string, prefs: UserPreferences): void {
  getDb()
    .prepare('UPDATE "user" SET preferences = ? WHERE id = ?')
    .run(JSON.stringify(prefs), userId);
}

/**
 * GET /api/user/preferences
 * Returns the current user's persisted preferences.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  return apiSuccess({ preferences: readPrefs(user.id) });
}

/**
 * PATCH /api/user/preferences
 * Deep-merges a partial preferences object into the stored record.
 * Only recognised keys are accepted; unknown keys are silently dropped.
 */
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid JSON body');
  }

  // Only persist known keys
  const patch: Partial<UserPreferences> = {};
  for (const key of ALLOWED_KEYS) {
    if (key in body) (patch as Record<string, unknown>)[key] = body[key];
  }

  const merged: UserPreferences = { ...readPrefs(user.id), ...patch };
  writePrefs(user.id, merged);
  return apiSuccess({ preferences: merged });
}
