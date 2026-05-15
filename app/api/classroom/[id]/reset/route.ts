import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser } from '@/lib/auth';
import {
  readClassroom,
  resetClassroom,
  isValidClassroomId,
  type ResetTarget,
} from '@/lib/server/classroom-storage';
import { appendAuditLog } from '@/lib/server/audit-log';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Reset API');

const VALID_TARGETS: ResetTarget[] = ['enrollments', 'pendingState', 'lifecycleState'];

/**
 * POST /api/classroom/[id]/reset
 *
 * Clears specified aspects without touching stage or scenes.
 *   Admin      — any classroom
 *   Instructor — own classrooms only
 *   Student    — never
 *
 * Body: { targets: ResetTarget[]; reason? }
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
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Only instructors and admins can reset classrooms');
  }

  let body: { targets?: unknown; reason?: string } = {};
  try { body = await request.json(); } catch {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid JSON body');
  }

  if (!Array.isArray(body.targets) || body.targets.length === 0) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, `targets must be a non-empty array of: ${VALID_TARGETS.join(', ')}`);
  }

  const targets = (body.targets as unknown[]).filter(
    (t): t is ResetTarget => typeof t === 'string' && VALID_TARGETS.includes(t as ResetTarget),
  );
  if (targets.length === 0) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, `Valid targets: ${VALID_TARGETS.join(', ')}`);
  }

  const classroom = await readClassroom(classroomId);
  if (!classroom) return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');

  if (user.role !== 'admin' && classroom.ownerId !== user.id) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Only the classroom owner or an admin can reset this classroom');
  }

  const u = user as { id: string; name?: string | null; email: string };
  const updated = await resetClassroom(classroomId, targets);

  appendAuditLog({
    classroomId,
    changedBy: u.id,
    changedByName: u.name || u.email || null,
    action: 'metadata_edit',
    field: 'reset',
    oldValue: { targets, enrolledCount: classroom.enrolledUserIds?.length ?? 0 },
    newValue: { targets },
    reason: body.reason?.trim() || null,
  });

  log.info(`Classroom ${classroomId} reset [${targets.join(', ')}] by ${u.id}`);

  return apiSuccess({
    id: classroomId,
    targets,
    visibility: updated?.visibility,
    lifecycleState: updated?.lifecycleState ?? 'active',
    enrolledCount: updated?.enrolledUserIds?.length ?? 0,
  });
}
