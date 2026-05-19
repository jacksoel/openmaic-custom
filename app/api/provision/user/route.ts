/**
 * POST /api/provision/user — server-to-server identity provisioning.
 *
 * Authenticated by the same shared bearer as /api/access-code/revoke:
 * X-Maic-Internal-Token must match MAIC_INTERNAL_TOKEN (constant-time
 * compare). The public Caddy/Nginx config strips the header at the edge
 * so authenticated callers can only reach this over the colony Docker
 * network.
 *
 * Called by Space Agent after every successful completeLogin() /
 * issueSessionForUser() (see patches/maic-provisioning.js in
 * space-agent-bootstrap). Idempotent — safe to retry, safe to call on
 * every login. The request body carries the user's canonical email plus
 * any legacy ids (Space Agent username, Firebase-style classroom hashes)
 * that should resolve to the same canonical row.
 *
 * Body:
 *   {
 *     canonicalEmail: "instructor@school.edu",      // REQUIRED
 *     username?:      "instructor@school.edu",      // legacy id
 *     name?:          "Inst Ructor",
 *     groups?:        ["_instructor"],
 *     legacyIds?:     ["zTctgRPUQ6gQ..."]           // additional legacy ids
 *   }
 *
 * Response (200): { user: CanonicalUser }
 * Response (401): X-Maic-Internal-Token mismatch
 * Response (503): MAIC_INTERNAL_TOKEN not configured
 */

import { NextRequest } from 'next/server';
import { upsertCanonical } from '@/lib/sso/identity-map';
import { INTERNAL_TOKEN_HEADER } from '@/lib/sso/cookies';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { initAuthDb } from '@/lib/server/auth-db';

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

let _tablesEnsured = false;
function ensureTables(): void {
  if (_tablesEnsured) return;
  initAuthDb(); // idempotent CREATE TABLE IF NOT EXISTS
  _tablesEnsured = true;
}

export async function POST(request: NextRequest) {
  const expected = process.env.MAIC_INTERNAL_TOKEN;
  if (!expected) {
    return apiError('INVALID_REQUEST', 503, 'Provisioning not configured');
  }

  const provided = request.headers.get(INTERNAL_TOKEN_HEADER);
  if (!provided || !constantTimeEqual(provided, expected)) {
    return apiError('INVALID_REQUEST', 401, 'Unauthorized');
  }

  let body: {
    canonicalEmail?: string;
    username?: string;
    name?: string;
    groups?: string[];
    legacyIds?: string[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  if (!body.canonicalEmail || typeof body.canonicalEmail !== 'string') {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'canonicalEmail required');
  }

  ensureTables();

  // Append the Space Agent username as a legacy id whenever it differs
  // from canonical — that's the join point for any existing classroom
  // record that was created keyed by username.
  const legacyIds = [...(body.legacyIds ?? [])];
  if (
    body.username &&
    body.username !== body.canonicalEmail &&
    !legacyIds.includes(body.username)
  ) {
    legacyIds.push(body.username);
  }

  const user = upsertCanonical({
    canonicalEmail: body.canonicalEmail,
    name: body.name,
    groups: body.groups,
    legacyIds,
  });

  return apiSuccess({ user });
}
