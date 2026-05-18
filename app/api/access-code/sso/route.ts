import { NextRequest, NextResponse } from 'next/server';
import {
  JwtVerifyError,
  signHs256Jwt,
  verifyHs256Jwt,
  type JwtClaims,
} from '@/lib/sso/verify';
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

  const now = Math.floor(Date.now() / 1000);
  const sessionClaims: JwtClaims = {
    sub: launchClaims.sub,
    ...(launchClaims.name ? { name: launchClaims.name } : {}),
    ...(launchClaims.email ? { email: launchClaims.email } : {}),
    roles: launchClaims.roles ?? [],
    ...(launchClaims.tenant ? { tenant: launchClaims.tenant } : {}),
    ...(launchClaims.classroom ? { classroom: launchClaims.classroom } : {}),
    iat: now,
    exp: now + SSO_SESSION_TTL_SECONDS,
    jti: crypto.randomUUID(),
  };

  const sessionJwt = await signHs256Jwt(sessionClaims, secret);

  const requested = safeRedirectPath(searchParams.get('redirect'));
  const target =
    requested ??
    (launchClaims.classroom
      ? `/classroom/${encodeURIComponent(launchClaims.classroom)}`
      : '/');

  const response = NextResponse.redirect(new URL(target, origin));
  response.cookies.set(SSO_SESSION_COOKIE, sessionJwt, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SSO_SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
