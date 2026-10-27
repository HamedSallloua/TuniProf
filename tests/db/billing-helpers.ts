import type { Pool } from 'pg';
import { issueCode, redeemCode } from '@/lib/billing/codes';
import {
  createPaymentRequest,
  type PaymentRequest,
} from '@/lib/billing/payments';
import { saveProfile, submitProfile } from '@/lib/profile/repo';
import { approveProfile } from '@/lib/profile/review';
import { T0 } from './auth-helpers';
import {
  completeInput,
  createTeacher,
  type CatalogueIds,
} from './profile-helpers';

export const DAY = 24 * 60 * 60 * 1000;
export const days = (n: number) => n * DAY;
export const atDays = (n: number, base: Date = T0) =>
  new Date(base.getTime() + n * DAY);

/** A teacher whose profile is complete and submitted (waiting for an admin). */
export async function createPendingTeacher(
  pool: Pool,
  ids: CatalogueIds,
  options: { phone?: string; submittedAt?: Date } = {},
): Promise<string> {
  const teacher = await createTeacher(pool, { phone: options.phone });
  const saved = await saveProfile(pool, teacher, completeInput(ids), {
    strict: true,
  });
  if (!saved.ok) throw new Error(`profile save failed: ${saved.error}`);
  const submitted = await submitProfile(
    pool,
    teacher,
    options.submittedAt ?? T0,
  );
  if (!submitted.ok) throw new Error(`submit failed: ${submitted.error}`);
  return teacher;
}

/** A teacher approved by `admin` at `now` (founding offer and credit apply as in real life). */
export async function createApprovedTeacher(
  pool: Pool,
  ids: CatalogueIds,
  admin: string,
  now: Date = T0,
  options: { phone?: string } = {},
): Promise<string> {
  const teacher = await createPendingTeacher(pool, ids, {
    phone: options.phone,
    submittedAt: now,
  });
  const result = await approveProfile(pool, admin, teacher, now);
  if (!result.ok) throw new Error(`approve failed: ${result.reason}`);
  return teacher;
}

export async function planBySlug(pool: Pool, slug: string) {
  const { rows } = await pool.query('SELECT id FROM plans WHERE slug = $1', [
    slug,
  ]);
  return rows[0].id as string;
}

let transactionCounter = 0;

/** Full purchase: request, admin verification, code. Returns the plain code. */
export async function purchaseCode(
  pool: Pool,
  admin: string,
  teacher: string,
  options: { plan?: string; withDashboard?: boolean; now?: Date } = {},
): Promise<{ code: string; request: PaymentRequest }> {
  const now = options.now ?? T0;
  const created = await createPaymentRequest(
    pool,
    teacher,
    {
      planId: await planBySlug(pool, options.plan ?? 'trimestriel'),
      withDashboard: options.withDashboard ?? false,
      method: 'flouci',
    },
    now,
  );
  if (!created.ok) throw new Error(`request failed: ${created.reason}`);
  transactionCounter += 1;
  const issued = await issueCode(
    pool,
    admin,
    created.request.id,
    {
      transactionRef: `TX-${transactionCounter}-${created.request.reference}`,
      transactionDate: '2026-10-26',
    },
    now,
  );
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  return { code: issued.code, request: created.request };
}

/** Buy a code and redeem it at once. */
export async function buyAndRedeem(
  pool: Pool,
  admin: string,
  teacher: string,
  options: { plan?: string; withDashboard?: boolean; now?: Date } = {},
) {
  const { code } = await purchaseCode(pool, admin, teacher, options);
  const result = await redeemCode(pool, teacher, code, options.now ?? T0);
  if (!result.ok) throw new Error(`redeem failed: ${result.reason}`);
  return result;
}

export async function entitlementsOf(pool: Pool, teacher: string) {
  const { rows } = await pool.query(
    'SELECT * FROM entitlements WHERE teacher_id = $1',
    [teacher],
  );
  return rows[0] as
    | {
        visibility_until: Date | null;
        dashboard_until: Date | null;
        pending_visibility_days: number;
        pending_dashboard_days: number;
      }
    | undefined;
}

export async function isVisible(
  pool: Pool,
  teacher: string,
  at: Date = new Date(),
): Promise<boolean> {
  const { rows } = await pool.query('SELECT teacher_is_visible($1, $2) AS v', [
    teacher,
    at,
  ]);
  return rows[0].v;
}
