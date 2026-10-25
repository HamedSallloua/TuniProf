// What each role may do. Everything not listed here is forbidden.
// Reviewers (role "visitor") have no password and only one right: writing a review.

export type Role = 'teacher' | 'visitor' | 'admin_super' | 'admin_support';

export type Permission =
  | 'review:create' // write a review (spec 3.5)
  | 'teacher:space' // teacher space and, with an active plan, the dashboard
  | 'admin:panel' // review queue, payments, moderation
  | 'admin:settings'; // prices, payment accounts, settings (super admin only, spec 6)

const GRANTS: Record<Role, readonly Permission[]> = {
  visitor: ['review:create'],
  // Teacher accounts cannot post reviews (spec 3.5).
  teacher: ['teacher:space'],
  admin_support: ['admin:panel'],
  admin_super: ['admin:panel', 'admin:settings'],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

export const ROLES: readonly Role[] = [
  'teacher',
  'visitor',
  'admin_super',
  'admin_support',
];
