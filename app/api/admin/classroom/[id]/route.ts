import { type NextRequest } from 'next/server';
import path from 'path';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser, isAdmin } from '@/lib/auth';
import {
  readClassroom,
  updateClassroomVisibility,
  writeJsonFileAtomic,
  isValidClassroomId,
  CLASSROOMS_DIR,
  type ClassroomVisibility,
} from '@/lib/server/classroom-storage';
import { appendAuditLog } from '@/lib/server/audit-log';
import { createLogger } from '@/lib/logger';

const log = createLogger('Admin Classroom API');

const VALID_VISIBILITIES: ClassroomVisibility[] = ['public', 'enrolled', 'private', 'pending'];

/**
 * GET /api/admin/classroom/[id]
 * Full classroom detail including enrolled user IDs. Admin only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidClassroomId(id)) return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID');

  const user = await getSessionUser(req);
  if (!isAdmin(user)) return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Admin access required');

  const classroom = await readClassroom(id);
  if (!classroom) return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');

  return apiSuccess({
    id: classroom.id,
    name: classroom.stage?.name || classroom.id,
    ownerId: classroom.ownerId || null,
    ownerName: classroom.ownerName || classroom.ownerId || 'Unknown',
    ownerRole: classroom.ownerRole || 'student',
    visibility: (classroom.visibility ?? 'enrolled') as ClassroomVisibility,
    enrolledUserIds: classroom.enrolledUserIds || [],
    enrolledCount: classroom.enrolledUserIds?.length || 0,
    createdAt: classroom.createdAt,
    pendingSince: classroom.pendingSince ?? null,
  });
}

/**
 * PATCH /api/admin/classroom/[id]
 * Update visibility and/or enrolled users. Admin only.
 * All changes are written atomically and appended to the audit log.
 *
 * Body: { visibility?, enrolledUserIds?, reason? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidClassroomId(id)) return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID');

  const user = await getSessionUser(req);
  if (!isAdmin(user)) return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Admin access required');

  let body: { visibility?: unknown; enrolledUserIds?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid JSON body');
  }

  const classroom = await readClassroom(id);
  if (!classroom) return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');

  const u = user as { id: string; name?: string | null; email: string };
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;
  const oldVisibility = classroom.visibility ?? 'enrolled';
  const oldEnrolledIds = classroom.enrolledUserIds || [];

  let updated = { ...classroom };
  const visibilityChanged =
    body.visibility !== undefined &&
    VALID_VISIBILITIES.includes(body.visibility as ClassroomVisibility) &&
    (body.visibility as ClassroomVisibility) !== oldVisibility;

  const newEnrolledIds = Array.isArray(body.enrolledUserIds)
    ? (body.enrolledUserIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : null;
  const enrollmentChanged =
    newEnrolledIds !== null &&
    JSON.stringify([...oldEnrolledIds].sort()) !== JSON.stringify([...newEnrolledIds].sort());

  if (body.visibility !== undefined && !VALID_VISIBILITIES.includes(body.visibility as ClassroomVisibility)) {
    return apiError(
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}`,
    );
  }

  if (!visibilityChanged && !enrollmentChanged) {
    return apiSuccess({
      id,
      visibility: oldVisibility,
      enrolledUserIds: oldEnrolledIds,
      pendingSince: classroom.pendingSince ?? null,
    });
  }

  // Apply visibility change
  if (visibilityChanged) {
    const newVis = body.visibility as ClassroomVisibility;
    updated.visibility = newVis;
    updated.pendingSince = newVis === 'pending'
      ? (classroom.pendingSince ?? new Date().toISOString())
      : undefined;
  }

  // Apply enrollment change
  if (enrollmentChanged && newEnrolledIds !== null) {
    updated.enrolledUserIds = newEnrolledIds;
  }

  // Single atomic write covering both changes
  await writeJsonFileAtomic(path.join(CLASSROOMS_DIR, `${id}.json`), updated);

  // Audit log entries
  if (visibilityChanged) {
    const newVis = body.visibility as ClassroomVisibility;
    appendAuditLog({
      classroomId: id,
      changedBy: u.id,
      changedByName: u.name || u.email || null,
      action: 'visibility_change',
      field: 'visibility',
      oldValue: oldVisibility,
      newValue: newVis,
      reason,
    });
    log.info(`Classroom ${id} visibility ${oldVisibility} → ${newVis} (admin ${u.id})`);
  }

  if (enrollmentChanged && newEnrolledIds !== null) {
    const added   = newEnrolledIds.filter(uid => !oldEnrolledIds.includes(uid));
    const removed = oldEnrolledIds.filter(uid => !newEnrolledIds.includes(uid));
    appendAuditLog({
      classroomId: id,
      changedBy: u.id,
      changedByName: u.name || u.email || null,
      action: 'enrollment_change',
      field: 'enrolledUserIds',
      oldValue: { count: oldEnrolledIds.length, added, removed },
      newValue: { count: newEnrolledIds.length },
      reason,
    });
    log.info(`Classroom ${id} enrollment updated by admin ${u.id}: +${added.length} -${removed.length}`);
  }

  return apiSuccess({
    id,
    visibility: updated.visibility ?? 'enrolled',
    enrolledUserIds: updated.enrolledUserIds || [],
    pendingSince: updated.pendingSince ?? null,
  });
}
