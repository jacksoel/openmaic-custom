/**
 * /api/whoami — Debug route that echoes identity info.
 *
 * Resolves identity via getSessionUser(), which reads either:
 *   - native: better-auth session cookie
 *   - sso:    openmaic_session JWT cookie (from /api/access-code/sso)
 *
 * This route is in PUBLIC_PATHS so it can be called without authentication
 * for debugging. Reports { authenticated: false } when nothing matches.
 *
 * SECURITY: This route does NOT read x-maic-* headers. Identity is
 * authoritative only from a validated session cookie, never from headers
 * that could be spoofed by external clients.
 */

import { NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { apiSuccess } from '@/lib/server/api-response';

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser(request);

  if (sessionUser) {
    return apiSuccess({
      authenticated: true,
      source: 'session',
      sessionType: sessionUser.sessionType,
      user: sessionUser.email ?? sessionUser.id,
      name: sessionUser.name ?? null,
      roles: sessionUser.role ? [sessionUser.role] : ['user'],
      groups: sessionUser.ssoGroups ?? null,
      course: null,
      tenant: sessionUser.institution ?? null,
    });
  }

  return apiSuccess({
    authenticated: false,
    source: null,
    sessionType: null,
    user: null,
    name: null,
    roles: null,
    groups: null,
    course: null,
    tenant: null,
  });
}