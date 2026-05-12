import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { readClassroom, isValidClassroomId } from '@/lib/server/classroom-storage';
import { getSessionUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Preview API');

/**
 * GET /api/classroom/preview?id=<classroomId>
 *
 * Returns lightweight preview info for a classroom identified by its code.
 * Available to any authenticated user, regardless of enrollment status —
 * this is intentional: students need to see the classroom name and instructor
 * before deciding to enroll, even if the classroom has visibility="enrolled".
 *
 * Deliberately withholds full classroom content (stage, scenes) so that
 * non-enrolled users cannot read the actual lesson material.
 *
 * Access rules:
 *  - Private classrooms: 403 (even preview is blocked — instructor must enroll)
 *  - public / enrolled: preview is returned to any authenticated user
 */
export async function GET(request: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const user = await getSessionUser(request);

  if (authEnabled && !user) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  }

  const id = request.nextUrl.searchParams.get('id');

  if (!id) {
    return apiError(
      API_ERROR_CODES.MISSING_REQUIRED_FIELD,
      400,
      'Missing required parameter: id',
    );
  }

  if (!isValidClassroomId(id)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
  }

  try {
    const classroom = await readClassroom(id);

    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    // Private classrooms are fully opaque — even the name is withheld.
    // The instructor must explicitly enroll the student.
    if (classroom.visibility === 'private') {
      return apiError(
        API_ERROR_CODES.INVALID_REQUEST,
        403,
        'This classroom is private. Contact your instructor for access.',
      );
    }

    // Return only the preview fields — no stage content, no scenes
    return apiSuccess({
      preview: {
        id: classroom.id,
        name: classroom.stage?.name || classroom.id,
        instructor: classroom.ownerName || classroom.ownerId || 'Instructor',
        visibility: classroom.visibility || 'enrolled',
        // Let the client know whether the requesting user is already enrolled
        alreadyEnrolled: user
          ? (classroom.enrolledUserIds || []).includes(user.id)
          : false,
      },
    });
  } catch (error) {
    log.error('Classroom preview failed:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom preview',
      error instanceof Error ? error.message : String(error),
    );
  }
}
