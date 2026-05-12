import { NextRequest, NextResponse } from 'next/server';
import { getAuth, isAdmin } from '@/lib/auth';

// Helper to get session from request
async function getSessionUser(req: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  if (!authEnabled) return null;

  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  return session?.user || null;
}

// GET /api/admin/users — list all users (admin only)
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { getDb } = await import('@/lib/server/auth-db');
    const db = getDb();
    const users = db.prepare(
      'SELECT id, email, name, role, institution, emailVerified, createdAt, updatedAt FROM user ORDER BY createdAt DESC'
    ).all();
    return NextResponse.json({ users });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/admin/users — update user role (admin only)
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { userId, role } = body;

    if (!userId || !role) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, role' },
        { status: 400 }
      );
    }

    const validRoles = ['admin', 'instructor', 'student', 'user'];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    // Prevent self-demotion (admin can't remove their own admin role)
    if (userId === user.id && role !== 'admin') {
      return NextResponse.json(
        { error: 'Cannot remove your own admin role' },
        { status: 400 }
      );
    }

    const { getDb } = await import('@/lib/server/auth-db');
    const db = getDb();

    const result = db.prepare(
      'UPDATE user SET role = ?, updatedAt = ? WHERE id = ?'
    ).run(role, new Date().toISOString(), userId);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, userId, role });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
