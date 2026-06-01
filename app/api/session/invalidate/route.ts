/**
 * POST /api/session/invalidate — server-to-server SSO session invalidation.
 *
 * Space Agent fires this on /logout (fire-and-forget). Same denylist as
 * /api/access-code/revoke. Body: { sub?, username?, jti? }
 */

import { NextRequest } from 'next/server';
import { revokeJti, revokeSub } from '@/lib/sso/denylist';
import { INTERNAL_TOKEN_HEADER } from '@/lib/sso/cookies';
import { apiError, apiSuccess } from '@/lib/server/api-response';

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(request: NextRequest) {
  const expected = process.env.MAIC_INTERNAL_TOKEN;
  if (!expected) {
    return apiError('INVALID_REQUEST', 503, 'Session invalidation not configured');
  }

  const provided = request.headers.get(INTERNAL_TOKEN_HEADER);
  if (!provided || !constantTimeEqual(provided, expected)) {
    return apiError('INVALID_REQUEST', 401, 'Unauthorized');
  }

  let body: { sub?: string; jti?: string; username?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  const sub = body.sub || body.username;
  if (!sub && !body.jti) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'sub, username, or jti required');
  }

  if (body.jti) revokeJti(body.jti);
  if (sub) revokeSub(sub);

  return apiSuccess({ invalidated: { sub: sub ?? null, jti: body.jti ?? null } });
}
