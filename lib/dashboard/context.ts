import { getCurrentUser, requirePermission } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import type { SessionUser } from '@/lib/auth/session';
import {
  dashboardAccess,
  getEntitlements,
  GRACE_DAYS,
  DAY_MS,
  type DashboardAccess,
} from '@/lib/billing/entitlements';
import { getPool } from '@/lib/db/client';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

// Who may use the Dashboard, and how (spec 2.5, 5.11): full while dashboard_until is in the
// future, read-only for 30 days after, then locked. Nothing is stored: it is read from the date.

export type DashboardContext = {
  user: SessionUser;
  access: 'full' | 'read_only';
  /** The last day of read-only access, when the Dashboard has ended. */
  readOnlyUntil: Date | null;
  now: Date;
};

async function accessOf(
  teacherId: string,
  now: Date,
): Promise<{ access: DashboardAccess; until: Date | null }> {
  const entitlements = await getEntitlements(getPool(), teacherId);
  const until = entitlements?.dashboardUntil ?? null;
  return { access: dashboardAccess(until, now), until };
}

/**
 * For the pages: sends visitors to the login page, and teachers without a Dashboard (never
 * bought, or ended more than 30 days ago) to their subscription page.
 */
export async function requireDashboard(
  locale: Locale,
  now: Date = new Date(),
): Promise<DashboardContext> {
  const user = await requirePermission('teacher:space', locale);
  const { access, until } = await accessOf(user.id, now);
  if (access === 'none')
    redirect({ href: '/espace-professeur/abonnement', locale });
  return {
    user,
    access: access === 'full' ? 'full' : 'read_only',
    readOnlyUntil:
      access === 'read_only' && until
        ? new Date(until.getTime() + GRACE_DAYS * DAY_MS)
        : null,
    now,
  };
}

/**
 * For the server actions: the signed-in teacher when the Dashboard is fully active, or the
 * reason why not. Every change goes through here, so the read-only period cannot be bypassed
 * from the browser.
 */
export async function writableTeacher(
  now: Date = new Date(),
): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'not_signed_in' | 'read_only' | 'no_access' }
> {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'teacher:space'))
    return { ok: false, reason: 'not_signed_in' };
  const { access } = await accessOf(user.id, now);
  if (access === 'full') return { ok: true, user };
  return {
    ok: false,
    reason: access === 'read_only' ? 'read_only' : 'no_access',
  };
}

/** Where a form may send the teacher back to: only the Dashboard's own pages. */
export function safeReturnPath(value: unknown, fallback: string): string {
  return typeof value === 'string' &&
    value.length <= 300 &&
    /^\/(groupes|calendrier)(\/[A-Za-z0-9_-]+)*(\?[A-Za-z0-9_=&%.-]*)?$/.test(
      value,
    )
    ? value
    : fallback;
}
