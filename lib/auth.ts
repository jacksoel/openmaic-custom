/**
 * OpenMAIC Authentication — better-auth + SQLite
 *
 * Phase 1: Identity + Roles
 * Phase 3+: Per-user providers (user_providers table)
 * Phase 4+: Usage logging (usage_logs table)
 */

import type { Role } from './auth-types';

// Re-export types
export type { Role } from './auth-types';
export type { AuthUser } from './auth-types';

// ---------------------------------------------------------------------------
// Lazy auth instance (only created when AUTH_ENABLED=true)
// ---------------------------------------------------------------------------

let _auth: any = null;

export async function getAuth() {
  if (!_auth) {
    const { betterAuth } = await import('better-auth');
    const { nextCookies } = await import('better-auth/next-js');
    // Use the shared DB connection from auth-db (avoids two open handles to the same file).
    const { getDb } = await import('@/lib/server/auth-db');
    const sqliteDb = getDb();

    _auth = betterAuth({
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
      database: sqliteDb,
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        // better-auth only enables reset when sendResetPassword lives on emailAndPassword (not emailVerification)
        sendResetPassword: async ({ user, url }) => {
          console.log('[Auth] Password reset requested for:', user.email);
          try {
            const { sendPasswordResetEmail } = await import('@/lib/email/resend');
            await sendPasswordResetEmail(user.email, url, user.name || undefined);
            console.log('[Auth] Reset email sent to:', user.email);
          } catch (err) {
            console.error('[Auth] Failed to send reset email:', err);
          }
        },
      },
      emailVerification: {
        sendOnSignUp: false,
      },
      session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
        cookieCache: {
          enabled: true,
          maxAge: 60 * 5,
        },
      },
      advanced: {
        cookiePrefix: 'better-auth',
        useSecureCookies: process.env.SECURE_COOKIES === 'true',
      },
      user: {
        additionalFields: {
          role: {
            type: 'string',
            // Store 'student' as the canonical default (not 'user') so DB values
            // match the role vocabulary used throughout the app without normalization.
            defaultValue: 'student',
            required: false,
          },
          institution: {
            type: 'string',
            required: false,
          },
        },
      },
      plugins: [
        nextCookies(),
        (await import("better-auth/plugins/admin")).admin(),
      ],
      trustedOrigins: [
        "https://maic.coachingthegist.com",
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001",
        "http://localhost:3001",
        "http://localhost:3000",
      ],
    });

    console.log('[Auth] better-auth initialized with shared SQLite connection');
  }
  return _auth;
}

// ---------------------------------------------------------------------------
// Helper: role checks
// ---------------------------------------------------------------------------

// Normalize better-auth roles: 'user' == 'student' (non-privileged)
function normalizeRole(role: string | undefined): string {
  if (role === 'user') return 'student';
  return role || 'student';
}
export function isInstructorOrAbove(user: { role?: string } | null): boolean {
  if (!user) return false;
  return normalizeRole(user.role) === 'admin' || normalizeRole(user.role) === 'instructor';
}

export function isAdmin(user: { role?: string } | null): boolean {
  if (!user) return false;
  return normalizeRole(user.role) === 'admin';
}

// ---------------------------------------------------------------------------
// Helper: email domain validation (server-only)
// ---------------------------------------------------------------------------

export function isAllowedEmailDomain(email: string): boolean {
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || 'tstc.edu')
    .split(',')
    .map(d => d.trim().toLowerCase());

  const emailDomain = email.split('@')[1]?.toLowerCase();
  if (!emailDomain) return false;

  if (allowedDomains.includes('*')) return true;

  return allowedDomains.includes(emailDomain);
}

// ---------------------------------------------------------------------------
// Helper: get session user from request (server-only)
// ---------------------------------------------------------------------------

export async function getSessionUser(req: { headers: Headers }) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  if (!authEnabled) return null;

  const auth = await getAuth();

  const headers = req.headers instanceof Headers
    ? req.headers
    : new Headers(req.headers as Record<string, string>);

  try {
    const session = await auth.api.getSession({
      headers,
    });
    return session?.user || null;
  } catch (err) {
    console.error('[Auth] getSessionUser error:', err);
    return null;
  }
}
