/**
 * /api/whoami — Debug route that echoes identity info.
 *
 * Resolves identity in two ways:
 * 1. Primary: getSessionUser() reads better-auth OR SSO cookie; returns a
 *    user shape with sessionType ∈ {"native","sso"} so the caller can tell
 *    which path produced the identity.
 * 2. Fallback: reads x-maic-* headers (set by an upstream SSO proxy that
 *    speaks the header convention instead of the JWT-cookie convention).
 *
 * This route is in PUBLIC_PATHS so it can be called without authentication
 * for debugging. Reports { authenticated: false } when nothing matches.
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
      course: request.headers.get('x-maic-course') ?? null,
      tenant: request.headers.get('x-maic-tenant') ?? sessionUser.institution ?? null,
    });
  }

  // Fallback: read x-maic-* headers (set by upstream SSO proxy)
  const headerUser   = request.headers.get('x-maic-user')   ?? null;
  const headerRoles  = request.headers.get('x-maic-roles')  ?? null;
  const headerCourse = request.headers.get('x-maic-course') ?? null;
  const headerTenant = request.headers.get('x-maic-tenant') ?? null;

  if (headerUser) {
    const rolesList = headerRoles
      ? headerRoles.split(',').map(r => r.trim()).filter(Boolean)
      : ['user'];

    return apiSuccess({
      authenticated: true,
      source: 'proxy-headers',
      sessionType: null,
      user: headerUser,
      name: null,
      roles: rolesList,
      groups: null,
      course: headerCourse,
      tenant: headerTenant,
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
