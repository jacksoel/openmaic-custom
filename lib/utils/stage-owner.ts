'use client';

/**
 * Resolves the authenticated user id (JWT sub / canonical email) for IndexedDB
 * stage partitioning. Uses /api/whoami which reads the session cookie only.
 */
export type SessionIdentity = {
  ownerId?: string;
  isAdmin: boolean;
};

let cachedOwnerId: string | null | undefined;
let cachedSessionIdentity: SessionIdentity | null | undefined;

export function clearCachedOwnerId(): void {
  cachedOwnerId = undefined;
  cachedSessionIdentity = undefined;
}

type WhoamiBody = {
  authenticated?: boolean;
  user?: string | null;
  roles?: string[] | null;
};

async function fetchWhoamiBody(): Promise<WhoamiBody | null> {
  try {
    const response = await fetch('/api/whoami', { credentials: 'include' });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as WhoamiBody;
  } catch {
    return null;
  }
}

export async function resolveSessionIdentity(): Promise<SessionIdentity> {
  if (cachedSessionIdentity !== undefined && cachedSessionIdentity !== null) {
    return cachedSessionIdentity;
  }

  const body = await fetchWhoamiBody();
  if (!body?.authenticated) {
    cachedOwnerId = null;
    cachedSessionIdentity = { isAdmin: false };
    return cachedSessionIdentity;
  }

  const roles = Array.isArray(body.roles) ? body.roles : [];
  const isAdmin = roles.includes('admin');
  const ownerId = body.user ?? undefined;

  cachedOwnerId = ownerId ?? null;
  cachedSessionIdentity = { ownerId, isAdmin };
  return cachedSessionIdentity;
}

export async function resolveCurrentOwnerId(): Promise<string | undefined> {
  const session = await resolveSessionIdentity();
  return session.ownerId;
}
