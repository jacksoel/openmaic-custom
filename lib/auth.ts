/**
 * OpenMAIC Authentication — better-auth + SSO bridge
 *
 * getSessionUser() resolves the current user from either auth path:
 *   - "native": better-auth session cookie (the local multi-user system)
 *   - "sso":    an HS256 launch-token cookie issued via /api/access-code/sso
 *               (the Space Agent ↔ OpenMAIC bridge; see lib/sso/)
 *
 * Native wins when both are present, so a user logged into the native
 * system isn't ever silently downgraded to SSO claims. Returns null when
 * neither path resolves a user.
 */

export type { Role }     from './auth-types';
export type { AuthUser } from './auth-types';

import { trySsoSession } from '@/lib/sso/session';

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

export type SessionType = 'native' | 'sso';

/**
 * Discriminated session user. Properties shared with native better-auth
 * sessions (id, email, name, role) stay accessible without narrowing so
 * existing callers (`sessionUser?.id`, `sessionUser?.email`) keep working
 * regardless of which path produced the user.
 */
export interface SessionUser {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string;
  institution?: string | null;
  sessionType: SessionType;
  /** Present only for sessionType === 'sso'. */
  ssoGroups?: string[];
  ssoSessionId?: string | null;
  ssoJti?: string | null;
}

export async function getSessionUser(req: { headers: Headers }): Promise<SessionUser | null> {
  const headers = req.headers instanceof Headers
    ? req.headers
    : new Headers(req.headers as Record<string, string>);

  // 1. Native session (better-auth). Wins if present.
  if (process.env.AUTH_ENABLED === 'true') {
    try {
      const auth = await getAuth();
      const session = await auth.api.getSession({ headers });
      const user = session?.user;
      if (user) {
        return {
          id: user.id,
          email: user.email ?? null,
          name: user.name ?? null,
          role: user.role,
          institution: user.institution ?? null,
          sessionType: 'native',
        };
      }
    } catch (err) {
      console.error('[Auth] getSessionUser native path error:', err);
      // Fall through to SSO so a misconfigured better-auth doesn't kill SSO too.
    }
  }

  // 2. SSO session (openmaic_session JWT cookie).
  const sso = await trySsoSession(headers);
  if (sso) {
    return {
      id: sso.id,
      email: sso.email,
      name: sso.name,
      role: sso.role,
      institution: sso.institution,
      sessionType: 'sso',
      ssoGroups: sso.ssoGroups,
      ssoSessionId: sso.ssoSessionId,
      ssoJti: sso.ssoJti,
    };
  }

  return null;
}
