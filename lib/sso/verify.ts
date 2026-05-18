import { decodeBase64Url, encodeBase64Url } from './base64url';

/**
 * Claims carried in both the short-lived launch JWT (minted by Space Agent)
 * and the longer-lived session JWT (issued by /api/access-code/sso).
 *
 * Custom claims map to a thin LMS shell:
 *   sub       — stable user id from the identity provider (Space Agent)
 *   name      — display name
 *   email     — optional contact
 *   roles     — flat list, e.g. ["admin"] or ["student"]
 *   tenant    — deployment / course-group namespace
 *   classroom — target classroom id (informs the post-SSO redirect)
 *   courses   — optional list of course ids the user is enrolled in
 */
export interface JwtClaims {
  sub: string;
  name?: string;
  email?: string;
  roles?: string[];
  tenant?: string;
  classroom?: string;
  courses?: string[];
  iat: number;
  exp: number;
  jti?: string;
}

interface JwtHeader {
  alg: string;
  typ?: string;
}

export class JwtVerifyError extends Error {
  constructor(
    public code:
      | 'MALFORMED'
      | 'BAD_ALG'
      | 'BAD_SIGNATURE'
      | 'EXPIRED'
      | 'FUTURE_IAT'
      | 'MISSING_SUB',
    message: string,
  ) {
    super(message);
    this.name = 'JwtVerifyError';
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret).buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function verifyHs256Jwt(token: string, secret: string): Promise<JwtClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new JwtVerifyError('MALFORMED', 'JWT must have three segments');
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: JwtHeader;
  let payload: JwtClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(headerB64))) as JwtHeader;
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadB64))) as JwtClaims;
  } catch {
    throw new JwtVerifyError('MALFORMED', 'JWT header/payload is not valid JSON');
  }

  if (header.alg !== 'HS256') {
    throw new JwtVerifyError('BAD_ALG', `Unsupported algorithm: ${header.alg}`);
  }

  const key = await importHmacKey(secret);
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = decodeBase64Url(sigB64);

  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    signature.buffer as ArrayBuffer,
    signingInput.buffer as ArrayBuffer,
  );
  if (!ok) {
    throw new JwtVerifyError('BAD_SIGNATURE', 'JWT signature verification failed');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new JwtVerifyError('EXPIRED', 'JWT has expired');
  }
  if (typeof payload.iat === 'number' && payload.iat > now + 60) {
    throw new JwtVerifyError('FUTURE_IAT', 'JWT iat is in the future');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new JwtVerifyError('MISSING_SUB', 'JWT missing sub claim');
  }

  return payload;
}

export async function signHs256Jwt(claims: JwtClaims, secret: string): Promise<string> {
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput).buffer as ArrayBuffer,
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(sig))}`;
}
