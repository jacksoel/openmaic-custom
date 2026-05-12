import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth';
import { isInstructorOrAbove } from '@/lib/auth';
import { getDb } from '@/lib/server/auth-db';
import { encryptApiKey, decryptApiKey } from '@/lib/server/encryption';

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

// GET /api/user/providers — list current user's configured providers (instructor/admin only)
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Students cannot configure providers — gate the read too so RBAC is consistent
  if (!isInstructorOrAbove(user)) {
    return NextResponse.json(
      { error: 'Only instructors and admins can configure AI providers' },
      { status: 403 },
    );
  }

  try {
    const db = getDb();
    const providers = db.prepare(
      'SELECT id, userId, providerSlug, defaultModel, limits, createdAt, updatedAt FROM user_providers WHERE userId = ?'
    ).all(user.id);

    // Never return encrypted API keys to the frontend
    const safe = providers.map((p: any) => ({
      ...p,
      hasKey: true, // if the record exists, it has a key
    }));

    return NextResponse.json({ providers: safe });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/user/providers — add or update a provider for current user
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only instructors and above can configure providers (Phase 1: conservative)
  if (!isInstructorOrAbove(user)) {
    return NextResponse.json(
      { error: 'Only instructors and admins can configure AI providers' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { providerSlug, apiKey, defaultModel, limits } = body;

    if (!providerSlug || !apiKey) {
      return NextResponse.json(
        { error: 'providerSlug and apiKey are required' },
        { status: 400 }
      );
    }

    const db = getDb();
    const encryptedKey = encryptApiKey(apiKey);

    // Upsert: insert or update if userId+providerSlug combo exists
    const existing = db.prepare(
      'SELECT id FROM user_providers WHERE userId = ? AND providerSlug = ?'
    ).get(user.id, providerSlug);

    if (existing) {
      db.prepare(
        'UPDATE user_providers SET encryptedApiKey = ?, defaultModel = ?, limits = ?, updatedAt = datetime(\'now\') WHERE userId = ? AND providerSlug = ?'
      ).run(
        encryptedKey,
        defaultModel || null,
        limits ? JSON.stringify(limits) : null,
        user.id,
        providerSlug
      );
    } else {
      const id = crypto.randomUUID();
      db.prepare(
        'INSERT INTO user_providers (id, userId, providerSlug, encryptedApiKey, defaultModel, limits) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        user.id,
        providerSlug,
        encryptedKey,
        defaultModel || null,
        limits ? JSON.stringify(limits) : null
      );
    }

    return NextResponse.json({ success: true, providerSlug });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}