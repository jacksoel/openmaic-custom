import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE, groupToRole, groupsToRoles } from '@/lib/sso/groups';

describe('sso/groups', () => {
  it('maps known Space Agent groups to roles', () => {
    expect(groupToRole('_admin')).toBe('admin');
    expect(groupToRole('_instructor')).toBe('instructor');
  });

  it('returns the default role for unknown or custom groups', () => {
    expect(groupToRole('whatever')).toBe(DEFAULT_ROLE);
    expect(groupToRole('')).toBe(DEFAULT_ROLE);
  });

  it('returns [DEFAULT_ROLE] for empty / undefined group lists', () => {
    expect(groupsToRoles(undefined)).toEqual([DEFAULT_ROLE]);
    expect(groupsToRoles([])).toEqual([DEFAULT_ROLE]);
  });

  it('deduplicates roles when multiple groups map to the same role', () => {
    expect(groupsToRoles(['custom-1', 'custom-2'])).toEqual([DEFAULT_ROLE]);
  });

  it('preserves all distinct mapped roles', () => {
    const roles = groupsToRoles(['_admin', '_instructor', 'other']);
    expect(roles).toContain('admin');
    expect(roles).toContain('instructor');
    expect(roles).toContain('student');
    expect(roles).toHaveLength(3);
  });
});
