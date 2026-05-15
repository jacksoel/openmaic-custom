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
 *   enrolled — enrolled users + owner + admin
 *   pending  — submitted for instructor/admin review; not in public catalog
 *   public   — discoverable in catalog; any authenticated user may self-enroll
 */
export type ClassroomVisibility = 'public' | 'enrolled' | 'private' | 'pending';

/**
 * Lifecycle states (orthogonal to visibility):
 *   active     — normal operation
 *   sunsetting — closing soon; enrolled users see a notice with optional successor link
 *   archived   — concluded; enrolled users retain read access; no new enrollments
 */
export type LifecycleState = 'active' | 'sunsetting' | 'archived';

/** Targets for the reset operation. Stage and scenes are never touched. */
export type ResetTarget = 'enrollments' | 'pendingState' | 'lifecycleState';

export interface LineageNode {
  id: string;
  name: string;
  lifecycleState: LifecycleState;
  cloneGeneration: number;
  createdAt: string;
  archivedAt?: string;
  children: LineageNode[];
}

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
  // Lifecycle
  lifecycleState?: LifecycleState;
  archivedAt?: string;
  sunsettingAt?: string;
  sunsettingMessage?: string;
  successorId?: string;
  // Lineage
  clonedFromId?: string;
  cloneGeneration?: number;
}

export function isValidClassroomId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

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
    lifecycleState: 'active',
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
 * Archived classrooms: only previously enrolled users, owner, and admin.
 * All other states: governed by visibility field.
 */
export function canViewClassroom(
  classroom: PersistedClassroomData,
  userId: string | null | undefined,
  userRole: string | null | undefined,
): boolean {
  if (userRole === 'admin') return true;
  if (userId && classroom.ownerId === userId) return true;

  // Archived: no new access beyond existing enrollment
  if (classroom.lifecycleState === 'archived') {
    return !!userId && !!(classroom.enrolledUserIds || []).includes(userId);
  }

  const visibility = effectiveVisibility(classroom);
  switch (visibility) {
    case 'public':   return !!userId;
    case 'enrolled': return !!userId && !!(classroom.enrolledUserIds || []).includes(userId);
    case 'pending':  return userRole === 'instructor';
    case 'private':  return false;
    default:         return false;
  }
}

export function canEditClassroom(
  classroom: PersistedClassroomData,
  userId: string | null | undefined,
  userRole: string | null | undefined,
): boolean {
  if (userRole === 'admin') return true;
  return !!(userId && classroom.ownerId === userId);
}

/**
 * Asymmetric visibility governance model.
 * Admin: unrestricted. Instructor owner: full authority. Instructor reviewer: approve/reject pending.
 * Student owner: private/enrolled/pending only; locked once public.
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

  if (isInstructor && !isOwner && current === 'pending') {
    if (newVisibility === 'public' || newVisibility === 'enrolled') return { allowed: true };
    return { allowed: false, reason: 'Reviewers may only approve (→ public) or reject (→ enrolled) pending classrooms' };
  }

  if (!isOwner) {
    return { allowed: false, reason: 'Only the classroom owner or an admin can change visibility' };
  }

  if (isInstructor) return { allowed: true };

  if (current === 'public') {
    return { allowed: false, reason: 'Once published, only an instructor or admin can adjust visibility' };
  }
  if (newVisibility === 'public') {
    return { allowed: false, reason: 'Students cannot publish directly. Set to "pending" to submit for instructor review.' };
  }
  return { allowed: true };
}

/**
 * Delete permission:
 *   Admin: any classroom in any state.
 *   Instructor (owner): own classrooms only, and only if lifecycleState === 'archived'.
 *   Students: never.
 */
export function canDeleteClassroom(
  classroom: PersistedClassroomData,
  userId: string | null | undefined,
  userRole: string | null | undefined,
): { allowed: boolean; reason?: string } {
  if (userRole === 'admin') return { allowed: true };

  const isOwner = !!(userId && classroom.ownerId === userId);
  if (!isOwner) {
    return { allowed: false, reason: 'Only the classroom owner or an admin can delete this classroom' };
  }
  if (userRole === 'instructor') {
    if (classroom.lifecycleState !== 'archived') {
      return { allowed: false, reason: 'Archive the classroom before deleting it' };
    }
    return { allowed: true };
  }
  return { allowed: false, reason: 'Students cannot delete classrooms' };
}

// ---------------------------------------------------------------------------
// Visibility update
// ---------------------------------------------------------------------------

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
// Lifecycle operations
// ---------------------------------------------------------------------------

