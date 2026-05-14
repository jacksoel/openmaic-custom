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
// Types
// ---------------------------------------------------------------------------

/**
 * Visibility states:
 *   private  — owner + admin only
 *   enrolled — enrolled users + owner + admin (invite/code required, not in catalog)
 *   pending  — submitted for instructor/admin review; not yet in public catalog
 *   public   — discoverable in catalog; any authenticated user may self-enroll
 */
export type ClassroomVisibility = 'public' | 'enrolled' | 'private' | 'pending';

export interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  createdAt: string;
  ownerId?: string;
  ownerRole?: string;
  visibility?: ClassroomVisibility;
  enrolledUserIds?: string[];
  ownerName?: string;
  /** ISO timestamp set when visibility transitions to 'pending'; cleared on any other transition. */
  pendingSince?: string;
  classroomProviderConfig?: {
    providerSlug: string;
    defaultModel?: string;
  };
}

export function isValidClassroomId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// ---------------------------------------------------------------------------
// Effective visibility helper
// ---------------------------------------------------------------------------

/**
 * Returns the effective visibility for a classroom.
 * Legacy classrooms (no visibility field) default to 'enrolled' — not 'public'.
 * This prevents pre-auth JSON files from being inadvertently exposed in the catalog.
 */
function effectiveVisibility(classroom: PersistedClassroomData): ClassroomVisibility {
  return classroom.visibility ?? 'enrolled';
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function readClassroom(id: string): Promise<PersistedClassroomData | null> {
  const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as PersistedClassroomData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
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
    classroomProviderConfig?: { providerSlug: string; defaultModel?: string };
  },
  baseUrl: string,
): Promise<PersistedClassroomData & { url: string }> {
  const visibility = data.visibility || 'enrolled';
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
    ownerId: data.ownerId,
    ownerRole: data.ownerRole,
    ownerName: data.ownerName,
    visibility,
    enrolledUserIds: data.enrolledUserIds || [],
    classroomProviderConfig: data.classroomProviderConfig,
    pendingSince: visibility === 'pending' ? new Date().toISOString() : undefined,
  };
  await ensureClassroomsDir();
  const filePath = path.join(CLASSROOMS_DIR, `${data.id}.json`);
  await writeJsonFileAtomic(filePath, classroomData);
  return { ...classroomData, url: `${baseUrl}/classroom/${data.id}` };
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * Check if a user can VIEW a classroom.
 *
 * - Admin: sees all
 * - Owner: sees own
 * - public: any authenticated user
 * - enrolled: only enrolled users
 * - pending: instructors and admins (for review queue)
 * - private: owner + admin only
 */
export function canViewClassroom(
  classroom: PersistedClassroomData,
  userId: string | null | undefined,
  userRole: string | null | undefined,
): boolean {
  if (userRole === 'admin') return true;
  if (userId && classroom.ownerId === userId) return true;

  const visibility = effectiveVisibility(classroom);
  switch (visibility) {
    case 'public':   return !!userId;
    case 'enrolled': return !!userId && !!(classroom.enrolledUserIds || []).includes(userId);
    case 'pending':  return userRole === 'instructor'; // instructors see pending queue
    case 'private':  return false; // owner/admin handled above
    default:         return false;
  }
}

/**
 * Check if a user can EDIT a classroom's content.
 * Only the owner or an admin may modify content.
 */
export function canEditClassroom(
  classroom: PersistedClassroomData,
  userId: string | null | undefined,
  userRole: string | null | undefined,
): boolean {
  if (userRole === 'admin') return true;
  return !!(userId && classroom.ownerId === userId);
}

/**
 * Check if a user can CHANGE a classroom's visibility.
 *
 * Asymmetric governance model:
 *   Admin               — unrestricted on any classroom
 *   Instructor (owner)  — full authority on own classrooms, no approval step
 *   Instructor (reviewer, non-owner of a pending classroom)
 *                       — may approve (→ public) or reject (→ enrolled)
 *   Student (owner)     — may set private / enrolled / pending
 *                         may NOT set public directly
 *                         may NOT change visibility once the classroom is public
 *                         (only an instructor/admin can demote a published classroom)
 */
export function canChangeVisibility(
  classroom: PersistedClassroomData,
  userId: string | null | undefined,
  userRole: string | null | undefined,
  newVisibility: ClassroomVisibility,
): { allowed: boolean; reason?: string } {
  if (userRole === 'admin') return { allowed: true };

  const isOwner = !!(userId && classroom.ownerId === userId);
  const isInstructor = userRole === 'instructor';
  const current = effectiveVisibility(classroom);

  // Instructor reviewer (non-owner) acting on a pending classroom
  if (isInstructor && !isOwner && current === 'pending') {
    if (newVisibility === 'public' || newVisibility === 'enrolled') return { allowed: true };
    return { allowed: false, reason: 'Reviewers may only approve (→ public) or reject (→ enrolled) pending classrooms' };
  }

  if (!isOwner) {
    return { allowed: false, reason: 'Only the classroom owner or an admin can change visibility' };
  }

  // Instructor owner — full authority, frictionless toggle
  if (isInstructor) return { allowed: true };

  // Student owner
  if (current === 'public') {
    return { allowed: false, reason: 'Once published, only an instructor or admin can adjust visibility' };
  }
  if (newVisibility === 'public') {
    return { allowed: false, reason: 'Students cannot publish directly. Set to "pending" to submit for instructor review.' };
  }
  return { allowed: true };
}

/**
 * Update a classroom's visibility field in place.
 * Sets pendingSince when transitioning to 'pending'; clears it on all other transitions.
 */
export async function updateClassroomVisibility(
  classroomId: string,
  newVisibility: ClassroomVisibility,
): Promise<PersistedClassroomData | null> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) return null;
  const updated: PersistedClassroomData = {
    ...classroom,
    visibility: newVisibility,
    pendingSince: newVisibility === 'pending'
      ? (classroom.pendingSince ?? new Date().toISOString())
      : undefined,
  };
  await writeJsonFileAtomic(path.join(CLASSROOMS_DIR, `${classroomId}.json`), updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export async function enrollUserInClassroom(classroomId: string, userId: string): Promise<boolean> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) return false;
  const enrolled = classroom.enrolledUserIds || [];
  if (enrolled.includes(userId)) return true;
  enrolled.push(userId);
  classroom.enrolledUserIds = enrolled;
  await writeJsonFileAtomic(path.join(CLASSROOMS_DIR, `${classroomId}.json`), classroom);
  return true;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listClassroomsForUser(
  userId: string | null | undefined,
  userRole: string | null | undefined,
): Promise<PersistedClassroomData[]> {
  await ensureClassroomsDir();
  const files = await fs.readdir(CLASSROOMS_DIR);
  const classrooms: PersistedClassroomData[] = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const content = await fs.readFile(path.join(CLASSROOMS_DIR, file), 'utf-8');
      const classroom = JSON.parse(content) as PersistedClassroomData;
      if (canViewClassroom(classroom, userId, userRole)) classrooms.push(classroom);
    } catch { /* skip corrupted files */ }
  }
  return classrooms.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
