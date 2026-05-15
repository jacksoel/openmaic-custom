import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser } from '@/lib/auth';
import {
  readClassroom,
  canViewClassroom,
  cloneClassroom,
  isValidClassroomId,
  buildRequestOrigin,
} from '@/lib/server/classroom-storage';
import { appendAuditLog } from '@/lib/server/audit-log';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Clone API');

/**
 * POST /api/classroom/[id]/clone
 *
 * Creates a new classroom that inherits stage + scenes but not enrollments.
 * The clone starts as private; the cloner becomes the owner.
 *
 * Any instructor or admin who can view the source classroom may clone it.
 *
 * Body: { reason? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sourceId } = await params;
  if (!isValidClassroomId(sourceId)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID');
  }

  const user = await getSessionUser(request);
  if (!user) return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');

  if (user.role !== 'admin' && user.role !== 'instructor') {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Only instructors and admins can clone classrooms');
  }

  let body: { reason?: string } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }

  const source = await readClassroom(sourceId);
  if (!source) return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');

  if (!canViewClassroom(source, user.id, user.role)) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'You do not have access to this classroom');
  }

  const u = user as { id: string; name?: string | null; email: string; role: string };
  const baseUrl = buildRequestOrigin(request);

  const clone = await cloneClassroom(sourceId, {
    ownerId: u.id,
    ownerRole: u.role,
    ownerName: u.name || u.email || undefined,
    baseUrl,
  });
  if (!clone) return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'Failed to clone classroom');

  appendAuditLog({
    classroomId: clone.id,
    changedBy: u.id,
    changedByName: u.name || u.email || null,
    action: 'metadata_edit',
    field: 'clonedFromId',
    oldValue: null,
    newValue: sourceId,
    reason: body.reason?.trim() || null,
  });

  log.info(`Classroom ${sourceId} cloned → ${clone.id} by ${u.id}`);

  return apiSuccess({ id: clone.id, name: clone.stage?.name || clone.id, url: clone.url, clonedFromId: sourceId, cloneGeneration: clone.cloneGeneration ?? 1 }, 201);
}
