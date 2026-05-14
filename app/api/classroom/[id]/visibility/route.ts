import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  readClassroom,
  canChangeVisibility,
  updateClassroomVisibility,
  isValidClassroomId,
  type ClassroomVisibility,
} from '@/lib/server/classroom-storage';
import { getSessionUser } from '@/lib/auth';
import { appendAuditLog } from '@/lib/server/audit-log';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Visibility API');

const VALID_VISIBILITIES: ClassroomVisibility[] = ['public', 'enrolled', 'private', 'pending'];

/**
 * PATCH /api/classroom/[id]/visibility
 * Changes a classroom's visibility post-creation.
 *
 * Enforces the asymmetric governance model:
 *   Admin               — any classroom, any state, no approval
 *   Instructor (owner)  — own classrooms, any state, no approval
 *   Instructor (reviewer) — approve (pending→public) or reject (pending→enrolled)
 *   Student (owner)     — private / enrolled / pending only;
 *                         cannot change once the classroom is public
 *
 * Accepts optional `reason` field — recorded in the audit log.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: classroomId } = await params;

  if (!isValidClassroomId(classroomId)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID');
  }

  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const user = await getSessionUser(request);

  if (authEnabled && !user) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  }

  let body: { visibility?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid JSON body');
  }

  const newVisibility = body.visibility as ClassroomVisibility;
  if (!newVisibility || !VALID_VISIBILITIES.includes(newVisibility)) {
    return apiError(
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}`,
    );
  }

  const classroom = await readClassroom(classroomId);
  if (!classroom) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
  }

  const oldVisibility = classroom.visibility ?? 'enrolled';

  const check = canChangeVisibility(classroom, user?.id, user?.role, newVisibility);
  if (!check.allowed) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, check.reason || 'Permission denied');
  }

  const updated = await updateClassroomVisibility(classroomId, newVisibility);

  if (user && newVisibility !== oldVisibility) {
    const u = user as { id: string; name?: string | null; email: string; role?: string | null };
    appendAuditLog({
      classroomId,
      changedBy: u.id,
      changedByName: u.name || u.email || null,
      action: 'visibility_change',
      field: 'visibility',
      oldValue: oldVisibility,
      newValue: newVisibility,
      reason: typeof body.reason === 'string' ? body.reason.trim() || null : null,
    });
  }

  log.info(`Classroom ${classroomId} visibility → ${newVisibility} (by user ${user?.id}, role ${user?.role})`);

  return apiSuccess({
    id: classroomId,
    visibility: updated?.visibility,
    pendingSince: updated?.pendingSince ?? null,
  });
}
