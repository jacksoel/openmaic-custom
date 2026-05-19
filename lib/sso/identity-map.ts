/**
 * Phase 5a identity map.
 *
 * Both Space Agent and OpenMAIC agree on a single canonical user id (the
 * user's email, normalised to lowercase). Existing OpenMAIC records keyed
 * by Firebase-style hashes or raw Space Agent usernames are mapped to that
 * canonical id via user_legacy_id, so lookups by either form resolve to
 * the same canonical row.
 *
 * The public surface is intentionally tiny:
 *   resolveCanonical(input)   → canonical email (or input unchanged when unknown)
 *   getCanonicalUser(email)   → row, or null
 *   upsertCanonical(input)    → idempotent create-or-update keyed by email
 *
 * The provisioning endpoint (app/api/provision/user/route.ts) is the only
 * caller of upsertCanonical; trySsoSession() and downstream classroom
 * resolution call resolveCanonical / getCanonicalUser on each request.
 */

import { getDb } from '@/lib/server/auth-db';

export interface CanonicalUser {
  canonicalEmail: string;
  name: string | null;
  groups: string[];
  provisionedAt: string;
  updatedAt: string;
}

export interface UpsertInput {
  canonicalEmail: string;
  name?: string | null;
  groups?: string[];
  legacyIds?: string[];
}

function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

function safeParseArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve any id (canonical email or known legacy id) to its canonical
 * email. Returns the input unchanged when no mapping is known, so callers
 * can safely chain through it during the transition period before all
 * users have been provisioned.
 */
export function resolveCanonical(input: string | null | undefined): string {
  if (!input) return '';
  const db = getDb();

  // Try canonical (lowercased) first.
  const lowered = normaliseEmail(input);
  const direct = db
    .prepare('SELECT canonical_email FROM user_identity_map WHERE canonical_email = ?')
    .get(lowered) as { canonical_email: string } | undefined;
  if (direct) return direct.canonical_email;

  // Fall back to legacy id lookup (case-sensitive — legacy ids may be
  // hashes or usernames where case matters).
  const legacy = db
    .prepare('SELECT canonical_email FROM user_legacy_id WHERE legacy_id = ?')
    .get(input) as { canonical_email: string } | undefined;
  if (legacy) return legacy.canonical_email;

  return input;
}

export function getCanonicalUser(canonicalEmail: string): CanonicalUser | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT canonical_email, name, groups, provisioned_at, updated_at
       FROM user_identity_map WHERE canonical_email = ?`,
    )
    .get(normaliseEmail(canonicalEmail)) as
    | {
        canonical_email: string;
        name: string | null;
        groups: string;
        provisioned_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;
  return {
    canonicalEmail: row.canonical_email,
    name: row.name,
    groups: safeParseArray(row.groups),
    provisionedAt: row.provisioned_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Idempotent upsert. Re-running with the same canonicalEmail updates
 * name + groups and bumps updated_at. legacyIds are appended (INSERT OR
 * IGNORE) — never removed, since a legacy id might be referenced by an
 * existing classroom record.
 */
export function upsertCanonical(input: UpsertInput): CanonicalUser {
  const db = getDb();
  const email = normaliseEmail(input.canonicalEmail);
  if (!email) throw new Error('upsertCanonical: canonicalEmail is required');

  const groupsJson = JSON.stringify(input.groups ?? []);

  db.prepare(
    `INSERT INTO user_identity_map (canonical_email, name, groups, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (canonical_email) DO UPDATE SET
       name = COALESCE(excluded.name, user_identity_map.name),
       groups = excluded.groups,
       updated_at = datetime('now')`,
  ).run(email, input.name ?? null, groupsJson);

  if (input.legacyIds && input.legacyIds.length > 0) {
    const insertLegacy = db.prepare(
      `INSERT OR IGNORE INTO user_legacy_id (legacy_id, canonical_email) VALUES (?, ?)`,
    );
    const tx = db.transaction((ids: string[]) => {
      for (const id of ids) {
        if (id && id !== email) insertLegacy.run(id, email);
      }
    });
    tx(input.legacyIds);
  }

  const out = getCanonicalUser(email);
  if (!out) throw new Error('upsertCanonical: read-back failed');
  return out;
}
