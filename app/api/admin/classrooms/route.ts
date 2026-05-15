import { NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { getSessionUser, isAdmin } from '@/lib/auth';
import { listClassroomsForUser, type ClassroomVisibility, type LifecycleState } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Admin Classrooms API');

/**
 * GET /api/admin/classrooms
 * Returns all classrooms with visibility + lifecycle stats. Admin only.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!isAdmin(user)) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 403, 'Admin access required');
  }

  try {
    const all = await listClassroomsForUser(user!.id, 'admin');

    const classrooms = all.map(c => ({
      id: c.id,
      name: c.stage?.name || c.id,
      ownerId: c.ownerId || null,
      ownerName: c.ownerName || c.ownerId || 'Unknown',
      ownerRole: c.ownerRole || 'student',
      visibility: (c.visibility ?? 'enrolled') as ClassroomVisibility,
      lifecycleState: (c.lifecycleState ?? 'active') as LifecycleState,
      enrolledCount: c.enrolledUserIds?.length || 0,
      createdAt: c.createdAt,
      pendingSince: c.pendingSince ?? null,
      archivedAt: c.archivedAt ?? null,
      sunsettingAt: c.sunsettingAt ?? null,
      clonedFromId: c.clonedFromId ?? null,
      cloneGeneration: c.cloneGeneration ?? 0,
    }));

    const stats = {
      total:      classrooms.length,
      public:     classrooms.filter(c => c.visibility === 'public').length,
      enrolled:   classrooms.filter(c => c.visibility === 'enrolled').length,
      private:    classrooms.filter(c => c.visibility === 'private').length,
      pending:    classrooms.filter(c => c.visibility === 'pending').length,
      active:     classrooms.filter(c => c.lifecycleState === 'active').length,
      sunsetting: classrooms.filter(c => c.lifecycleState === 'sunsetting').length,
      archived:   classrooms.filter(c => c.lifecycleState === 'archived').length,
    };

    return apiSuccess({ classrooms, stats });
  } catch (error) {
    log.error('Failed to list classrooms:', error);
    return apiError(API_ERROR_CODES.INTERNAL_ERROR, 500, 'Failed to list classrooms');
  }
}
