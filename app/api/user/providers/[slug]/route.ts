import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth';
import { getDb } from '@/lib/server/auth-db';

// Helper to get session user
async function getSessionUser(req: NextRequest) {
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  if (!authEnabled) return null;

  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  return session?.user || null;
}

// DELETE /api/user/providers/[slug] — remove a provider config
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { slug } = await params;
    const db = getDb();
    const result = db.prepare(
      'DELETE FROM user_providers WHERE userId = ? AND providerSlug = ?'
    ).run(user.id, slug);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/user/providers/[slug] — update provider (e.g., change default model)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { slug } = await params;
    const body = await req.json();
    const db = getDb();

    const updates: string[] = [];
    const values: any[] = [];

    if (body.defaultModel !== undefined) {
      updates.push('defaultModel = ?');
      values.push(body.defaultModel);
    }

    if (body.apiKey) {
      const { encryptApiKey } = await import('@/lib/server/encryption');
      updates.push('encryptedApiKey = ?');
      values.push(encryptApiKey(body.apiKey));
    }

    if (body.limits !== undefined) {
      updates.push('limits = ?');
      values.push(body.limits ? JSON.stringify(body.limits) : null);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push('updatedAt = datetime(\'now\')');
    values.push(user.id, slug);

    const result = db.prepare(
      `UPDATE user_providers SET ${updates.join(', ')} WHERE userId = ? AND providerSlug = ?`
    ).run(...values);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}