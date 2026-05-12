'use client';

import { useState } from 'react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setErrorMessage('');

    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const res = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectTo }),
      });

      // Always show success message (anti-enumeration)
      setStatus('sent');
    } catch (err: any) {
      // Don't reveal error details (anti-enumeration)
      setStatus('sent');
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 px-4">
      <section className="w-full max-w-md space-y-5 rounded-xl border bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>

        {status === 'sent' ? (
          <>
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">
              <p className="font-medium">Check your email</p>
              <p className="mt-1 text-green-700">
                If an account exists for <strong>{email}</strong>, we&apos;ve sent instructions to reset your password.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Didn&apos;t receive the email? Check your spam folder or{' '}
              <button
                onClick={() => setStatus('idle')}
                className="text-blue-600 hover:underline"
              >
                try again
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Enter your email address and we&apos;ll send you a link to reset your password.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4 text-left">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@tstc.edu"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  disabled={status === 'sending'}
                />
              </div>
              <button
                type="submit"
                disabled={status === 'sending' || !email}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {status === 'sending' ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
            {status === 'error' && errorMessage && (
              <p className="text-xs text-red-600">{errorMessage}</p>
            )}
          </>
        )}

        <a
          href="/login"
          className="inline-flex text-sm text-blue-600 hover:underline"
        >
          Back to sign in
        </a>
      </section>
    </main>
  );
}
