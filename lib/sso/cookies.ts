import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';
import {
  SESSION_AUDIENCE,
  SESSION_COOKIE_NAME,
  SESSION_ISSUER,
  SESSION_TTL_SECONDS,
} from '@/lib/sso/claims';
import { groupsToRoles } from '@/lib/sso/groups';
import { signHs256Jwt, type JwtPayload } from '@/lib/sso/jwt';
import { randomUUID } from 'crypto';

export const INTERNAL_TOKEN_HEADER = 'x-maic-internal-token';

export function buildSessionCookieOptions(): Partial<ResponseCookie> {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.MAIC_COOKIE_DOMAIN || undefined;
  const sameSiteEnv = process.env.MAIC_COOKIE_SAMESITE;
  const sameSite =
    sameSiteEnv === 'lax' || sameSiteEnv === 'strict' || sameSiteEnv === 'none'
      ? sameSiteEnv
      : 'none';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
    ...(process.env.MAIC_COOKIE_PARTITIONED === '1' ? { partitioned: true } : {}),
  };
}

export function mintSessionJwtFromLaunchPayload(launchPayload: JwtPayload, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const space =
    launchPayload.space && typeof launchPayload.space === 'object'
      ? (launchPayload.space as Record<string, unknown>)
      : {};
  const rawGroups = Array.isArray(space.groups) ? space.groups.map(String) : [];
  const roles = groupsToRoles(rawGroups);

  const sessionPayload: JwtPayload = {
    sub: String(launchPayload.sub),
    iss: SESSION_ISSUER,
    aud: SESSION_AUDIENCE,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: randomUUID(),
    sessionType: 'sso',
    roles,
    ...(launchPayload.name ? { name: String(launchPayload.name) } : {}),
    ...(launchPayload.email ? { email: String(launchPayload.email) } : {}),
    space: {
      ...(Array.isArray(space.groups) ? { groups: rawGroups } : {}),
      ...(space.sessionId ? { sessionId: String(space.sessionId) } : {}),
      ...(launchPayload.jti ? { launchJti: String(launchPayload.jti) } : {}),
    },
  };

  return signHs256Jwt(sessionPayload, secret);
}

export { SESSION_COOKIE_NAME };
