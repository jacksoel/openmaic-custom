import { NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser, isInstructorOrAbove } from '@/lib/auth';
import { listClassroomsForUser } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Catalog API');

/**
 * GET /api/classroom/catalog
 * Returns classrooms available for enrollment.
 * - Students: public classrooms they haven't joined
 * - Instructors/admins: public classrooms + their own enrolled-visibility classrooms
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
    const isInstructorPlus = isInstructorOrAbove(user);

    const classrooms = allClassrooms
      .filter(c => {
        // Always show public classrooms
        if (c.visibility === 'public') return true;
        // Instructors/admins can also see their own enrolled-visibility classrooms
        if (isInstructorPlus && c.visibility === 'enrolled' && c.ownerId === userId) return true;
        return false;
      })
      .map(c => {
        const alreadyEnrolled = Boolean(
          (userId && c.enrolledUserIds?.includes(userId)) || c.ownerId === userId
        );
        return {
          id: c.id,
          name: c.stage?.name || c.id,
          instructor: c.ownerName || c.ownerId || 'Unknown',
          visibility: c.visibility || 'public',
          enrolledCount: c.enrolledUserIds?.length || 0,
          alreadyEnrolled,
        };
      });

    return apiSuccess({ classrooms });
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
