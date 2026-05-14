import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { isValidClassroomId } from '@/lib/server/classroom-storage';
import { getClassroomHistory } from '@/lib/server/audit-log';

/**
 * GET /api/admin/classroom/[id]/history
 * Returns the audit log for a classroom, most recent first. Admin only.
 *
 * Query params:
 *   limit  (default 50, max 200)
 *   offset (default 0)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidClassroomId(id)) return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID');

  const user = await getSessionUser(req);
  if (!isAdmin(user)) return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Admin access required');

  const url    = new URL(req.url);
  const limit  = Math.min(parseInt(url.searchParams.get('limit')  || '50',  10), 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0',   10), 0);

  const history = getClassroomHistory(id, limit, offset);
  return apiSuccess({ history });
}
