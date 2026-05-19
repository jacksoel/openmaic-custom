/**
 * OpenMAIC Auth Middleware
 *
 * Flow:
 * 1. If neither auth system is enabled, pass through
 * 2. Always allow public paths (auth pages, health, assets)
 * 3. AUTH_ENABLED mode: check better-auth session cookie OR SSO cookie
 * 4. ACCESS_CODE mode: verify HMAC-signed cookie with Web Crypto
 *
 * Identity is NOT injected as request headers (that pattern breaks Next.js
 * route resolution in some versions). Route handlers resolve identity
 * via getSessionUser() directly. Upstream SSO x-maic-* headers pass through
 * unmodified for handlers that want them as fallback.
 */

import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/api/auth',         // better-auth endpoints
  '/api/health',       // health check
  '/api/whoami',       // debug identity endpoint
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/api/access-code',  // SSO launch + legacy access-code endpoints
  '/api/provision',    // server-to-server identity provisioning (internal-token gated)
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(path => pathname.startsWith(path));
}

/**
 * Presence check only — full session validation happens in API route handlers
 * via getSessionUser(). Middleware keeps latency low by avoiding a DB round-trip
 * (or a JWT verify) on every request; an expired/tampered/revoked cookie is
 * caught at the handler layer.
 *
 * Recognises both better-auth session cookies (native multi-user auth) and
 * the openmaic_session cookie (Space Agent SSO bridge). Either is enough to
 * pass through; getSessionUser() then prefers native over SSO if both exist.
 */
function hasSessionCookie(request: NextRequest): boolean {
  const names = [
    '__Secure-better-auth.session_token',
    'better-auth.session_token',
    '__Secure-better-auth.session_data',
    'better-auth.session_data',
    'openmaic_session', // SSO launch-token session (lib/sso/cookies.ts)
  ];
  return names.some(name => !!request.cookies.get(name)?.value);
}

/**
 * Verify an HMAC-signed openmaic_access cookie using Web Crypto (Edge-compatible).
 * Token format: `${timestamp}.${hex-signature}`
 * Signature  = HMAC-SHA256(key=accessCode, data=timestamp)
 * Tokens older than 7 days are rejected regardless of signature validity.
 */
async function verifyAccessToken(token: string, accessCode: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const hexSig    = token.substring(dotIndex + 1);

  // Reject non-numeric or expired timestamps
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Date.now() - ts > 7 * 24 * 60 * 60 * 1000) return false;

  // Decode hex signature to bytes
  if (hexSig.length === 0 || hexSig.length % 2 !== 0) return false;
  const sigBytes = new Uint8Array(hexSig.length / 2);
  for (let i = 0; i < hexSig.length; i += 2) {
    const byte = parseInt(hexSig.substring(i, i + 2), 16);
    if (isNaN(byte)) return false;
    sigBytes[i / 2] = byte;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(accessCode),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const data  = enc.encode(timestamp);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);
  return valid;
}

export async function middleware(request: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const accessCode  = process.env.ACCESS_CODE;

  if (!authEnabled && !accessCode) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // ---- AUTH_ENABLED mode: session-based auth (native or SSO) ----------------
  if (authEnabled) {
    if (hasSessionCookie(request)) {
      // Session cookie present — pass through. Route handlers resolve
      // identity via getSessionUser() directly. Upstream SSO x-maic-*
      // headers pass through unmodified (Next.js forwards all request
      // headers to route handlers by default).
      return NextResponse.next();
    }

    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, errorCode: 'UNAUTHORIZED', error: 'Authentication required' },
        { status: 401 },
      );
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ---- ACCESS_CODE mode: HMAC-verified cookie --------------------------------
  if (accessCode) {
    const cookie = request.cookies.get('openmaic_access');
    if (cookie?.value && await verifyAccessToken(cookie.value, accessCode)) {
      // Access code valid — pass through.
      return NextResponse.next();
    }

    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
        { status: 401 },
      );
    }

    // Page request — let the frontend render the access-code modal
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
