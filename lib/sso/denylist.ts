/**
 * In-process JWT denylist for the Space Agent SSO bridge.
 *
 * Used by middleware to reject session JWTs that have been explicitly
 * revoked (logout, instructor kick, password reset). Two key kinds:
 *
 *   - `jti:<uuid>`  invalidates a single specific session.
 *   - `sub:<id>`    invalidates every session for that user issued at or
 *                   before the revoke time. Honoured by checking the
 *                   session's `iat` claim against the revoke timestamp.
 *
 * The map is anchored on `globalThis` so it survives hot-reload and any
 * module-duplication that happens when middleware and route handlers
 * resolve the same file via different bundler entries. The state is
 * per-process; horizontal scaling will need a shared store (Redis or
 * SQLite). For the colony single-node deployment in-process is sufficient.
 */

const GLOBAL_KEY = '__maicSsoDenylist';

interface DenylistEntry {
  /** Unix seconds when this entry can be discarded. */
  expiresAt: number;
  /** For `sub:` entries, the cutoff: any session with iat <= this is denied. */
  cutoffIat?: number;
}

type Store = Map<string, DenylistEntry>;

interface GlobalShape {
  [GLOBAL_KEY]?: Store;
}

function getStore(): Store {
  const g = globalThis as GlobalShape;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map();
  }
  return g[GLOBAL_KEY]!;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Drop entries past their TTL. Cheap enough to run on every check. */
function evict(store: Store): void {
  const t = now();
  for (const [k, v] of store) {
    if (v.expiresAt <= t) store.delete(k);
  }
}

/** Revoke a single session by its JWT id. ttl in seconds defaults to 24h. */
export function revokeJti(jti: string, ttlSeconds = 24 * 60 * 60): void {
  if (!jti) return;
  const store = getStore();
  evict(store);
  store.set(`jti:${jti}`, { expiresAt: now() + ttlSeconds });
}

/**
 * Revoke every existing session for `sub`. New sessions issued after `now()`
 * are not affected (their iat will be greater than the cutoff).
 * ttl defaults to the maximum session lifetime so cleanup is automatic.
 */
export function revokeSub(sub: string, ttlSeconds = 24 * 60 * 60): void {
  if (!sub) return;
  const store = getStore();
  evict(store);
  store.set(`sub:${sub}`, { expiresAt: now() + ttlSeconds, cutoffIat: now() });
}

/**
 * Return true if a session bearing these claims is revoked. Cheap; safe to
 * call from every middleware invocation.
 */
export function isRevoked(claims: { sub: string; jti?: string; iat?: number }): boolean {
  const store = getStore();
  if (store.size === 0) return false;
  evict(store);

  if (claims.jti) {
    const j = store.get(`jti:${claims.jti}`);
    if (j) return true;
  }

  const s = store.get(`sub:${claims.sub}`);
  if (s) {
    const cutoff = s.cutoffIat ?? 0;
    if (typeof claims.iat !== 'number' || claims.iat <= cutoff) {
      return true;
    }
  }

  return false;
}

/** Test-only helper. */
export function _resetDenylist(): void {
  getStore().clear();
}
