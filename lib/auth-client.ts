/**
 * OpenMAIC Auth Client
 *
 * Client-side auth utilities for better-auth.
 * Used in components and pages to check session state and trigger auth actions.
 *
 * Password reset flows call Better Auth HTTP routes directly
 * (/api/auth/request-password-reset, /api/auth/reset-password).
 */

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  // '/' causes better-auth to resolve routes relative to the current origin,
  // which works for both localhost and production without extra config.
  baseURL: process.env.NEXT_PUBLIC_APP_URL || '/',
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
