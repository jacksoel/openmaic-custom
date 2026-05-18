/**
 * /api/access-code/sso — Space Agent SSO landing endpoint.
 *
 * Exchanges a short-lived launch JWT (minted by Space Agent and signed with
 * the shared MAIC_LAUNCH_SECRET) for an 8h session JWT cookie. The launch
 * JWT carries identity in namespaced `space.*` claims; OpenMAIC applies the
 * group→role mapping locally before issuing the session.
 *
 * Flow:
 *   GET /api/access-code/sso?token=<launch-jwt>[&redirect=/classroom/<id>]
 *     1. Verify the launch JWT (signature, exp, iss, aud).
 *     2. Map space.groups to OpenMAIC roles via lib/sso/groups.ts.
 *     3. Issue a session JWT with sub/name/email/role/iss/aud, drop as
 *        openmaic_session httpOnly cookie.
 *     4. 307 redirect to the validated ?redirect path, or "/" if absent.
 *
 * The classroom is NOT in the JWT — it rides in `redirect` so the same
 * token shape works for any landing page.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  EXPECTED_AUDIENCE,
  EXPECTED_ISSUER,
  type JwtClaims,
} from '@/lib/sso/claims';
import { groupsToRoles } from '@/lib/sso/groups';
import { JwtVerifyError, signHs256Jwt, verifyHs256Jwt } from '@/lib/sso/verify';
import { SSO_SESSION_COOKIE, SSO_SESSION_TTL_SECONDS } from '@/lib/sso/cookies';

function badLaunch(reason: string, status = 401) {
  return NextResponse.json(
    {
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: `SSO launch failed: ${reason}`,
    },
    { status },
  );
}

/** Only allow same-origin absolute paths. Blocks scheme-relative `//evil`. */
function safeRedirectPath(input: string | null): string | null {
  if (!input) return null;
  if (!input.startsWith('/')) return null;
  if (input.startsWith('//') || input.startsWith('/\\')) return null;
  return input;
}

export async function GET(request: NextRequest) {
  const secret = process.env.MAIC_LAUNCH_SECRET;
  if (!secret) {
    return badLaunch('SSO not configured (MAIC_LAUNCH_SECRET missing)', 503);
  }

  const { searchParams, origin } = request.nextUrl;
  const token = searchParams.get('token');
  if (!token) return badLaunch('missing token', 400);

  let launchClaims: JwtClaims;
  try {
    launchClaims = await verifyHs256Jwt(token, secret);
  } catch (e) {
    const code = e instanceof JwtVerifyError ? e.code : 'INVALID';
    return badLaunch(code);
  }

  // Apply the group → role mapping. The launch token carries raw Space
  // Agent groups (space.groups); we own the mapping table.
  const roles = groupsToRoles(launchClaims.space?.groups);

  const now = Math.floor(Date.now() / 1000);
  const sessionClaims: JwtClaims = {
    sub: launchClaims.sub,
    iss: EXPECTED_ISSUER,
    aud: EXPECTED_AUDIENCE,
    iat: now,
    exp: now + SSO_SESSION_TTL_SECONDS,
    jti: crypto.randomUUID(),
    ...(launchClaims.name ? { name: launchClaims.name } : {}),
    ...(launchClaims.email ? { email: launchClaims.email } : {}),
    // Carry forward the namespaced custom claims so trySsoSession() can
    // surface groups + sessionId without re-querying Space Agent.
    space: {
      ...(launchClaims.space?.sessionId
        ? { sessionId: launchClaims.space.sessionId }
        : {}),
      groups: launchClaims.space?.groups ?? [],
    },
  };

  const sessionJwt = await signHs256Jwt(sessionClaims, secret);

  const target = safeRedirectPath(searchParams.get('redirect')) ?? '/';

  const response = NextResponse.redirect(new URL(target, origin));
  response.cookies.set(SSO_SESSION_COOKIE, sessionJwt, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SSO_SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });

  // Useful for debugging: roles result is non-secret and helps verify
  // the group mapping landed as expected.
  response.headers.set('x-maic-role-resolved', roles.join(','));

  return response;
}
