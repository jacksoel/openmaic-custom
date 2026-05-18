/**
 * JWT claim shape for the Space Agent ↔ OpenMAIC SSO bridge.
 *
 * Standard claims (RFC 7519):
 *   sub  — stable user id (Space Agent's username)
 *   iss  — issuer, expected to be EXPECTED_ISSUER below
 *   aud  — audience, expected to be EXPECTED_AUDIENCE below
 *   iat  — issued-at unix seconds
 *   exp  — expiry unix seconds
 *   jti  — unique token id (used for replay denylist)
 *   nbf? — not-before unix seconds (optional)
 *
 * Optional identity passthrough:
 *   name  — display name
 *   email — contact email
 *
 * Namespaced custom claims (under `space.*` to keep evolution clean):
 *   space.sessionId — the user's current Space Agent session id, useful
 *                     for back-channel revocation when Space Agent logs the
 *                     user out (Phase 4 work).
 *   space.groups    — raw Space Agent group names; OpenMAIC maps these to
 *                     roles at exchange time via lib/sso/groups.ts. Deliberately
 *                     un-mapped on the wire so the mapping table can evolve
 *                     in one place.
 *
 * The target classroom is NOT in the JWT — it rides in the validated
 * `?redirect=` query param at /api/access-code/sso. Keeps the launch token
 * generic; the same token works for any landing page in OpenMAIC.
 */

export interface SpaceClaims {
  sessionId?: string;
  groups?: string[];
}

export interface JwtClaims {
  sub: string;
  iss?: string;
  aud?: string | string[];
  iat: number;
  exp: number;
  nbf?: number;
  jti?: string;

  name?: string;
  email?: string;

  space?: SpaceClaims;
}

/** The issuer we expect on launch tokens. Validated when configured. */
export const EXPECTED_ISSUER = 'space-agent';

/** The audience we expect on launch tokens. Validated when configured. */
export const EXPECTED_AUDIENCE = 'openmaic';
