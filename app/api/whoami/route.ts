import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  SESSION_AUDIENCE,
  SESSION_COOKIE_NAME,
  SESSION_ISSUER,
} from '@/lib/sso/claims';
import { verifyHs256Jwt } from '@/lib/sso/jwt';

/**
 * GET /api/whoami — return the identity behind the current SSO session.
 *
 * Middleware already rejects requests with no session cookie (401), but only
 * checks cookie presence; full signature/expiry/claims validation happens here.
 */
export async function GET(request: NextRequest) {
  const launchSecret = process.env.MAIC_LAUNCH_SECRET;
  if (!launchSecret) {
    return apiError('INTERNAL_ERROR', 503, 'SSO not configured (MAIC_LAUNCH_SECRET missing)');
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return apiError('UNAUTHORIZED', 401, 'No SSO session cookie');
  }

  const verified = verifyHs256Jwt(sessionToken, launchSecret);
  if (!verified.ok) {
    return apiError('UNAUTHORIZED', 401, `Invalid SSO session: ${verified.reason}`);
  }

  const payload = verified.payload;
  if (payload.iss !== SESSION_ISSUER || payload.aud !== SESSION_AUDIENCE) {
    return apiError('UNAUTHORIZED', 401, 'Invalid SSO session issuer or audience');
  }

  return apiSuccess({
    sub: payload.sub,
    sessionType: typeof payload.sessionType === 'string' ? payload.sessionType : null,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    space: payload.space ?? null,
    exp: typeof payload.exp === 'number' ? payload.exp : null,
  });
}
