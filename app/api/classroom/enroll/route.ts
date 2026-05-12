import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { readClassroom, enrollUserInClassroom, canEditClassroom } from '@/lib/server/classroom-storage';
import { getSessionUser, isInstructorOrAbove } from '@/lib/auth';
import { isValidClassroomId } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Enroll API');

/**
 * POST /api/classroom/enroll — Enroll a student in a classroom
 * Body: { classroomId: string, userId?: string }
 * - Instructors/admins can enroll anyone by specifying userId
 * - Students can enroll themselves (no userId = self-enroll)
 */
export async function POST(request: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const user = await getSessionUser(request);

  if (authEnabled && !user) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  }

  try {
    const body = await request.json();
    const { classroomId } = body;

    if (!classroomId || !isValidClassroomId(classroomId)) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Valid classroomId is required');
    }

    const classroom = await readClassroom(classroomId);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    // Self-enrollment: use the authenticated user's ID
    const targetUserId = body.userId || user?.id;

    if (!targetUserId) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'userId is required');
    }

    // If enrolling someone else, must be instructor/admin
    if (body.userId && body.userId !== user?.id) {
      if (authEnabled && !isInstructorOrAbove(user)) {
        return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Only instructors can enroll other users');
      }
    }

    // Check classroom visibility for self-enrollment
    if (!body.userId || body.userId === user?.id) {
      if (classroom.visibility === 'private') {
        return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Cannot self-enroll in a private classroom');
      }
    }

    const success = await enrollUserInClassroom(classroomId, targetUserId);

    return apiSuccess({ enrolled: success, classroomId, userId: targetUserId });
  } catch (error) {
    log.error('Enrollment failed:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to enroll user',
      error instanceof Error ? error.message : String(error),
    );
  }
}
