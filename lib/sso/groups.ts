const GROUP_ROLE_MAP: Record<string, string> = {
  _admin: 'admin',
  _instructor: 'instructor',
};

export function groupsToRoles(groups: string[] | undefined): string[] {
  if (!Array.isArray(groups) || groups.length === 0) {
    return ['student'];
  }
  const roles = new Set<string>();
  for (const group of groups) {
    const mappedRole = GROUP_ROLE_MAP[group];
    if (mappedRole) {
      roles.add(mappedRole);
    }
  }
  if (roles.size === 0) {
    roles.add('student');
  }
  return Array.from(roles);
}

export function resolvePrimaryRole(roles: string[]): string {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('instructor')) return 'instructor';
  return 'student';
}
