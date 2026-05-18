/**
 * OpenMAIC Auth Initialization
 *
 * Called at server startup to:
 * 1. Create better-auth core tables (user, session, account, verification)
 * 2. Create extension tables (user_providers, usage_logs)
 * 3. Initialize better-auth instance
 * 4. Create seed admin/instructor users
 */

import { initAuthDb, getDb } from '@/lib/server/auth-db';

export async function initAuth() {
  const authEnabled = process.env.AUTH_ENABLED === 'true';

  if (!authEnabled) {
    console.log('[Auth] AUTH_ENABLED is not set — skipping auth initialization');
    return;
  }

  console.log('[Auth] Initializing auth system...');

  // 1. Create all database tables (better-auth core + extensions)
  initAuthDb();

  // 2. Initialize better-auth instance
  try {
    const { getAuth } = await import('@/lib/auth');
    await getAuth();
    console.log('[Auth] better-auth instance initialized');
  } catch (error: any) {
    console.error('[Auth] better-auth init error:', error.message);
  }

  // 3. Create admin user
  const adminEmail = process.env.AUTH_ADMIN_EMAIL;
  const adminPassword = process.env.AUTH_ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM user WHERE email = ?').get(adminEmail);

      if (!existing) {
        const { getAuth } = await import('@/lib/auth');
        const auth = await getAuth();
        const result = await auth.api.signUpEmail({
          body: {
            email: adminEmail,
            password: adminPassword,
            name: process.env.AUTH_ADMIN_NAME || 'Admin',
          },
        });

        if (result) {
          db.prepare('UPDATE user SET role = ? WHERE email = ?').run('admin', adminEmail);
          console.log(`[Auth] Created admin user: ${adminEmail}`);
        }
      } else {
        console.log(`[Auth] Admin user already exists: ${adminEmail}`);
      }
    } catch (error: any) {
      console.error('[Auth] Failed to create admin user:', error.message);
    }
  }

  // 4. Create instructor user
  const instructorEmail = process.env.AUTH_INSTRUCTOR_EMAIL;
  const instructorPassword = process.env.AUTH_INSTRUCTOR_PASSWORD;

  if (instructorEmail && instructorPassword) {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM user WHERE email = ?').get(instructorEmail);

      if (!existing) {
        const { getAuth } = await import('@/lib/auth');
        const auth = await getAuth();
        await auth.api.signUpEmail({
          body: {
            email: instructorEmail,
            password: instructorPassword,
            name: process.env.AUTH_INSTRUCTOR_NAME || 'Instructor',
          },
        });
        db.prepare('UPDATE user SET role = ? WHERE email = ?').run('instructor', instructorEmail);
        console.log(`[Auth] Created instructor user: ${instructorEmail}`);
      }
    } catch (error: any) {
      console.error('[Auth] Failed to create instructor user:', error.message);
    }
  }

  console.log('[Auth] Auth system initialized successfully');
}