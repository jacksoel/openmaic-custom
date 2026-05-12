"use client";

import { ReactNode, useEffect, useState } from "react";

interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    image?: string;
  };
}

function AuthGuardSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-gray-200" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="mb-4 h-5 w-3/4 animate-pulse rounded bg-gray-200" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
              <div className="mt-6 h-9 w-full animate-pulse rounded-lg bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<{
    enabled: boolean;
    authenticated: boolean;
    user?: AuthStatus["user"];
    loading: boolean;
  }>({ enabled: false, authenticated: false, loading: true });

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/get-session");
        if (!res.ok) {
          if (!cancelled) {
            setStatus({ enabled: false, authenticated: true, loading: false });
          }
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          if (data.user) {
            setStatus({ enabled: true, authenticated: true, user: data.user, loading: false });
          } else {
            setStatus({ enabled: true, authenticated: false, loading: false });
          }
        }
      } catch {
        if (!cancelled) {
          setStatus({ enabled: false, authenticated: true, loading: false });
        }
      }
    }

    checkAuth();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status.loading || !status.enabled || status.authenticated) return;
    window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
  }, [status.authenticated, status.enabled, status.loading]);

  if (status.loading) {
    return <AuthGuardSkeleton />;
  }

  if (status.enabled && !status.authenticated) {
    return <AuthGuardSkeleton />;
  }

  return <>{children}</>;
}
