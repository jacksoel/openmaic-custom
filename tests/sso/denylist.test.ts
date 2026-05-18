import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetDenylist,
  isRevoked,
  revokeJti,
  revokeSub,
} from '@/lib/sso/denylist';

describe('sso/denylist', () => {
  beforeEach(() => {
    _resetDenylist();
  });

  it('returns false when nothing is revoked', () => {
    expect(
      isRevoked({ sub: 'u1', jti: 'j1', iat: Math.floor(Date.now() / 1000) }),
    ).toBe(false);
  });

  it('revokes a single session by jti', () => {
    revokeJti('j1');
    expect(isRevoked({ sub: 'u1', jti: 'j1', iat: 0 })).toBe(true);
    expect(isRevoked({ sub: 'u1', jti: 'j2', iat: 0 })).toBe(false);
  });

  it('revokes every existing session for a sub but allows new ones', () => {
    const cutoff = Math.floor(Date.now() / 1000);
    revokeSub('u1');
    // Sessions issued at or before the revoke time are denied.
    expect(isRevoked({ sub: 'u1', jti: 'old', iat: cutoff - 5 })).toBe(true);
    expect(isRevoked({ sub: 'u1', jti: 'old', iat: cutoff })).toBe(true);
    // A new session issued strictly after the revoke is allowed.
    expect(isRevoked({ sub: 'u1', jti: 'new', iat: cutoff + 10 })).toBe(false);
    // Other users are unaffected.
    expect(isRevoked({ sub: 'u2', jti: 'x', iat: cutoff - 5 })).toBe(false);
  });

  it('jti and sub revocations stack', () => {
    revokeJti('j1');
    revokeSub('u2');
    expect(isRevoked({ sub: 'u1', jti: 'j1', iat: 0 })).toBe(true);
    expect(isRevoked({ sub: 'u2', jti: 'other', iat: 0 })).toBe(true);
    expect(isRevoked({ sub: 'u3', jti: 'other', iat: 0 })).toBe(false);
  });

  it('ignores empty sub / jti', () => {
    revokeJti('');
    revokeSub('');
    expect(isRevoked({ sub: 'u1', jti: 'j1', iat: 0 })).toBe(false);
  });
});
