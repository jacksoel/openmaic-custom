import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
  canViewClassroom,
  listClassroomsForUser,
} from '@/lib/server/classroom-storage';
import { getSessionUser, isInstructorOrAbove } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom API');

/**
 * POST /api/classroom — Create a new classroom
 * Requires auth + instructor/admin role.
 * Sets ownerId from session.
 */
export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;

  // Auth check
  const user = await getSessionUser(request);
  const authEnabled = process.env.AUTH_ENABLED === 'true';

  if (authEnabled && !user) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  }

  if (authEnabled && !isInstructorOrAbove(user)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'Only instructors and admins can create classrooms');
  }

  try {
    const body = await request.json();
    const { stage, scenes } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    const persisted = await persistClassroom(
      {
        id,
        stage: { ...stage, id },
        scenes,
        ownerId: user?.id || undefined,
        ownerRole: user?.role || undefined,
        ownerName: user?.name || undefined,
        visibility: body.visibility || 'enrolled',
        enrolledUserIds: body.enrolledUserIds || [],
      },
      baseUrl,
    );

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * GET /api/classroom — Read a single classroom by ?id=, or list all with ?list=true
 * Enforces visibility: owner/admin see all, others see based on visibility + enrollment.
 */
export async function GET(request: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const user = await getSessionUser(request);

  try {
    // List mode: GET /api/classroom?list=true
    if (request.nextUrl.searchParams.get('list') === 'true') {
      if (authEnabled && !user) {
        return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
      }

      const classrooms = await listClassroomsForUser(user?.id, user?.role);
      return apiSuccess({ classrooms });
    }

    // Single classroom mode: GET /api/classroom?id=xxx
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id (or use ?list=true)',
      );
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    // Enforce visibility
    if (authEnabled) {
      if (!canViewClassroom(classroom, user?.id, user?.role)) {
        return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'You do not have access to this classroom');
      }
    }

    return apiSuccess({ classroom });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
