"use client";

import { ReactNode, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";

function AuthGuardSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-xl border bg-white dark:bg-gray-800 p-5 shadow-sm">
              <div className="mb-4 h-5 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              <div className="mt-6 h-9 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Guards a page behind session auth.
 *
 * Native better-auth sessions are detected via useSession(). SSO-launched users
 * (Space Agent) carry an openmaic_session SSO cookie that useSession() cannot
 * see, so when no native session is present we probe /api/whoami before
 * redirecting. This keeps the embedded panel from looping back to /login.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  // null = SSO state unknown, true = valid SSO session, false = no SSO session
  const [ssoAuthed, setSsoAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (session?.user) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/whoami", { credentials: "include" });
        if (cancelled) return;
        if (res.ok) {
          setSsoAuthed(true);
          return;
        }
      } catch {
        // network/parse failure falls through to the login redirect below
      }
      if (cancelled) return;
      setSsoAuthed(false);
      window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
    })();

    return () => {
      cancelled = true;
    };
  }, [session, isPending]);

  if (session?.user || ssoAuthed) {
    return <>{children}</>;
  }

  return <AuthGuardSkeleton />;
}
