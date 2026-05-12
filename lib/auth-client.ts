/**
 * OpenMAIC Auth Client
 *
 * Client-side auth utilities for better-auth.
 * Used in components and pages to check session state and auth actions.
 *
 * Password reset flows call Better Auth HTTP routes directly (/api/auth/request-password-reset, /api/auth/reset-password)
 * so we do not re-export inferred client bindings that vary by better-auth inference.
 */

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || '',
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
