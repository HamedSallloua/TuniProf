import type { Queryable } from '@/lib/db/transaction';

// Read-only catalogue data the profile form needs, and the rate limits from the settings.

export type NamedItem = { id: string; nameFr: string; nameAr: string | null };

export type FormCatalogue = {
  governorates: (NamedItem & { slug: string })[];
  delegations: (NamedItem & { governorateId: string })[];
  levels: (NamedItem & { slug: string; cycle: string; grade: number })[];
  subjects: (NamedItem & { slug: string })[];
  rateRange: RateRange;
};

export type RateRange = { min: number; max: number };

export const DEFAULT_RATE_RANGE: RateRange = { min: 5000, max: 300000 };

/** Allowed hourly rates in millimes (spec 4.2: 5 to 300 DT, editable in the settings). */
export async function getRateRange(db: Queryable): Promise<RateRange> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM settings
     WHERE key IN ('profile.rate_min_millimes', 'profile.rate_max_millimes')`,
  );
  const byKey = new Map(rows.map((row) => [row.key, Number(row.value)]));
  const min = byKey.get('profile.rate_min_millimes');
  const max = byKey.get('profile.rate_max_millimes');
  return {
    min: Number.isInteger(min) && min! > 0 ? min! : DEFAULT_RATE_RANGE.min,
    max: Number.isInteger(max) && max! > 0 ? max! : DEFAULT_RATE_RANGE.max,
  };
}

export async function getFormCatalogue(db: Queryable): Promise<FormCatalogue> {
  const [gov, del, lev, sub, rateRange] = await Promise.all([
    db.query(
      `SELECT id, slug, name_fr, name_ar FROM governorates WHERE is_active ORDER BY sort_order`,
    ),
    db.query(
      `SELECT id, governorate_id, name_fr, name_ar FROM delegations
       WHERE is_active ORDER BY name_fr`,
    ),
    db.query(
      `SELECT id, slug, cycle, grade, name_fr, name_ar FROM levels
       WHERE is_active ORDER BY sort_order`,
    ),
    // Approved subjects only: a teacher's own "Autre" suggestion is shown separately.
    db.query(
      `SELECT id, slug, name_fr, name_ar FROM subjects
       WHERE is_active AND status = 'approved' ORDER BY sort_order`,
    ),
    getRateRange(db),
  ]);

  return {
    governorates: gov.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      nameFr: r.name_fr,
      nameAr: r.name_ar,
    })),
    delegations: del.rows.map((r) => ({
      id: r.id,
      governorateId: r.governorate_id,
      nameFr: r.name_fr,
      nameAr: r.name_ar,
    })),
    levels: lev.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      cycle: r.cycle,
      grade: r.grade,
      nameFr: r.name_fr,
      nameAr: r.name_ar,
    })),
    subjects: sub.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      nameFr: r.name_fr,
      nameAr: r.name_ar,
    })),
    rateRange,
  };
}

/** The name in the page language, falling back to French. */
export function pickName(
  item: { nameFr: string; nameAr: string | null },
  locale: string,
): string {
  return locale === 'ar' && item.nameAr ? item.nameAr : item.nameFr;
}
