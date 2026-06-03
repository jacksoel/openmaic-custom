import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  LAUNCH_AUDIENCE,
  LAUNCH_ISSUER,
  SESSION_COOKIE_NAME,
} from '@/lib/sso/claims';
import {
  buildSessionCookieOptions,
  mintSessionJwtFromLaunchPayload,
} from '@/lib/sso/cookies';
import { groupsToRoles, resolvePrimaryRole } from '@/lib/sso/groups';
import { isJtiRevoked, revokeJti } from '@/lib/sso/denylist';
import { verifyHs256Jwt } from '@/lib/sso/jwt';

function safeRedirectPath(redirectParam: string | null): string {
  const redirect = redirectParam?.trim() || '/';
  if (!redirect.startsWith('/') || redirect.startsWith('//')) {
    return '/';
  }
  return redirect;
}

function publicAppOrigin(request: NextRequest): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    '';
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const launchSecret = process.env.MAIC_LAUNCH_SECRET;
  if (!launchSecret) {
    return NextResponse.json(
      { success: false, error: 'SSO not configured (MAIC_LAUNCH_SECRET missing)' },
      { status: 503 },
    );
  }

  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json(
      { success: false, error: 'Missing token query parameter' },
      { status: 400 },
    );
  }

  const verified = verifyHs256Jwt(token, launchSecret);
  if (!verified.ok) {
    return NextResponse.json(
      { success: false, error: `Invalid launch token: ${verified.reason}` },
      { status: 401 },
    );
  }

  const payload = verified.payload;
  if (payload.iss !== LAUNCH_ISSUER || payload.aud !== LAUNCH_AUDIENCE) {
    return NextResponse.json(
      { success: false, error: 'Invalid launch token issuer or audience' },
      { status: 401 },
    );
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Launch token missing sub' },
      { status: 401 },
    );
  }

  const launchJti = typeof payload.jti === 'string' ? payload.jti : '';
  if (launchJti && isJtiRevoked(launchJti)) {
    return NextResponse.json(
      { success: false, error: 'Launch token already used or revoked' },
      { status: 401 },
    );
  }

  const space =
    payload.space && typeof payload.space === 'object'
      ? (payload.space as Record<string, unknown>)
      : {};
  const groups = Array.isArray(space.groups) ? space.groups.map(String) : [];
  const roles = groupsToRoles(groups);
  const primaryRole = resolvePrimaryRole(roles);

  const sessionToken = mintSessionJwtFromLaunchPayload(payload, launchSecret);
  const redirectPath = safeRedirectPath(request.nextUrl.searchParams.get('redirect'));

  if (launchJti) {
    revokeJti(launchJti);
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, buildSessionCookieOptions());

  const response = NextResponse.redirect(
    new URL(redirectPath, publicAppOrigin(request)),
    307,
  );
  response.headers.set('x-maic-role-resolved', primaryRole);
  return response;
}
