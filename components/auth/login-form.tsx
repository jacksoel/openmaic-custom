"use client";

import { useCallback, useState } from "react";
import { authClient } from "@/lib/auth-client";

function getDefaultRedirectForRole(role: string | undefined): string {
  if (role === "admin") return "/admin";
  return "/dashboard";
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
        rememberMe,
      });

      if (result.error) {
        const msg = result.error.message || "Login failed";
        if (msg.includes("Invalid email or password") || msg.includes("invalid")) {
          setError("Incorrect email or password. Please try again.");
        } else if (msg.includes("too many") || msg.includes("rate limit")) {
          setError("Too many attempts. Please wait a moment and try again.");
        } else if (msg.includes("not verified") || msg.includes("verify")) {
          setError("Please verify your email before signing in.");
        } else {
          setError(msg);
        }
      } else {
        const params = new URLSearchParams(window.location.search);
        const callbackUrl = params.get("callbackUrl");
        const { data: sessionData } = await authClient.getSession();
        const sessionUser = sessionData?.user as { role?: string } | undefined;
        window.location.href = callbackUrl || getDefaultRedirectForRole(sessionUser?.role);
      }
    } catch {
      setError("Unable to connect. Please check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [email, password, rememberMe]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 px-4">
      <div className={`w-full max-w-md space-y-8 rounded-xl border bg-white p-6 shadow-sm sm:p-8${loading ? " opacity-50 pointer-events-none" : ""}`}>
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">OpenMAIC</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            AI-Powered Interactive Classroom
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert" aria-live="polite" id="login-error">
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              required
              autoComplete="email"
              disabled={loading}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "login-error" : undefined}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
              placeholder="you@tstc.edu"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="password" className="text-sm font-medium text-gray-700">Password</label>
              <a href="/forgot-password" className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline">
                Forgot password?
              </a>
            </div>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                required
                autoComplete="current-password"
                disabled={loading}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={error ? "login-error" : undefined}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
                placeholder="Password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-1 top-1/2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center text-xs text-gray-500 hover:text-gray-700"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Remember me on this device
          </label>

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <a href="/register" className="font-medium text-blue-600 hover:text-blue-800 hover:underline">
            Create one
          </a>
        </p>
      </div>
    </div>
  );
}
