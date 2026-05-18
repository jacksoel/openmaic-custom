import { NextRequest, NextResponse } from 'next/server';
import { revokeJti, revokeSub } from '@/lib/sso/denylist';
import { INTERNAL_TOKEN_HEADER } from '@/lib/sso/cookies';
import { apiError, apiSuccess } from '@/lib/server/api-response';

/**
 * Server-to-server revocation endpoint. Caller passes a shared bearer in
 * the X-Maic-Internal-Token header that matches MAIC_INTERNAL_TOKEN.
 *
 * The public Caddy / Nginx config strips this header from inbound public
 * requests and 404s this path, so the only callers that can authenticate
 * are reachable on the colony Docker network (i.e. Space Agent itself).
 *
 * Body:
 *   { "sub": "user_123" }         revoke every existing session for sub
 *   { "jti": "<uuid>" }           revoke a single session by jti
 *   { "sub": "...", "jti": "..." } both
 */
export async function POST(request: NextRequest) {
  const expected = process.env.MAIC_INTERNAL_TOKEN;
  if (!expected) {
    return apiError('INVALID_REQUEST', 503, 'Revocation not configured');
  }

  const provided = request.headers.get(INTERNAL_TOKEN_HEADER);
  if (!provided || !constantTimeEqual(provided, expected)) {
    return apiError('INVALID_REQUEST', 401, 'Unauthorized');
  }

  let body: { sub?: string; jti?: string };
  try {
    body = (await request.json()) as { sub?: string; jti?: string };
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  if (!body.sub && !body.jti) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'sub or jti required');
  }

  if (body.jti) revokeJti(body.jti);
  if (body.sub) revokeSub(body.sub);

  return apiSuccess({ revoked: { sub: body.sub ?? null, jti: body.jti ?? null } });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
