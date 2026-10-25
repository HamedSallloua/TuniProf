import { describe, expect, it } from 'vitest';
import { can, ROLES, type Permission } from '@/lib/auth/permissions';

const ALL: Permission[] = [
  'review:create',
  'teacher:space',
  'admin:panel',
  'admin:settings',
];

describe('permissions', () => {
  it('a reviewer (visitor) can write a review and nothing else', () => {
    expect(ALL.filter((p) => can('visitor', p))).toEqual(['review:create']);
  });

  it('a teacher account cannot post reviews (spec 3.5)', () => {
    expect(can('teacher', 'review:create')).toBe(false);
    expect(can('teacher', 'teacher:space')).toBe(true);
    expect(can('teacher', 'admin:panel')).toBe(false);
  });

  it('support admins cannot change settings or prices (spec 6)', () => {
    expect(can('admin_support', 'admin:panel')).toBe(true);
    expect(can('admin_support', 'admin:settings')).toBe(false);
    expect(can('admin_super', 'admin:settings')).toBe(true);
  });

  it('admins have no teacher space and cannot review', () => {
    for (const role of ['admin_super', 'admin_support'] as const) {
      expect(can(role, 'teacher:space')).toBe(false);
      expect(can(role, 'review:create')).toBe(false);
    }
  });

  it('covers every role', () => {
    expect([...ROLES].sort()).toEqual(
      ['admin_super', 'admin_support', 'teacher', 'visitor'].sort(),
    );
  });
});
