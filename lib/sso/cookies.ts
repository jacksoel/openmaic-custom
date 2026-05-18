/** Cookie names used by the Space Agent ↔ OpenMAIC SSO bridge. */
export const SSO_SESSION_COOKIE = 'openmaic_session';
export const LEGACY_ACCESS_COOKIE = 'openmaic_access';

/** Session lifetime once a launch JWT has been exchanged. 8 hours. */
export const SSO_SESSION_TTL_SECONDS = 60 * 60 * 8;

/**
 * Header that server-to-server callers (e.g. Space Agent invoking
 * /api/access-code/revoke) present so the receiver can verify the call
 * came from inside the trust boundary. The public Caddy / Nginx config
 * strips this header at the edge so only colony-network callers can
 * authenticate.
 */
export const INTERNAL_TOKEN_HEADER = 'x-maic-internal-token';
