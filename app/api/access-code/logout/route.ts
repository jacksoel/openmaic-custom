import { cookies } from 'next/headers';
import { apiSuccess } from '@/lib/server/api-response';
import { LEGACY_ACCESS_COOKIE, SSO_SESSION_COOKIE } from '@/lib/sso/cookies';

export async function POST() {
  const store = await cookies();
  store.delete(SSO_SESSION_COOKIE);
  store.delete(LEGACY_ACCESS_COOKIE);
  return apiSuccess({ ok: true });
}
