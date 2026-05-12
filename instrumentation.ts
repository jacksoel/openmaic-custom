/**
 * Next.js Instrumentation Hook
 *
 * Runs once at server startup. Used to initialize auth database
 * and seed initial admin/instructor users.
 */

export async function register() {
  // Only run on the server, not during build
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initAuth } = await import('@/lib/server/auth-init');
    await initAuth();
  }
}