export async function archiveClassroom(
  classroomId: string,
  opts: {
    sunsetting?: boolean;
    sunsettingAt?: string;
    sunsettingMessage?: string;
    successorId?: string;
  } = {},
): Promise<PersistedClassroomData | null> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) return null;
  const now = new Date().toISOString();
  const updated: PersistedClassroomData = {
    ...classroom,
    lifecycleState: opts.sunsetting ? 'sunsetting' : 'archived',
    archivedAt: opts.sunsetting ? undefined : now,
    sunsettingAt: opts.sunsetting ? (opts.sunsettingAt || now) : undefined,
    sunsettingMessage: opts.sunsetting ? (opts.sunsettingMessage || undefined) : undefined,
    successorId: opts.successorId ?? classroom.successorId,
  };
  await writeJsonFileAtomic(path.join(CLASSROOMS_DIR, `${classroomId}.json`), updated);
  return updated;
}

export async function cloneClassroom(
  sourceId: string,
  opts: { ownerId?: string; ownerRole?: string; ownerName?: string; baseUrl: string },
): Promise<(PersistedClassroomData & { url: string }) | null> {
  const source = await readClassroom(sourceId);
  if (!source) return null;

  const slug = (source.stage?.name || source.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  const newId = `${slug}-${Date.now().toString(36)}`;

  const cloneData: PersistedClassroomData = {
    id: newId,
    stage: { ...source.stage, id: newId },
    scenes: source.scenes,
    createdAt: new Date().toISOString(),
    ownerId: opts.ownerId ?? source.ownerId,
    ownerRole: opts.ownerRole ?? source.ownerRole,
    ownerName: opts.ownerName ?? source.ownerName,
    visibility: 'private',
    enrolledUserIds: [],
    classroomProviderConfig: source.classroomProviderConfig,
    lifecycleState: 'active',
    clonedFromId: sourceId,
    cloneGeneration: (source.cloneGeneration ?? 0) + 1,
  };

  await ensureClassroomsDir();
  await writeJsonFileAtomic(path.join(CLASSROOMS_DIR, `${newId}.json`), cloneData);
  return { ...cloneData, url: `${opts.baseUrl}/classroom/${newId}` };
}

export async function resetClassroom(
  classroomId: string,
  targets: ResetTarget[],
): Promise<PersistedClassroomData | null> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) return null;

  const updated: PersistedClassroomData = { ...classroom };
  if (targets.includes('enrollments'))    updated.enrolledUserIds = [];
  if (targets.includes('pendingState')) { updated.pendingSince = undefined; updated.visibility = 'enrolled'; }
  if (targets.includes('lifecycleState')) {
    updated.lifecycleState = 'active';
    updated.archivedAt = undefined;
    updated.sunsettingAt = undefined;
    updated.sunsettingMessage = undefined;
    updated.successorId = undefined;
  }

  await writeJsonFileAtomic(path.join(CLASSROOMS_DIR, `${classroomId}.json`), updated);
  return updated;
}

export async function deleteClassroom(classroomId: string): Promise<boolean> {
  const filePath = path.join(CLASSROOMS_DIR, `${classroomId}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export async function enrollUserInClassroom(classroomId: string, userId: string): Promise<boolean> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) return false;
  if (classroom.lifecycleState === 'archived') return false;
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

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

export async function getClassroomLineage(classroomId: string): Promise<LineageNode | null> {
  await ensureClassroomsDir();
  const files = await fs.readdir(CLASSROOMS_DIR);
  const all: PersistedClassroomData[] = [];

  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const content = await fs.readFile(path.join(CLASSROOMS_DIR, file), 'utf-8');
      all.push(JSON.parse(content) as PersistedClassroomData);
    } catch { /* skip */ }
  }

  const target = all.find(c => c.id === classroomId);
  if (!target) return null;

  // Walk up to root ancestor
  let root = target;
  const visited = new Set<string>();
  while (root.clonedFromId && !visited.has(root.id)) {
    visited.add(root.id);
    const parent = all.find(c => c.id === root.clonedFromId);
    if (!parent) break;
    root = parent;
  }

  function buildNode(c: PersistedClassroomData): LineageNode {
    return {
      id: c.id,
      name: c.stage?.name || c.id,
      lifecycleState: c.lifecycleState ?? 'active',
      cloneGeneration: c.cloneGeneration ?? 0,
      createdAt: c.createdAt,
      archivedAt: c.archivedAt,
      children: all
        .filter(x => x.clonedFromId === c.id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map(buildNode),
    };
  }

  return buildNode(root);
}
