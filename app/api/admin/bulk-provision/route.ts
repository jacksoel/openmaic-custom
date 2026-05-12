import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, isAdmin, isAllowedEmailDomain } from '@/lib/auth';

function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

interface UserInput {
  email: string;
  name: string;
  role?: string;
  password?: string;
}

export async function POST(req: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  if (authEnabled) {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!isAdmin(sessionUser)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
  }

  let body: { users?: UserInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { users } = body;
  if (!Array.isArray(users) || users.length === 0) {
    return NextResponse.json({ error: 'users array is required' }, { status: 400 });
  }
  if (users.length > 100) {
    return NextResponse.json({ error: 'Maximum 100 users per request' }, { status: 400 });
  }

  const created: { email: string; role: string; tempPassword?: string }[] = [];
  const skipped: { email: string; reason: string }[] = [];
  const errors: { email: string; error: string }[] = [];

  const { getDb } = await import('@/lib/server/auth-db');
  const db = getDb();
  const auth = await (await import('@/lib/auth')).getAuth();

  for (const userInput of users) {
    const { email, name, role: inputRole, password: inputPassword } = userInput;

    if (!email || !name) {
      errors.push({ email: email || '(missing)', error: 'email and name are required' });
      continue;
    }

    if (!isAllowedEmailDomain(email)) {
      skipped.push({ email, reason: 'Email domain not allowed' });
      continue;
    }

    const role = inputRole || 'student';
    const validRoles = ['admin', 'instructor', 'student', 'user'];
    if (!validRoles.includes(role)) {
      errors.push({ email, error: `Invalid role: ${role}` });
      continue;
    }

    try {
      const existing = db.prepare('SELECT id FROM user WHERE email = ?').get(email);
      if (existing) {
        skipped.push({ email, reason: 'Email already exists' });
        continue;
      }

      const tempPassword = inputPassword || generatePassword(12);
      const isTemp = !inputPassword;

      const signUpResult = await auth.api.signUpEmail({
        body: {
          email,
          name,
          password: tempPassword,
        },
      });

      if (!signUpResult || signUpResult.error) {
        errors.push({ email, error: signUpResult?.error?.message || 'Failed to create user' });
        continue;
      }

      db.prepare(
        'UPDATE user SET role = ?, updatedAt = ? WHERE email = ?'
      ).run(role, new Date().toISOString(), email);

      created.push({
        email,
        role,
        ...(isTemp ? { tempPassword } : {}),
      });
    } catch (err: any) {
      errors.push({ email, error: err?.message || 'Unknown error' });
    }
  }

  return NextResponse.json({
    success: true,
    created,
    skipped,
    errors,
  });
}
