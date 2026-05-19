import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import { groupsToRoles } from '@/lib/sso/groups';
import { JwtVerifyError, verifyHs256Jwt } from '@/lib/sso/verify';
const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');

/** Disk shape may include multi-tenant fields not yet in upstream PersistedClassroomData. */
interface LaunchListClassroom {
  id: string;
  createdAt: string;
  stage?: { id?: string; name?: string };
  ownerId?: string;
  ownerName?: string;
  visibility?: string;
  enrolledUserIds?: string[];
}
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom Launch List API');

function extractBearerToken(request: NextRequest): string | null {
  const authorizationHeader = request.headers.get('authorization');
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authorizationHeader.slice('Bearer '.length).trim();
}

function resolvePrimaryRoleFromSpaceGroups(spaceGroups: string[] | undefined): string {
  const roles = groupsToRoles(spaceGroups);
  if (roles.includes('admin')) {
    return 'admin';
  }
  if (roles.includes('instructor')) {
    return 'instructor';
  }
  return 'student';
}

async function readAllClassroomsFromDisk(): Promise<LaunchListClassroom[]> {
  try {
    const fileNames = await fs.readdir(CLASSROOMS_DIR);
    const classrooms: LaunchListClassroom[] = [];
    for (const fileName of fileNames) {
      if (!fileName.endsWith('.json')) {
        continue;
      }
      try {
        const fileContent = await fs.readFile(path.join(CLASSROOMS_DIR, fileName), 'utf-8');
        classrooms.push(JSON.parse(fileContent) as LaunchListClassroom);
      } catch {
        // Skip corrupted classroom files
      }
    }
    return classrooms.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function isLaunchableClassroom(
  classroom: LaunchListClassroom,
  userId: string,
  userRole: string,
): boolean {
  if (userRole === 'admin') {
    return true;
  }
  if (classroom.ownerId === userId) {
    return true;
  }
  if ((classroom.enrolledUserIds || []).includes(userId)) {
    return true;
  }
  const visibility = classroom.visibility ?? 'public';
  if (visibility === 'public') {
    return true;
  }
  return false;
}

/**
 * GET /api/classroom/launch-list
 *
 * Space Agent passes the short-lived launch JWT (Authorization: Bearer …).
 * Returns classrooms the user may open via SSO redirect (enrolled, owned, or public).
 */
export async function GET(request: NextRequest) {
  const launchSecret = process.env.MAIC_LAUNCH_SECRET;
  if (!launchSecret) {
    return apiError(API_ERROR_CODES.INTERNAL_ERROR, 503, 'SSO not configured (MAIC_LAUNCH_SECRET missing)');
  }

  const launchToken =
    extractBearerToken(request) ?? request.nextUrl.searchParams.get('token');
  if (!launchToken) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 401, 'Missing launch token');
  }

  let launchClaims;
  try {
    launchClaims = await verifyHs256Jwt(launchToken, launchSecret);
  } catch (error) {
    const code = error instanceof JwtVerifyError ? error.code : 'INVALID';
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 401, `Invalid launch token: ${code}`);
  }

  const userId = launchClaims.sub;
  const userRole = resolvePrimaryRoleFromSpaceGroups(launchClaims.space?.groups);

  try {
    const allClassrooms = await readAllClassroomsFromDisk();
    const classrooms = allClassrooms
      .filter((classroom) => isLaunchableClassroom(classroom, userId, userRole))
      .map((classroom) => ({
        id: classroom.id,
        name: classroom.stage?.name || classroom.id,
        instructor: classroom.ownerName || classroom.ownerId || 'Unknown',
        visibility: classroom.visibility || 'enrolled',
        isOwner: classroom.ownerId === userId,
      }));

    return apiSuccess({ classrooms });
  } catch (error) {
    log.error('Failed to build launch list:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to fetch launch list',
      error instanceof Error ? error.message : String(error),
    );
  }
}
