import { describe, expect, it } from 'vitest';
import {
  JwtVerifyError,
  signHs256Jwt,
  verifyHs256Jwt,
  type JwtClaims,
} from '@/lib/sso/verify';

const SECRET = 'test-secret-please-rotate';

function baseClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'eric.jackson',
    name: 'Eric Jackson',
    roles: ['_admin'],
    tenant: 'colony5148351',
    classroom: 'intro-to-dora',
    iat: now,
    exp: now + 60,
    jti: crypto.randomUUID(),
    ...overrides,
  };
}

describe('sso/verify', () => {
  it('round-trips a valid token', async () => {
    const claims = baseClaims();
    const jwt = await signHs256Jwt(claims, SECRET);
    const parsed = await verifyHs256Jwt(jwt, SECRET);
    expect(parsed.sub).toBe('eric.jackson');
    expect(parsed.roles).toEqual(['_admin']);
    expect(parsed.classroom).toBe('intro-to-dora');
  });

  it('preserves the optional courses claim', async () => {
    const jwt = await signHs256Jwt(
      baseClaims({ courses: ['dora-metrics', 'ip-addressing'] }),
      SECRET,
    );
    const parsed = await verifyHs256Jwt(jwt, SECRET);
    expect(parsed.courses).toEqual(['dora-metrics', 'ip-addressing']);
  });

  it('rejects a tampered signature', async () => {
    const jwt = (await signHs256Jwt(baseClaims(), SECRET)).slice(0, -2) + 'AA';
    await expect(verifyHs256Jwt(jwt, SECRET)).rejects.toMatchObject({
      code: 'BAD_SIGNATURE',
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const jwt = await signHs256Jwt(baseClaims(), SECRET);
    await expect(verifyHs256Jwt(jwt, 'wrong-secret')).rejects.toMatchObject({
      code: 'BAD_SIGNATURE',
    });
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const jwt = await signHs256Jwt(baseClaims({ iat: past - 60, exp: past }), SECRET);
    await expect(verifyHs256Jwt(jwt, SECRET)).rejects.toMatchObject({
      code: 'EXPIRED',
    });
  });

  it('rejects a malformed token', async () => {
    await expect(verifyHs256Jwt('not-a-jwt', SECRET)).rejects.toBeInstanceOf(
      JwtVerifyError,
    );
  });

  it('rejects an unsupported algorithm header', async () => {
    // Hand-craft an alg=none header so the parser sees BAD_ALG before signature check.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const payload = Buffer.from(JSON.stringify(baseClaims()))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const fake = `${header}.${payload}.AAAA`;
    await expect(verifyHs256Jwt(fake, SECRET)).rejects.toMatchObject({
      code: 'BAD_ALG',
    });
  });
});
