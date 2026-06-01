/**
 * SSO session denylist — stub implementation.
 * In production, backed by Redis or a persistent store.
 * For now, uses an in-memory Set that resets on server restart.
 */

const revokedJtis = new Set<string>();
const revokedSubs = new Set<string>();

export function revokeJti(jti: string): void {
  revokedJtis.add(jti);
}

export function revokeSub(sub: string): void {
  revokedSubs.add(sub);
}

export function isJtiRevoked(jti: string): boolean {
  return revokedJtis.has(jti);
}

export function isSubRevoked(sub: string): boolean {
  return revokedSubs.has(sub);
}
