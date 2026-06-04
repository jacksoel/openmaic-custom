'use client';

import { authClient } from '@/lib/auth-client';

export const GENERATION_PREVIEW_LOGIN_CALLBACK = '/generation-preview';

export function buildGenerationPreviewLoginUrl(): string {
  return `/login?callbackUrl=${encodeURIComponent(GENERATION_PREVIEW_LOGIN_CALLBACK)}`;
}

export function redirectToGenerationPreviewLogin(): void {
  if (typeof window !== 'undefined') {
    window.location.assign(buildGenerationPreviewLoginUrl());
  }
}

/** Redirect to login and throw AbortError so generation catch blocks stay silent. */
export function abortGenerationForLoginRedirect(): never {
  redirectToGenerationPreviewLogin();
  throw new DOMException('Redirecting to login', 'AbortError');
}

export function assertAuthorizedGenerationResponse(response: Response): void {
  if (response.status === 401) {
    abortGenerationForLoginRedirect();
  }
}

/**
 * When auth is enabled, require a logged-in instructor/admin before generation APIs run.
 * Returns false if a redirect was started (caller should return immediately).
 */
export async function ensureAuthenticatedForGeneration(router: {
  push: (path: string) => void;
}): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'true') {
    return true;
  }

  const sessionResult = await authClient.getSession();
  const user = sessionResult?.data?.user;
  if (!user) {
    redirectToGenerationPreviewLogin();
    return false;
  }

  const role = user.role;
  if (role === 'student' || role === 'user') {
    router.push('/dashboard');
    return false;
  }

  return true;
}
