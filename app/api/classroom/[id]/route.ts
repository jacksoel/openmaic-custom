import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser } from '@/lib/auth';
import {
  readClassroom,
  canDeleteClassroom,
  deleteClassroom,
  isValidClassroomId,
} from '@/lib/server/classroom-storage';
import { appendAuditLog } from '@/lib/server/audit-log';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Delete API');

/**
 * DELETE /api/classroom/[id]
 *
 * Hard-deletes the classroom JSON file. Cannot be undone.
 *
 * Permissions:
 *   Admin      — any classroom in any state
 *   Instructor — own classrooms only; must be lifecycleState === 'archived' first
 *   Student    — never
 *
 * Body: { confirmName: string; reason?: string }
 * The confirmName must exactly match the classroom's display name.
 *
 * Audit log entry is written BEFORE file deletion so the record survives.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: classroomId } = await params;
  if (!isValidClassroomId(classroomId)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID');
  }

  const user = await getSessionUser(request);
  if (!user) return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');

  let body: { confirmName?: unknown; reason?: unknown } = {};
  try { body = await request.json(); } catch {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid JSON body');
  }

  const classroom = await readClassroom(classroomId);
  if (!classroom) return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');

  const classroomName = classroom.stage?.name || classroom.id;
  if (body.confirmName !== classroomName) {
    return apiError(
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      `Name confirmation failed. Type "${classroomName}" exactly to confirm deletion.`,
    );
  }

  const check = canDeleteClassroom(classroom, user.id, user.role);
  if (!check.allowed) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, check.reason || 'Permission denied');
  }

  const u = user as { id: string; name?: string | null; email: string };

  // Write audit entry BEFORE deletion — the record must outlive the file.
  appendAuditLog({
    classroomId,
    changedBy: u.id,
    changedByName: u.name || u.email || null,
    action: 'metadata_edit',
    field: 'deleted',
    oldValue: {
      name: classroomName,
      visibility: classroom.visibility,
      lifecycleState: classroom.lifecycleState ?? 'active',
      enrolledCount: classroom.enrolledUserIds?.length ?? 0,
      clonedFromId: classroom.clonedFromId ?? null,
    },
    newValue: 'deleted',
    reason: typeof body.reason === 'string' ? body.reason.trim() || null : null,
  });

  const deleted = await deleteClassroom(classroomId);
  if (!deleted) return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'Failed to delete classroom');

  log.info(`Classroom ${classroomId} permanently deleted by ${u.id} (role: ${user.role})`);
  return apiSuccess({ id: classroomId, deleted: true });
}
