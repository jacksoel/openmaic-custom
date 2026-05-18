/**
 * Resolve an SSO session from request headers. Mirrors the contract of
 * the better-auth path in lib/auth.ts so getSessionUser() can compose
 * the two cleanly behind a single return shape.
 *
 * The SSO session cookie is itself an HS256 JWT (issued by
 * /api/access-code/sso after exchanging a short-lived launch JWT). On
 * every call we re-verify the signature, check exp/iat, validate iss/aud,
 * and consult the denylist. No DB round-trip.
 */

import { groupsToRoles } from './groups';
import { isRevoked } from './denylist';
import { verifyHs256Jwt } from './verify';
import { SSO_SESSION_COOKIE } from './cookies';

export interface SsoUser {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  institution: string | null;
  ssoGroups: string[];
  ssoSessionId: string | null;
  ssoJti: string | null;
  ssoIat: number;
  ssoExp: number;
}

function getCookie(headers: Headers, name: string): string | undefined {
  const raw = headers.get('cookie');
  if (!raw) return undefined;
  for (const pair of raw.split(';')) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq);
    if (k === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return undefined;
}

/**
 * Returns the SSO user if a valid, non-revoked openmaic_session cookie is
 * present. Returns null otherwise. Does NOT throw on verification failure —
 * the contract is "is this a logged-in SSO user, yes or no."
 */
export async function trySsoSession(headers: Headers): Promise<SsoUser | null> {
  const secret = process.env.MAIC_LAUNCH_SECRET;
  if (!secret) return null;

  const token = getCookie(headers, SSO_SESSION_COOKIE);
  if (!token) return null;

  let claims;
  try {
    claims = await verifyHs256Jwt(token, secret);
  } catch {
    return null;
  }

  if (isRevoked({ sub: claims.sub, jti: claims.jti, iat: claims.iat })) {
    return null;
  }

  const groups = claims.space?.groups ?? [];
  const roles = groupsToRoles(groups);

  return {
    id: claims.sub,
    email: claims.email ?? null,
    name: claims.name ?? null,
    role: roles[0] ?? 'student',
    institution: claims.iss ?? null,
    ssoGroups: groups,
    ssoSessionId: claims.space?.sessionId ?? null,
    ssoJti: claims.jti ?? null,
    ssoIat: claims.iat,
    ssoExp: claims.exp,
  };
}
