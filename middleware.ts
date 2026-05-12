/**
 * OpenMAIC Auth Middleware
 *
 * Replaces the ACCESS_CODE HMAC middleware with proper session-based auth.
 * 
 * Flow:
 * 1. If AUTH_ENABLED is not set, pass through (backward compat)
 * 2. Check for valid better-auth session cookie
 * 3. Whitelist: /api/auth/*, /api/health, auth pages
 * 4. API routes without auth → 401
 * 5. Page requests without auth → redirect to /login
 */

import { NextRequest, NextResponse } from 'next/server';

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/api/auth',      // Auth endpoints (login, register, session)
  '/api/health',    // Health check
  '/login',         // Login page
  '/register',      // Registration page
  '/forgot-password',  // Password reset request (must be accessible without session)
  '/reset-password',   // Password reset confirm (must be accessible without session)
  '/api/access-code', // Legacy access code (will be removed later)
];

// Paths that are assets and should pass through
const ASSET_PREFIXES = [
  '/_next/static',
  '/_next/image',
  '/favicon.ico',
  '/logos/',
];

function isPublicPath(pathname: string): boolean {
  if (ASSET_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return true;
  }
  return PUBLIC_PATHS.some(path => pathname.startsWith(path));
}

/**
 * Check for better-auth session cookie.
 * The cookie name varies based on the base URL:
 * - HTTPS: __Secure-better-auth.session_token
 * - HTTP: better-auth.session_token
 * Also check for the session_data variant (cache cookie).
 */
function hasSessionCookie(request: NextRequest): boolean {
  const possibleNames = [
    '__Secure-better-auth.session_token',
    'better-auth.session_token',
    '__Secure-better-auth.session_data',
    'better-auth.session_data',
  ];

  return possibleNames.some(name => {
    const cookie = request.cookies.get(name);
    return !!cookie?.value;
  });
}

export async function middleware(request: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const accessCode = process.env.ACCESS_CODE;

  // If neither auth system is enabled, pass through
  if (!authEnabled && !accessCode) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Always allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // ---- AUTH_ENABLED mode: session-based auth ----
  if (authEnabled) {
    if (hasSessionCookie(request)) {
      // Session cookie exists — let it through
      // (better-auth validates the session on the server side in API routes)
      return NextResponse.next();
    }

    // No session cookie
    // API routes → 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, errorCode: 'UNAUTHORIZED', error: 'Authentication required' },
        { status: 401 },
      );
    }

    // Page requests → redirect to login
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ---- ACCESS_CODE mode: legacy HMAC auth (unchanged) ----
  if (accessCode) {
    const cookie = request.cookies.get('openmaic_access');
    if (cookie?.value) {
      const parts = cookie.value.split('.');
      if (parts.length === 2 && parts[0] && parts[1]) {
        return NextResponse.next();
      }
    }

    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
        { status: 401 },
      );
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
