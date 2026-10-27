import type { Queryable } from '@/lib/db/transaction';
import { roundToHalfDinar } from '@/lib/money';

// Plans and prices (spec 2.1). The numbers live in the `plans` table and are edited by the
// admin; nothing here knows a price.

export type Plan = {
  id: string;
  slug: string;
  nameFr: string;
  nameAr: string;
  durationDays: number;
  priceVisibilityMillimes: number;
  priceWithDashboardMillimes: number;
  sortOrder: number;
};

type PlanRow = {
  id: string;
  slug: string;
  name_fr: string;
  name_ar: string;
  duration_days: number;
  price_visibility_millimes: number;
  price_with_dashboard_millimes: number;
  sort_order: number;
};

function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    slug: row.slug,
    nameFr: row.name_fr,
    nameAr: row.name_ar,
    durationDays: row.duration_days,
    priceVisibilityMillimes: row.price_visibility_millimes,
    priceWithDashboardMillimes: row.price_with_dashboard_millimes,
    sortOrder: row.sort_order,
  };
}

export async function listActivePlans(db: Queryable): Promise<Plan[]> {
  const { rows } = await db.query<PlanRow>(
    'SELECT * FROM plans WHERE is_active ORDER BY sort_order',
  );
  return rows.map(toPlan);
}

export async function getPlan(
  db: Queryable,
  planId: string,
): Promise<Plan | null> {
  const { rows } = await db.query<PlanRow>(
    'SELECT * FROM plans WHERE id = $1',
    [planId],
  );
  return rows[0] ? toPlan(rows[0]) : null;
}

/** What the teacher pays: visibility only, or the bundle with the Dashboard. */
export function planPrice(plan: Plan, withDashboard: boolean): number {
  return withDashboard
    ? plan.priceWithDashboardMillimes
    : plan.priceVisibilityMillimes;
}

/** The plans are quoted in "months" of 30 days: 365 days count as 12 months (spec 2.1). */
export function nominalMonths(durationDays: number): number {
  return Math.max(1, Math.round(durationDays / 30));
}

/** Price per month in millimes (spec 2.1: 40.500 over 3 months = 13.500). */
export function pricePerMonth(
  priceMillimes: number,
  durationDays: number,
): number {
  return Math.round(priceMillimes / nominalMonths(durationDays));
}

/**
 * Saving in percent against paying the monthly plan every month (spec 2.1:
 * 10% for the quarter, 20% for the half year, 33% for the year, visibility only).
 */
export function savingPercent(
  priceMillimes: number,
  durationDays: number,
  monthlyPriceMillimes: number,
): number {
  const full = monthlyPriceMillimes * nominalMonths(durationDays);
  if (full <= 0) return 0;
  return Math.max(0, Math.round((1 - priceMillimes / full) * 100));
}

/**
 * Price of adding the Dashboard to the current term (spec 2.2): the plan's add-on price
 * (bundle minus visibility only) x remaining days / plan days, rounded to 0.5 DT.
 */
export function upgradePrice(plan: Plan, remainingDays: number): number {
  const addOn = plan.priceWithDashboardMillimes - plan.priceVisibilityMillimes;
  return roundToHalfDinar((addOn * remainingDays) / plan.durationDays);
}
