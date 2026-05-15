import { type NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { isValidClassroomId, getClassroomLineage } from '@/lib/server/classroom-storage';

/**
 * GET /api/admin/classroom/[id]/lineage
 * Returns the full family tree rooted at the original ancestor of this classroom.
 * Admin only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidClassroomId(id)) return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom ID');

  const user = await getSessionUser(req);
  if (!isAdmin(user)) return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Admin access required');

  const lineage = await getClassroomLineage(id);
  if (!lineage) return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');

  return apiSuccess({ lineage });
}
