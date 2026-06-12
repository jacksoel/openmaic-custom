import { NextRequest } from 'next/server';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { LAUNCH_AUDIENCE, LAUNCH_ISSUER } from '@/lib/sso/claims';
import { groupsToRoles, resolvePrimaryRole } from '@/lib/sso/groups';
import { verifyHs256Jwt } from '@/lib/sso/jwt';
import { listClassroomsForUser } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Launch List API');

/**
 * GET /api/classroom/launch-list
 *
 * Space-agent launch catalog. Authenticated with a Bearer launch JWT
 * (iss=space-agent, aud=openmaic, HS256 with MAIC_LAUNCH_SECRET) instead of a
 * session cookie — the caller is a server, not a browser. The path is listed
 * in middleware PUBLIC_PATHS; full token verification happens here.
 *
 * Returns public, non-archived classrooms the launch user can open. The
 * space-agent wraps each id into an /api/access-code/sso launch URL.
 */
export async function GET(req: NextRequest) {
  const launchSecret = process.env.MAIC_LAUNCH_SECRET;
  if (!launchSecret) {
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      503,
      'SSO not configured (MAIC_LAUNCH_SECRET missing)',
    );
  }

  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!bearerToken) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Missing Bearer launch token');
  }

  const verified = verifyHs256Jwt(bearerToken, launchSecret);
  if (!verified.ok) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, `Invalid launch token: ${verified.reason}`);
  }

  const payload = verified.payload;
  if (payload.iss !== LAUNCH_ISSUER || payload.aud !== LAUNCH_AUDIENCE) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Invalid launch token issuer or audience');
  }

  const space =
    payload.space && typeof payload.space === 'object'
      ? (payload.space as Record<string, unknown>)
      : {};
  const groups = Array.isArray(space.groups) ? space.groups.map(String) : [];
  const roles = groupsToRoles(groups);
  const primaryRole = resolvePrimaryRole(roles);

  try {
    const allClassrooms = await listClassroomsForUser(null, primaryRole);
    const classrooms = allClassrooms
      .filter(c => c.visibility === 'public' && c.lifecycleState !== 'archived')
      .map(c => ({
        id: c.id,
        name: c.stage?.name || c.id,
        instructor: c.ownerName || c.ownerId || 'Unknown',
        visibility: 'public' as const,
        isOwner: false,
      }));

    return apiSuccess({ classrooms });
  } catch (error) {
    log.error('Failed to build launch list:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to build launch list',
      error instanceof Error ? error.message : String(error),
    );
  }
}
