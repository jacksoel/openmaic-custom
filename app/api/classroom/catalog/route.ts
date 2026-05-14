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
 *   classrooms        — public classrooms available for enrollment
 *   pendingClassrooms — student-submitted classrooms awaiting review
 *                       (returned only to admin and instructor roles)
 *
 * Visibility rules in the catalog:
 *   Students           — see only public classrooms
 *   Instructors/Admins — see public classrooms + pending review queue
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

    // Public classrooms — available to all authenticated users
    const classrooms = allClassrooms
      .filter(c => c.visibility === 'public')
      .map(c => ({
        id: c.id,
        name: c.stage?.name || c.id,
        instructor: c.ownerName || c.ownerId || 'Unknown',
        visibility: 'public' as const,
        enrolledCount: c.enrolledUserIds?.length || 0,
        alreadyEnrolled: Boolean(userId && (c.enrolledUserIds?.includes(userId) || c.ownerId === userId)),
      }));

    // Pending review queue — only for instructors and admins
    const pendingClassrooms = isReviewer
      ? allClassrooms
          .filter(c => c.visibility === 'pending')
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
