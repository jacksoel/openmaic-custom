'use client';

import { ReactNode } from 'react';
import { AccessCodeGuard } from '@/components/access-code-guard';
import { AuthGuard } from '@/components/auth/auth-guard';

/**
 * Combined guard that selects AuthGuard or AccessCodeGuard
 * based on the NEXT_PUBLIC_AUTH_ENABLED env var.
 *
 * When AUTH_ENABLED=true:
 *   - Uses proper session-based auth (better-auth)
 *   - Shows login page if not authenticated
 *   - Redirects to /login
 *
 * When AUTH_ENABLED=false (default, backward compat):
 *   - Uses existing ACCESS_CODE gate
 *   - Shows access code modal if not authenticated
 *   - No user identity, no roles
 */
export function AppGuard({ children }: { children: ReactNode }) {
  const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true';

  if (authEnabled) {
    return <AuthGuard>{children}</AuthGuard>;
  }

  return <AccessCodeGuard>{children}</AccessCodeGuard>;
}