import { describe, expect, it } from 'vitest';
import { EXPECTED_AUDIENCE, EXPECTED_ISSUER } from '@/lib/sso/claims';
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
    iss: EXPECTED_ISSUER,
    aud: EXPECTED_AUDIENCE,
    iat: now,
    exp: now + 60,
    jti: crypto.randomUUID(),
    name: 'Eric Jackson',
    space: { groups: ['_admin'], sessionId: 'space-sess-abc' },
    ...overrides,
  };
}

describe('sso/verify', () => {
  it('round-trips a valid token with namespaced claims', async () => {
    const claims = baseClaims();
    const jwt = await signHs256Jwt(claims, SECRET);
    const parsed = await verifyHs256Jwt(jwt, SECRET);
    expect(parsed.sub).toBe('eric.jackson');
    expect(parsed.iss).toBe(EXPECTED_ISSUER);
    expect(parsed.aud).toBe(EXPECTED_AUDIENCE);
    expect(parsed.space?.groups).toEqual(['_admin']);
    expect(parsed.space?.sessionId).toBe('space-sess-abc');
  });

  it('accepts an aud claim that is an array containing the expected value', async () => {
    const jwt = await signHs256Jwt(
      baseClaims({ aud: ['openmaic', 'other-relying-party'] }),
      SECRET,
    );
    const parsed = await verifyHs256Jwt(jwt, SECRET);
    expect(parsed.aud).toEqual(['openmaic', 'other-relying-party']);
  });

  it('rejects a token with the wrong audience', async () => {
    const jwt = await signHs256Jwt(baseClaims({ aud: 'someone-else' }), SECRET);
    await expect(verifyHs256Jwt(jwt, SECRET)).rejects.toMatchObject({
      code: 'BAD_AUDIENCE',
    });
  });

  it('rejects a token with the wrong issuer', async () => {
    const jwt = await signHs256Jwt(baseClaims({ iss: 'evil-issuer' }), SECRET);
    await expect(verifyHs256Jwt(jwt, SECRET)).rejects.toMatchObject({
      code: 'BAD_ISSUER',
    });
  });

  it('allows iss/aud checks to be opted out per call', async () => {
    const jwt = await signHs256Jwt(baseClaims({ iss: 'whatever', aud: 'whatever' }), SECRET);
    const parsed = await verifyHs256Jwt(jwt, SECRET, {
      expectedIssuer: null,
      expectedAudience: null,
    });
    expect(parsed.sub).toBe('eric.jackson');
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
