import { decodeBase64Url, encodeBase64Url } from './base64url';
import {
  EXPECTED_AUDIENCE,
  EXPECTED_ISSUER,
  type JwtClaims,
} from './claims';

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
      | 'NOT_YET_VALID'
      | 'BAD_ISSUER'
      | 'BAD_AUDIENCE'
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

function audMatches(aud: string | string[] | undefined, expected: string): boolean {
  if (Array.isArray(aud)) return aud.includes(expected);
  return aud === expected;
}

interface VerifyOptions {
  /** If set, the JWT's `iss` claim must match. Defaults to EXPECTED_ISSUER. */
  expectedIssuer?: string | null;
  /** If set, the JWT's `aud` claim must include this value. Defaults to EXPECTED_AUDIENCE. */
  expectedAudience?: string | null;
}

export async function verifyHs256Jwt(
  token: string,
  secret: string,
  opts: VerifyOptions = {},
): Promise<JwtClaims> {
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
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) {
    throw new JwtVerifyError('NOT_YET_VALID', 'JWT nbf is in the future');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new JwtVerifyError('MISSING_SUB', 'JWT missing sub claim');
  }

  const expectedIss = opts.expectedIssuer === undefined ? EXPECTED_ISSUER : opts.expectedIssuer;
  if (expectedIss && payload.iss !== expectedIss) {
    throw new JwtVerifyError('BAD_ISSUER', `JWT iss "${payload.iss}" does not match expected "${expectedIss}"`);
  }

  const expectedAud =
    opts.expectedAudience === undefined ? EXPECTED_AUDIENCE : opts.expectedAudience;
  if (expectedAud && !audMatches(payload.aud, expectedAud)) {
    throw new JwtVerifyError('BAD_AUDIENCE', `JWT aud does not include "${expectedAud}"`);
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

export type { JwtClaims } from './claims';
