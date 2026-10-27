import type { PoolClient } from 'pg';
import type { Queryable } from '@/lib/db/transaction';

// Entitlements (spec 2.2): two independent expiry dates, visibility and Dashboard.

export const DAY_MS = 24 * 60 * 60 * 1000;
/** After the Dashboard ends it stays readable, with export, for 30 days (spec 2.5). */
export const GRACE_DAYS = 30;

export type Entitlements = {
  teacherId: string;
  visibilityUntil: Date | null;
  dashboardUntil: Date | null;
  pendingVisibilityDays: number;
  pendingDashboardDays: number;
  lastPlanId: string | null;
};

export async function getEntitlements(
  db: Queryable,
  teacherId: string,
): Promise<Entitlements | null> {
  const { rows } = await db.query(
    'SELECT * FROM entitlements WHERE teacher_id = $1',
    [teacherId],
  );
  const r = rows[0];
  return r
    ? {
        teacherId: r.teacher_id,
        visibilityUntil: r.visibility_until,
        dashboardUntil: r.dashboard_until,
        pendingVisibilityDays: r.pending_visibility_days,
        pendingDashboardDays: r.pending_dashboard_days,
        lastPlanId: r.last_plan_id,
      }
    : null;
}

/**
 * New end date after adding `days`: counted from the LATER of now and the current end, so
 * renewing early never loses days (spec 2.2, acceptance test 10).
 */
export function extendUntil(
  current: Date | null,
  days: number,
  now: Date,
): Date {
  const start = current && current.getTime() > now.getTime() ? current : now;
  return new Date(start.getTime() + days * DAY_MS);
}

/** Whole days left, rounded up: 9.2 days left counts as 10. Zero when over. */
export function daysLeft(until: Date | null, now: Date): number {
  if (!until || until.getTime() <= now.getTime()) return 0;
  return Math.ceil((until.getTime() - now.getTime()) / DAY_MS);
}

export type DashboardAccess = 'full' | 'read_only' | 'none';

/**
 * What the teacher may do in the Dashboard (spec 2.5, 5.11): full while dashboard_until is in
 * the future, read-only with export for 30 days after, then locked.
 */
export function dashboardAccess(
  dashboardUntil: Date | null,
  now: Date,
): DashboardAccess {
  if (!dashboardUntil) return 'none';
  if (dashboardUntil.getTime() > now.getTime()) return 'full';
  if (now.getTime() - dashboardUntil.getTime() <= GRACE_DAYS * DAY_MS)
    return 'read_only';
  return 'none';
}

/** Is the paid visibility running? (The public rule also needs approval: teacher_is_visible.) */
export function visibilityActive(
  visibilityUntil: Date | null,
  now: Date,
): boolean {
  return visibilityUntil !== null && visibilityUntil.getTime() > now.getTime();
}

// ------------------------------------------------------------------- changing the dates

export type GrantSource = 'code' | 'founding' | 'admin';

export type GrantInput = {
  teacherId: string;
  source: GrantSource;
  visibilityDays: number;
  dashboardDays: number;
  now: Date;
  note?: string | null;
  planId?: string | null;
  activationCodeId?: string | null;
  paymentRequestId?: string | null;
  grantedBy?: string | null;
};

async function ensureRow(client: PoolClient, teacherId: string): Promise<void> {
  await client.query(
    'INSERT INTO entitlements (teacher_id) VALUES ($1) ON CONFLICT (teacher_id) DO NOTHING',
    [teacherId],
  );
}

async function writeGrant(
  client: PoolClient,
  input: GrantInput,
  asCredit: boolean,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO entitlement_grants
       (teacher_id, source, visibility_days, dashboard_days, granted_at, as_credit, started_at,
        activation_code_id, payment_request_id, granted_by, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      input.teacherId,
      input.source,
      input.visibilityDays,
      input.dashboardDays,
      input.now,
      asCredit,
      asCredit ? null : input.now,
      input.activationCodeId ?? null,
      input.paymentRequestId ?? null,
      input.grantedBy ?? null,
      input.note ?? null,
    ],
  );
  return rows[0].id;
}

/**
 * Adds days. If the profile is APPROVED the clock runs now. Otherwise the days are kept as
 * credit and start at approval (spec 2.5 "fairness rule", invariant 3, acceptance test 11).
 * Returns what happened, so screens can say so.
 */
export async function addDays(
  client: PoolClient,
  input: GrantInput,
): Promise<{ grantId: string; credited: boolean }> {
  await ensureRow(client, input.teacherId);
  const { rows } = await client.query<{ status: string | null }>(
    'SELECT (SELECT status FROM teacher_profiles WHERE user_id = $1) AS status',
    [input.teacherId],
  );
  const approved = rows[0].status === 'approved';

  if (!approved) {
    await client.query(
      `UPDATE entitlements SET
         pending_visibility_days = pending_visibility_days + $2,
         pending_dashboard_days = pending_dashboard_days + $3,
         last_plan_id = COALESCE($4, last_plan_id)
       WHERE teacher_id = $1`,
      [
        input.teacherId,
        input.visibilityDays,
        input.dashboardDays,
        input.planId ?? null,
      ],
    );
    return { grantId: await writeGrant(client, input, true), credited: true };
  }

  await applyDays(
    client,
    input.teacherId,
    input.visibilityDays,
    input.dashboardDays,
    input.now,
    input.planId,
  );
  return { grantId: await writeGrant(client, input, false), credited: false };
}

/** Moves the two dates forward by the given days, each from max(now, its own end). */
async function applyDays(
  client: PoolClient,
  teacherId: string,
  visibilityDays: number,
  dashboardDays: number,
  now: Date,
  planId?: string | null,
): Promise<void> {
  const { rows } = await client.query<{
    visibility_until: Date | null;
    dashboard_until: Date | null;
  }>(
    'SELECT visibility_until, dashboard_until FROM entitlements WHERE teacher_id = $1 FOR UPDATE',
    [teacherId],
  );
  const current = rows[0];
  await client.query(
    `UPDATE entitlements SET visibility_until = $2, dashboard_until = $3,
       last_plan_id = COALESCE($4, last_plan_id)
     WHERE teacher_id = $1`,
    [
      teacherId,
      visibilityDays > 0
        ? extendUntil(current.visibility_until, visibilityDays, now)
        : current.visibility_until,
      dashboardDays > 0
        ? extendUntil(current.dashboard_until, dashboardDays, now)
        : current.dashboard_until,
      planId ?? null,
    ],
  );
}

/**
 * At approval: the days bought earlier start now (invariant 3). Returns the days started.
 */
export async function startCredit(
  client: PoolClient,
  teacherId: string,
  now: Date,
): Promise<{ visibilityDays: number; dashboardDays: number }> {
  await ensureRow(client, teacherId);
  const { rows } = await client.query<{ v: number; d: number }>(
    `SELECT pending_visibility_days AS v, pending_dashboard_days AS d
     FROM entitlements WHERE teacher_id = $1 FOR UPDATE`,
    [teacherId],
  );
  const { v, d } = rows[0];
  if (v === 0 && d === 0) return { visibilityDays: 0, dashboardDays: 0 };

  await applyDays(client, teacherId, v, d, now);
  await client.query(
    `UPDATE entitlements SET pending_visibility_days = 0, pending_dashboard_days = 0
     WHERE teacher_id = $1`,
    [teacherId],
  );
  await client.query(
    `UPDATE entitlement_grants SET started_at = $2
     WHERE teacher_id = $1 AND as_credit AND started_at IS NULL`,
    [teacherId, now],
  );
  return { visibilityDays: v, dashboardDays: d };
}
