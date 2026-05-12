import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  readClassroom,
  writeJsonFileAtomic,
  CLASSROOMS_DIR,
  isValidClassroomId,
} from '@/lib/server/classroom-storage';
import { getSessionUser } from '@/lib/auth';
import { getDb } from '@/lib/server/auth-db';
import { createLogger } from '@/lib/logger';
import path from 'path';

const log = createLogger('Classroom Enrollments API');

/**
 * GET /api/classroom/[id]/enrollments
 *
 * Returns the full roster of enrolled students for a classroom.
 * Only accessible by the classroom owner or an admin.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: classroomId } = await params;

  if (!isValidClassroomId(classroomId)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID format');
  }

  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const user = await getSessionUser(request);
  if (authEnabled && !user) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  }

  const classroom = await readClassroom(classroomId);
  if (!classroom) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
  }

  // Only classroom owner or admin may view the roster
  const isOwner = user?.id === classroom.ownerId;
  const isAdmin = user?.role === 'admin';
  if (authEnabled && !isOwner && !isAdmin) {
    return apiError(
      API_ERROR_CODES.INVALID_REQUEST,
      403,
      'Only the classroom owner or an admin may view enrollments',
    );
  }

  // Resolve enrolled user records from the auth DB
  const db = getDb();
  const enrolledUserIds: string[] = classroom.enrolledUserIds || [];

  const students = enrolledUserIds
    .map((userId) => {
      const row = db
        .prepare('SELECT id, email, name, role, createdAt FROM user WHERE id = ?')
        .get(userId) as { id: string; email: string; name: string; role: string; createdAt: string } | undefined;

      if (!row) {
        log.warn(`Enrolled user ${userId} not found in auth DB — stale enrollment`);
        return null;
      }

      return {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        // Use user createdAt as proxy until we store actual enrolledAt on the enrollment entry
        enrolledAt: row.createdAt,
        isOwner: row.id === classroom.ownerId,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  log.info(`Roster fetched for ${classroomId}: ${students.length}/${enrolledUserIds.length} resolved`);

  return apiSuccess({
    classroomId,
    enrolledCount: students.length,
    students,
  });
}

/**
 * DELETE /api/classroom/[id]/enrollments
 *
 * Removes a student from the classroom's enrolledUserIds.
 * Only accessible by the classroom owner or an admin.
 * The classroom owner themselves cannot be unenrolled.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: classroomId } = await params;

  if (!isValidClassroomId(classroomId)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID format');
  }

  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const user = await getSessionUser(request);
  if (authEnabled && !user) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  }

  const userId = request.nextUrl.searchParams.get('userId');
  if (!userId) {
    return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'userId query parameter is required');
  }

  const classroom = await readClassroom(classroomId);
  if (!classroom) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
  }

  // Only classroom owner or admin may unenroll
  const isOwner = user?.id === classroom.ownerId;
  const isAdmin = user?.role === 'admin';
  if (authEnabled && !isOwner && !isAdmin) {
    return apiError(
      API_ERROR_CODES.INVALID_REQUEST,
      403,
      'Only the classroom owner or an admin may unenroll students',
    );
  }

  // Cannot unenroll the classroom owner (they are implicitly always enrolled)
  if (userId === classroom.ownerId) {
    return apiError(
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Cannot unenroll the classroom owner',
    );
  }

  const enrolledUserIds: string[] = classroom.enrolledUserIds || [];
  if (!enrolledUserIds.includes(userId)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'User is not enrolled in this classroom');
  }

  const updatedClassroom = {
    ...classroom,
    enrolledUserIds: enrolledUserIds.filter((id) => id !== userId),
  };

  await writeJsonFileAtomic(path.join(CLASSROOMS_DIR, `${classroomId}.json`), updatedClassroom);

  log.info(`Unenrolled user ${userId} from classroom ${classroomId}`);

  return apiSuccess({ classroomId, removedUserId: userId });
}
