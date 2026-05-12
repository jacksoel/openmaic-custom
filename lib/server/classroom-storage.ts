import { promises as fs } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';

export const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');
export const CLASSROOM_JOBS_DIR = path.join(process.cwd(), 'data', 'classroom-jobs');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureClassroomsDir() {
  await ensureDir(CLASSROOMS_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDir(CLASSROOM_JOBS_DIR);
}

export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempFilePath, content, 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

export function buildRequestOrigin(req: NextRequest): string {
  return req.headers.get('x-forwarded-host')
    ? `${req.headers.get('x-forwarded-proto') || 'http'}://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin;
}

// ---------------------------------------------------------------------------
// Classroom data types (extended with ownership)
// ---------------------------------------------------------------------------

export type ClassroomVisibility = 'public' | 'enrolled' | 'private';

export interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  createdAt: string;
  /** Owner user ID (instructor who created this classroom) */
  ownerId?: string;
  /** Owner role at time of creation */
  ownerRole?: string;
  /** Who can see this classroom */
  visibility?: ClassroomVisibility;
  /** User IDs of enrolled students */
  enrolledUserIds?: string[];
  /** Display name of owner (for UI) */
  ownerName?: string;
}

export function isValidClassroomId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export async function readClassroom(id: string): Promise<PersistedClassroomData | null> {
  const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as PersistedClassroomData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function persistClassroom(
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
    ownerId?: string;
    ownerRole?: string;
    ownerName?: string;
    visibility?: ClassroomVisibility;
    enrolledUserIds?: string[];
  },
  baseUrl: string,
): Promise<PersistedClassroomData & { url: string }> {
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
    ownerId: data.ownerId,
    ownerRole: data.ownerRole,
    ownerName: data.ownerName,
    visibility: data.visibility || 'enrolled',
    enrolledUserIds: data.enrolledUserIds || [],
  };

  await ensureClassroomsDir();
  const filePath = path.join(CLASSROOMS_DIR, `${data.id}.json`);
  await writeJsonFileAtomic(filePath, classroomData);

  return {
    ...classroomData,
    url: `${baseUrl}/classroom/${data.id}`,
  };
}

// ---------------------------------------------------------------------------
// Access control helpers
// ---------------------------------------------------------------------------

/**
 * Check if a user can view a classroom.
 * - Admins can view everything
 * - Owner can always view
 * - Public classrooms: any authenticated user
 * - Enrolled: user is in enrolledUserIds
 * - Private: only owner and admin
 */
export function canViewClassroom(
  classroom: PersistedClassroomData,
  userId: string | null | undefined,
  userRole: string | null | undefined,
): boolean {
  // Admin sees everything
  if (userRole === 'admin') return true;

  // Owner always sees their own
  if (userId && classroom.ownerId === userId) return true;

  // Legacy classrooms (created before multi-tenant) have no visibility field.
  // Default them to 'public' so existing classrooms remain accessible to all authenticated users.
  const visibility = classroom.visibility ?? 'public';

  if (visibility === 'public') {
    return !!userId; // any authenticated user
  }

  if (visibility === 'enrolled') {
    return !!userId && !!(classroom.enrolledUserIds || []).includes(userId);
  }

  // private: only owner/admin (already checked above)
  return false;
}

/**
 * Check if a user can edit a classroom.
 * Only owner or admin can edit.
 */
export function canEditClassroom(
  classroom: PersistedClassroomData,
  userId: string | null | undefined,
  userRole: string | null | undefined,
): boolean {
  if (userRole === 'admin') return true;
  if (userId && classroom.ownerId === userId) return true;
  return false;
}

/**
 * Enroll a user in a classroom (adds to enrolledUserIds).
 */
export async function enrollUserInClassroom(
  classroomId: string,
  userId: string,
): Promise<boolean> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) return false;

  const enrolled = classroom.enrolledUserIds || [];
  if (enrolled.includes(userId)) return true; // already enrolled

  enrolled.push(userId);
  classroom.enrolledUserIds = enrolled;

  const filePath = path.join(CLASSROOMS_DIR, `${classroomId}.json`);
  await writeJsonFileAtomic(filePath, classroom);
  return true;
}

/**
 * List classrooms accessible by a user.
 */
export async function listClassroomsForUser(
  userId: string | null | undefined,
  userRole: string | null | undefined,
): Promise<PersistedClassroomData[]> {
  await ensureClassroomsDir();
  const files = await fs.readdir(CLASSROOMS_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  const classrooms: PersistedClassroomData[] = [];
  for (const file of jsonFiles) {
    try {
      const content = await fs.readFile(path.join(CLASSROOMS_DIR, file), 'utf-8');
      const classroom = JSON.parse(content) as PersistedClassroomData;
      if (canViewClassroom(classroom, userId, userRole)) {
        classrooms.push(classroom);
      }
    } catch {
      // Skip corrupted files
    }
  }

  return classrooms.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
