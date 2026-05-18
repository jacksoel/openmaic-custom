/** Cookie names used by the Space Agent ↔ OpenMAIC SSO bridge. */
export const SSO_SESSION_COOKIE = 'openmaic_session';
export const LEGACY_ACCESS_COOKIE = 'openmaic_access';

/** Default session lifetime once a launch JWT has been exchanged. 8 hours. */
export const SSO_SESSION_TTL_SECONDS = 60 * 60 * 8;

/**
 * Identity headers injected by middleware after a successful session verify.
 * Listed here so the same set can be stripped from inbound requests as a
 * defence against client spoofing.
 */
export const SSO_INJECTED_HEADERS = [
  'x-maic-user',
  'x-maic-name',
  'x-maic-email',
  'x-maic-roles',
  'x-maic-tenant',
  'x-maic-classroom',
] as const;
