import { NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser, isInstructorOrAbove } from '@/lib/auth';
import { listClassroomsForUser } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Catalog API');

/**
 * GET /api/classroom/catalog
 *
 * Returns two lists:
 *   classrooms        — public, non-archived classrooms available for enrollment
 *   pendingClassrooms — student-submitted classrooms awaiting review (instructor/admin only)
 *
 * Archived classrooms are excluded from both lists.
 */
export async function GET(req: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED !== 'false';
  const user = await getSessionUser(req);

  if (authEnabled && !user) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  }

  try {
    const allClassrooms = await listClassroomsForUser(user?.id || null, user?.role || null);
    const userId = user?.id;
    const isReviewer = isInstructorOrAbove(user);

    const classrooms = allClassrooms
      .filter(c => c.visibility === 'public' && c.lifecycleState !== 'archived')
      .map(c => ({
        id: c.id,
        name: c.stage?.name || c.id,
        instructor: c.ownerName || c.ownerId || 'Unknown',
        visibility: 'public' as const,
        lifecycleState: c.lifecycleState ?? 'active',
        sunsettingAt: c.sunsettingAt ?? null,
        sunsettingMessage: c.sunsettingMessage ?? null,
        successorId: c.successorId ?? null,
        enrolledCount: c.enrolledUserIds?.length || 0,
        alreadyEnrolled: Boolean(userId && (c.enrolledUserIds?.includes(userId) || c.ownerId === userId)),
      }));

    const pendingClassrooms = isReviewer
      ? allClassrooms
          .filter(c => c.visibility === 'pending' && c.lifecycleState !== 'archived')
          .map(c => ({
            id: c.id,
            name: c.stage?.name || c.id,
            submittedBy: c.ownerName || c.ownerId || 'Unknown',
            ownerRole: c.ownerRole || 'student',
            enrolledCount: c.enrolledUserIds?.length || 0,
            pendingSince: c.pendingSince || c.createdAt,
          }))
          .sort((a, b) => new Date(a.pendingSince).getTime() - new Date(b.pendingSince).getTime())
      : [];

    return apiSuccess({ classrooms, pendingClassrooms });
  } catch (error) {
    log.error('Failed to fetch catalog:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to fetch catalog',
      error instanceof Error ? error.message : String(error),
    );
  }
}
