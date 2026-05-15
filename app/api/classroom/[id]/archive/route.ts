import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser } from '@/lib/auth';
import {
  readClassroom,
  archiveClassroom,
  isValidClassroomId,
} from '@/lib/server/classroom-storage';
import { appendAuditLog } from '@/lib/server/audit-log';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Archive API');

/**
 * POST /api/classroom/[id]/archive
 *
 * Archives a classroom or sets it to sunsetting state.
 *   Admin      — any classroom
 *   Instructor — own classrooms only
 *   Student    — never
 *
 * Body: { sunsetting?, sunsettingAt?, sunsettingMessage?, successorId?, reason? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: classroomId } = await params;
  if (!isValidClassroomId(classroomId)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID');
  }

  const user = await getSessionUser(request);
  if (!user) return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');

  if (user.role !== 'admin' && user.role !== 'instructor') {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Only instructors and admins can archive classrooms');
  }

  let body: { sunsetting?: boolean; sunsettingAt?: string; sunsettingMessage?: string; successorId?: string; reason?: string } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }

  const classroom = await readClassroom(classroomId);
  if (!classroom) return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');

  if (user.role !== 'admin' && classroom.ownerId !== user.id) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Only the classroom owner or an admin can archive this classroom');
  }

  const oldState = classroom.lifecycleState ?? 'active';
  const newState = body.sunsetting ? 'sunsetting' : 'archived';

  const updated = await archiveClassroom(classroomId, {
    sunsetting: body.sunsetting,
    sunsettingAt: body.sunsettingAt,
    sunsettingMessage: body.sunsettingMessage,
    successorId: body.successorId,
  });

  const u = user as { id: string; name?: string | null; email: string };
  appendAuditLog({
    classroomId,
    changedBy: u.id,
    changedByName: u.name || u.email || null,
    action: 'metadata_edit',
    field: 'lifecycleState',
    oldValue: oldState,
    newValue: newState,
    reason: body.reason?.trim() || null,
  });

  log.info(`Classroom ${classroomId} ${oldState} → ${newState} (by ${u.id})`);

  return apiSuccess({
    id: classroomId,
    lifecycleState: updated?.lifecycleState,
    archivedAt: updated?.archivedAt ?? null,
    sunsettingAt: updated?.sunsettingAt ?? null,
    sunsettingMessage: updated?.sunsettingMessage ?? null,
    successorId: updated?.successorId ?? null,
  });
}
