import { createHmac, timingSafeEqual } from 'crypto';

export type JwtPayload = Record<string, unknown>;

function b64urlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signSegment(header: object, payload: object, secret: string): string {
  const encodedHeader = b64urlEncode(JSON.stringify(header));
  const encodedPayload = b64urlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${b64urlEncode(signature)}`;
}

export function verifyHs256Jwt(
  token: string,
  secret: string,
): { ok: true; payload: JwtPayload } | { ok: false; reason: string } {
  if (!token || !secret) {
    return { ok: false, reason: 'missing token or secret' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, reason: 'malformed token' };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac('sha256', secret).update(signingInput).digest();
  const actualSignature = b64urlDecode(encodedSignature);

  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    return { ok: false, reason: 'invalid signature' };
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(encodedPayload).toString('utf8')) as JwtPayload;
  } catch {
    return { ok: false, reason: 'invalid payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : 0;
  if (exp > 0 && now >= exp) {
    return { ok: false, reason: 'token expired' };
  }
  if (nbf > 0 && now < nbf) {
    return { ok: false, reason: 'token not yet valid' };
  }

  return { ok: true, payload };
}

export function signHs256Jwt(payload: JwtPayload, secret: string): string {
  return signSegment({ alg: 'HS256', typ: 'JWT' }, payload, secret);
}
