/**
 * OpenMAIC Authentication — better-auth + SQLite
 */

export type { Role }     from './auth-types';
export type { AuthUser } from './auth-types';

import type { Role } from './auth-types';
import { verifyHs256Jwt } from './sso/jwt';
import {
  SESSION_AUDIENCE,
  SESSION_COOKIE_NAME,
  SESSION_ISSUER,
} from './sso/claims';

// ---------------------------------------------------------------------------
// Singleton promise — prevents concurrent initialisation races.
// On failure the promise is cleared so the next call can retry.
// ---------------------------------------------------------------------------

let _authPromise: Promise<any> | null = null;

export async function getAuth() {
  if (!_authPromise) {
    _authPromise = (async () => {
      const secret = process.env.BETTER_AUTH_SECRET;
      if (!secret) {
        throw new Error(
          '[Auth] BETTER_AUTH_SECRET is required but not set. ' +
          'Generate one with: openssl rand -base64 32',
        );
      }

      const { betterAuth } = await import('better-auth');
      const { nextCookies } = await import('better-auth/next-js');
      const { getDb }       = await import('@/lib/server/auth-db');

      const appUrl = process.env.NEXT_PUBLIC_APP_URL;

      // Build trusted origins from env — no hardcoded domains.
      const trustedOrigins: string[] = [];
      if (appUrl) trustedOrigins.push(appUrl);
      const extraOrigins = process.env.TRUSTED_ORIGINS;
      if (extraOrigins) {
        trustedOrigins.push(...extraOrigins.split(',').map(o => o.trim()).filter(Boolean));
      }
      if (process.env.NODE_ENV !== 'production') {
        trustedOrigins.push('http://localhost:3000', 'http://localhost:3001');
      }

      const auth = betterAuth({
        secret,
        baseURL: process.env.BETTER_AUTH_URL || appUrl || 'http://localhost:3001',
        database: getDb(),
        emailAndPassword: {
          enabled: true,
          minPasswordLength: 8,
          sendResetPassword: async ({ user, url }: { user: { email: string; name?: string }; url: string }) => {
            console.log('[Auth] Password reset requested for:', user.email);
            const hasResend = !!process.env.RESEND_API_KEY;
            if (!hasResend) {
              // No email provider configured — log the link so it isn't silently lost.
              console.warn('[Auth] RESEND_API_KEY not set. Reset URL (expires in 1h):');
              console.warn('[Auth] Reset link:', url);
              return;
            }
            try {
              const { sendPasswordResetEmail } = await import('@/lib/email/resend');
              await sendPasswordResetEmail(user.email, url, user.name || undefined);
            } catch (err) {
              console.error('[Auth] Failed to send reset email:', err);
              console.warn('[Auth] Reset URL (expires in 1h):', url);
            }
          },
        },
        emailVerification: { sendOnSignUp: false },
        session: {
          expiresIn:   60 * 60 * 24 * 7,
          updateAge:   60 * 60 * 24,
          cookieCache: { enabled: true, maxAge: 60 * 5 },
        },
        advanced: {
          cookiePrefix:    'better-auth',
          useSecureCookies: process.env.SECURE_COOKIES === 'true',
        },
        user: {
          additionalFields: {
            role:        { type: 'string', defaultValue: 'student', required: false },
            institution: { type: 'string', required: false },
          },
        },
        plugins: [
          nextCookies(),
          (await import('better-auth/plugins/admin')).admin(),
        ],
        trustedOrigins,
      });

      console.log('[Auth] better-auth initialized');
      return auth;
    })();

    _authPromise.catch(() => { _authPromise = null; });
  }
  return _authPromise;
}

// ---------------------------------------------------------------------------
// Role helpers
// ---------------------------------------------------------------------------

// Normalise better-auth default role ('user') to the app vocabulary ('student').
function normalizeRole(role: string | undefined): string {
  return role === 'user' ? 'student' : (role || 'student');
}

export function isInstructorOrAbove(user: { role?: string } | null): boolean {
  if (!user) return false;
  const r = normalizeRole(user.role);
  return r === 'admin' || r === 'instructor';
}

export function isAdmin(user: { role?: string } | null): boolean {
  return !!user && normalizeRole(user.role) === 'admin';
}

// ---------------------------------------------------------------------------
// Email domain allowlist (server-only)
// ---------------------------------------------------------------------------

export function isAllowedEmailDomain(email: string): boolean {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS;
  // If the env var is not set, do not restrict by domain.
  if (!raw || raw.trim() === '') return true;

  const allowed = raw.split(',').map(d => d.trim().toLowerCase());
  if (allowed.includes('*')) return true;

  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && allowed.includes(domain);
}

// ---------------------------------------------------------------------------
// Session helper (server-only)
// ---------------------------------------------------------------------------

export async function getSessionUser(req: { headers: Headers }) {
  if (process.env.AUTH_ENABLED !== 'true') return null;

  const auth    = await getAuth();
  const headers = req.headers instanceof Headers
    ? req.headers
    : new Headers(req.headers as Record<string, string>);

  try {
    const session = await auth.api.getSession({ headers });
    if (session?.user) return session.user;
  } catch (err) {
    console.error('[Auth] getSessionUser error:', err);
  }

  // SSO fallback: Space Agent launches set an `openmaic_session` HS256 JWT that
  // better-auth never issues or sees. Honor it here so SSO users satisfy the
  // same getSessionUser() contract (id/email/name/role) as native users.
  return getSsoSessionUser(headers);
}

function readCookieValue(cookieHeader: string, cookieName: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === cookieName) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function getSsoSessionUser(headers: Headers) {
  const launchSecret = process.env.MAIC_LAUNCH_SECRET;
  if (!launchSecret) return null;

  const sessionToken = readCookieValue(headers.get('cookie') || '', SESSION_COOKIE_NAME);
  if (!sessionToken) return null;

  const verified = verifyHs256Jwt(sessionToken, launchSecret);
  if (!verified.ok) return null;

  const payload = verified.payload;
  if (payload.iss !== SESSION_ISSUER || payload.aud !== SESSION_AUDIENCE) return null;
  if (!payload.sub || typeof payload.sub !== 'string') return null;

  const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
  const role = normalizeRole(roles[0]) as Role;
  const name = typeof payload.name === 'string' && payload.name ? payload.name : payload.sub;
  const email = typeof payload.email === 'string' ? payload.email : '';

  return {
    id: payload.sub,
    email,
    name,
    role,
    sessionType: 'sso' as const,
  };
}
