import { NextRequest, NextResponse } from 'next/server';
import { verifyHs256Jwt, type JwtClaims } from '@/lib/sso/verify';
import {
  LEGACY_ACCESS_COOKIE,
  SSO_INJECTED_HEADERS,
  SSO_SESSION_COOKIE,
} from '@/lib/sso/cookies';
import { isRevoked } from '@/lib/sso/denylist';

// Node runtime so the in-process denylist Map (anchored on globalThis) is
// shared between this middleware and the /api/access-code/revoke handler.
// Without this, Edge runtime sandboxes the module graph and revokes would
// never be visible to verifying requests.
export const runtime = 'nodejs';

function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify the legacy single-secret ACCESS_CODE cookie (timestamp.signature). */
async function verifyLegacyToken(token: string, accessCode: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const keyData = encode(accessCode);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = encode(timestamp);
  const expected = bufToHex(
    await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer),
  );

  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Strip headers that only the SSO middleware is allowed to set. */
function stripSpoofableHeaders(request: NextRequest): Headers {
  const cleaned = new Headers(request.headers);
  for (const h of SSO_INJECTED_HEADERS) cleaned.delete(h);
  return cleaned;
}

function injectIdentity(headers: Headers, claims: JwtClaims): Headers {
  const out = new Headers(headers);
  out.set('x-maic-user', claims.sub);
  if (claims.name) out.set('x-maic-name', claims.name);
  if (claims.email) out.set('x-maic-email', claims.email);
  if (claims.roles && claims.roles.length > 0) {
    out.set('x-maic-roles', claims.roles.join(','));
  }
  if (claims.tenant) out.set('x-maic-tenant', claims.tenant);
  if (claims.classroom) out.set('x-maic-classroom', claims.classroom);
  if (claims.courses && claims.courses.length > 0) {
    out.set('x-maic-courses', claims.courses.join(','));
  }
  return out;
}

function passThrough(headers: Headers): NextResponse {
  return NextResponse.next({ request: { headers } });
}

export async function middleware(request: NextRequest) {
  const accessCode = process.env.ACCESS_CODE;
  const ssoSecret = process.env.MAIC_LAUNCH_SECRET;

  // Always strip spoofable identity headers, even in open mode.
  const cleanHeaders = stripSpoofableHeaders(request);

  if (!accessCode && !ssoSecret) {
    return passThrough(cleanHeaders);
  }

  const { pathname } = request.nextUrl;

  // Whitelist: access-code endpoints (sso, verify, status, logout, revoke)
  // and health. Revoke is also gated by its own internal-token check.
  if (pathname.startsWith('/api/access-code/') || pathname === '/api/health') {
    return passThrough(cleanHeaders);
  }

  // 1. SSO session cookie (preferred when MAIC_LAUNCH_SECRET is set).
  if (ssoSecret) {
    const session = request.cookies.get(SSO_SESSION_COOKIE)?.value;
    if (session) {
      try {
        const claims = await verifyHs256Jwt(session, ssoSecret);
        if (!isRevoked({ sub: claims.sub, jti: claims.jti, iat: claims.iat })) {
          return passThrough(injectIdentity(cleanHeaders, claims));
        }
        // Revoked: fall through to legacy / unauth (and the stale cookie
        // will be replaced or cleared on next sign-in / logout).
      } catch {
        // Fall through to legacy or unauthenticated handling.
      }
    }
  }

  // 2. Legacy ACCESS_CODE cookie.
  if (accessCode) {
    const cookie = request.cookies.get(LEGACY_ACCESS_COOKIE)?.value;
    if (cookie && (await verifyLegacyToken(cookie, accessCode))) {
      return passThrough(cleanHeaders);
    }
  }

  // No valid auth.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        success: false,
        errorCode: 'INVALID_REQUEST',
        error: 'Authentication required',
      },
      { status: 401 },
    );
  }

  // Page requests fall through to the app so the existing access-code modal
  // (or, in the SSO-only case, a future "launch from Space Agent" prompt) can
  // render. This preserves the prior UX for legacy deployments.
  return passThrough(cleanHeaders);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
