"use client";

import { ReactNode, useEffect } from "react";
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
 * Uses better-auth's useSession hook so the session response is shared
 * with any other useSession() calls on the same page — no duplicate fetch.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
    }
  }, [session, isPending]);

  if (isPending || !session?.user) {
    return <AuthGuardSkeleton />;
  }

  return <>{children}</>;
}
