import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
  canViewClassroom,
  canEditClassroom,
  listClassroomsForUser,
  type ClassroomVisibility,
} from '@/lib/server/classroom-storage';
import { getSessionUser, isInstructorOrAbove } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom API');

const VALID_VISIBILITIES: ClassroomVisibility[] = ['public', 'enrolled', 'private', 'pending'];

/**
 * POST /api/classroom — Create or overwrite a classroom.
 *
 * Auth rules:
 *   - Any authenticated user may create a classroom.
 *   - Students may not set visibility to 'public' directly (use 'pending' to request review).
 *   - Only the original owner or an admin may overwrite an existing classroom.
 */
export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;

  const user = await getSessionUser(request);
  const authEnabled = process.env.AUTH_ENABLED === 'true';

  if (authEnabled && !user) {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
  }

  try {
    const body = await request.json();
    const { stage, scenes, classroomProviderConfig } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing required fields: stage, scenes');
    }

    // Validate requested visibility
    const requestedVisibility: ClassroomVisibility =
      VALID_VISIBILITIES.includes(body.visibility) ? body.visibility : 'enrolled';

    if (authEnabled && user) {
      const isStudent = !isInstructorOrAbove(user);
      if (isStudent && requestedVisibility === 'public') {
        return apiError(
          API_ERROR_CODES.INVALID_REQUEST,
          403,
          'Students cannot publish classrooms directly. Set visibility to "pending" to submit for instructor review.',
        );
      }
    }

    const id = stage.id || randomUUID();

    // Ownership guard: only the original owner or an admin may overwrite.
    if (authEnabled) {
      const existing = await readClassroom(id);
      if (existing && !canEditClassroom(existing, user?.id, user?.role)) {
        return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'You do not have permission to modify this classroom');
      }
    }

    const baseUrl = buildRequestOrigin(request);
    const persisted = await persistClassroom(
      {
        id,
        stage: { ...stage, id },
        scenes,
        ownerId: user?.id || undefined,
        ownerRole: user?.role || undefined,
        ownerName: user?.name || undefined,
        visibility: requestedVisibility,
        enrolledUserIds: body.enrolledUserIds || [],
        classroomProviderConfig: body.classroomProviderConfig || undefined,
      },
      baseUrl,
    );

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(`Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`, error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * GET /api/classroom — Read a single classroom (?id=) or list all (?list=true).
 */
export async function GET(request: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const user = await getSessionUser(request);

  try {
    if (request.nextUrl.searchParams.get('list') === 'true') {
      if (authEnabled && !user) {
        return apiError(API_ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required');
      }
      const classrooms = await listClassroomsForUser(user?.id, user?.role);
      return apiSuccess({ classrooms });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return apiError(API_ERROR_CODES.MISSING_REQUIRED_FIELD, 400, 'Missing required parameter: id (or use ?list=true)');
    }
    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }
    if (authEnabled && !canViewClassroom(classroom, user?.id, user?.role)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 403, 'You do not have access to this classroom');
    }

    return apiSuccess({ classroom });
  } catch (error) {
    log.error(`Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`, error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
