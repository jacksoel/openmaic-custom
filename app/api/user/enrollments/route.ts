import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser } from '@/lib/auth';
import { listClassroomsForUser } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('User Enrollments');

/**
 * GET /api/user/enrollments
 * Returns classrooms the current user is enrolled in or owns.
 * Includes lifecycle fields so the dashboard can render sunsetting notices
 * and a separate "Past Classrooms" section for archived classrooms.
 */
export async function GET(request: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const user = await getSessionUser(request);

  if (authEnabled && !user) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  }

  try {
    if (authEnabled && user) {
      const allClassrooms = await listClassroomsForUser(user.id, user.role);
      const enrolled = allClassrooms.filter(c =>
        c.enrolledUserIds?.includes(user.id) || c.ownerId === user.id
      );
      return apiSuccess({
        classrooms: enrolled.map(c => ({
          id: c.id,
          name: c.stage?.name || c.id,
          instructor: c.ownerName || c.ownerId || 'Unknown',
          visibility: c.visibility || 'enrolled',
          createdAt: c.createdAt,
          isOwner: c.ownerId === user.id,
          pendingSince: c.pendingSince ?? null,
          lifecycleState: c.lifecycleState ?? 'active',
          sunsettingAt: c.sunsettingAt ?? null,
          sunsettingMessage: c.sunsettingMessage ?? null,
          successorId: c.successorId ?? null,
        })),
      });
    }

    const allClassrooms = await listClassroomsForUser(null, null);
    return apiSuccess({
      classrooms: allClassrooms.map(c => ({
        id: c.id,
        name: c.stage?.name || c.id,
        instructor: c.ownerName || c.ownerId || 'Unknown',
        visibility: c.visibility || 'enrolled',
        createdAt: c.createdAt,
        isOwner: false,
        pendingSince: null,
        lifecycleState: 'active',
        sunsettingAt: null,
        sunsettingMessage: null,
        successorId: null,
      })),
    });
  } catch (error) {
    log.error('Failed to fetch enrollments:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to fetch enrollments',
      error instanceof Error ? error.message : String(error),
    );
  }
}
