/**
 * Group → role mapping for the Space Agent ↔ OpenMAIC SSO bridge.
 *
 * This module is the single source of truth for the convention. Both the
 * /api/access-code/sso endpoint (which receives raw `space.groups` in the
 * launch JWT) and the standalone mint CLI in space-agent-bootstrap MUST
 * agree on this table, otherwise ops-minted and app-minted tokens diverge.
 *
 * The convention deliberately matches Space Agent's group naming (the leading
 * underscore is theirs) so changes there propagate here unambiguously.
 */

const GROUP_TO_ROLE: Readonly<Record<string, string>> = {
  _admin: 'admin',
  _instructor: 'instructor',
};

export const DEFAULT_ROLE = 'student';

export function groupToRole(group: string): string {
  return GROUP_TO_ROLE[group] ?? DEFAULT_ROLE;
}

/**
 * Map a list of Space Agent groups to a deduplicated list of OpenMAIC roles.
 * If `groups` is empty/undefined, returns [DEFAULT_ROLE] so the caller never
 * has to choose between "missing" and "student" — every authenticated SSO
 * user has at least the student role.
 */
export function groupsToRoles(groups: string[] | undefined): string[] {
  if (!groups || groups.length === 0) return [DEFAULT_ROLE];
  return [...new Set(groups.map(groupToRole))];
}
