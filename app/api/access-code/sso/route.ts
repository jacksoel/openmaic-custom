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
 *
 * Cookie scope (cross-origin iframe support):
 *   MAIC_COOKIE_DOMAIN       optional, e.g. ".coachingthegist.com" — makes the
 *                            session cookie available across subdomains so it
 *                            stops being treated as a third-party cookie when
 *                            Space Agent embeds the classroom in an iframe.
 *   MAIC_COOKIE_SAMESITE     "lax" | "none" | "strict". Defaults to "none"
 *                            when COOKIE_DOMAIN is set (cross-site iframes
 *                            require it), otherwise "lax".
 *   MAIC_COOKIE_PARTITIONED  "true" opts the cookie into Chrome's CHIPS
 *                            partitioned storage. Defaults to true when
 *                            COOKIE_DOMAIN is set, otherwise false.
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

type SameSite = 'lax' | 'none' | 'strict';

interface CookieAttrs {
  domain?: string;
  sameSite: SameSite;
  partitioned: boolean;
  secure: boolean;
}

/**
 * Resolve cookie attributes from env. When MAIC_COOKIE_DOMAIN is set,
 * SameSite auto-flips to 'none' and Secure is forced (browsers refuse to
 * accept SameSite=None without Secure). Each value can be overridden via
 * its own env var.
 */
function resolveCookieAttrs(): CookieAttrs {
  const domain = process.env.MAIC_COOKIE_DOMAIN?.trim() || undefined;

  const explicitSameSite = process.env.MAIC_COOKIE_SAMESITE?.trim().toLowerCase();
  const sameSite: SameSite =
    explicitSameSite === 'none' || explicitSameSite === 'lax' || explicitSameSite === 'strict'
      ? (explicitSameSite as SameSite)
      : domain
        ? 'none'
        : 'lax';

  const explicitPartitioned = process.env.MAIC_COOKIE_PARTITIONED?.trim().toLowerCase();
  const partitioned =
    explicitPartitioned === 'true'
      ? true
      : explicitPartitioned === 'false'
        ? false
        : !!domain;

  // Secure is required when SameSite=None or when Partitioned is set.
  // In production we always want it; in dev we still need it whenever the
  // cross-site cookie path is active.
  const secure =
    process.env.NODE_ENV === 'production' || sameSite === 'none' || partitioned;

  return { domain, sameSite, partitioned, secure };
}

function sameSiteToken(s: SameSite): 'Lax' | 'None' | 'Strict' {
  return s === 'none' ? 'None' : s === 'strict' ? 'Strict' : 'Lax';
}

/**
 * Set the session cookie. NextResponse.cookies.set() doesn't expose the
 * `Partitioned` attribute, so we build the Set-Cookie header manually when
 * Partitioned is requested. The common (non-Partitioned) path uses the
 * typed API and stays linter-friendly.
 */
function setSessionCookie(
  response: NextResponse,
  value: string,
  ttlSeconds: number,
): void {
  const attrs = resolveCookieAttrs();

  if (!attrs.partitioned) {
    response.cookies.set(SSO_SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: attrs.sameSite,
      path: '/',
      maxAge: ttlSeconds,
      secure: attrs.secure,
      ...(attrs.domain ? { domain: attrs.domain } : {}),
    });
    return;
  }

  const parts: string[] = [
    `${SSO_SESSION_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${ttlSeconds}`,
    'HttpOnly',
    `SameSite=${sameSiteToken(attrs.sameSite)}`,
  ];
  if (attrs.secure) parts.push('Secure');
  if (attrs.domain) parts.push(`Domain=${attrs.domain}`);
  parts.push('Partitioned');

  response.headers.append('Set-Cookie', parts.join('; '));
}

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

  const { searchParams } = request.nextUrl;
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

  // Use NEXT_PUBLIC_APP_URL for the redirect origin instead of request.nextUrl.origin.
  // When the app runs behind a reverse proxy (Caddy), the request origin is the
  // container-internal address (http://0.0.0.0:3001) which is unreachable from browsers.
  // NEXT_PUBLIC_APP_URL is the canonical public URL (https://maic.colony5148351.ai).
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const target = safeRedirectPath(searchParams.get('redirect')) ?? '/';

  const response = NextResponse.redirect(new URL(target, appOrigin));

  setSessionCookie(response, sessionJwt, SSO_SESSION_TTL_SECONDS);

  // Useful for debugging: roles result is non-secret and helps verify
  // the group mapping landed as expected.
  response.headers.set('x-maic-role-resolved', roles.join(','));

  return response;
}
