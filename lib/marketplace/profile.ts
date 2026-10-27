import type { Queryable } from '@/lib/db/transaction';
import type { LevelRef } from './levels';
import type { Mode } from './search-params';
import type { Named } from './search';

// What the public profile page shows (spec 3.4). Read through `visible_teacher_profiles`
// only, so a hidden profile has no page. The phone number is never read here: it only
// leaves the database through the reveal (lib/marketplace/reveal.ts).

export type PublicProfile = {
  userId: string;
  slug: string;
  fullName: string;
  photoKey: string | null;
  diploma: string;
  experience: string;
  bio: string;
  modes: Mode[];
  ratingAvg: number;
  ratingCount: number;
  governorate: Named & { slug: string };
  zones: Named[];
  subjects: (Named & { slug: string; rateMillimes: number })[];
  levels: LevelRef[];
};

export async function getPublicProfile(
  db: Queryable,
  slug: string,
): Promise<PublicProfile | null> {
  const { rows } = await db.query(
    `SELECT v.user_id, v.slug, v.full_name, v.photo_key, v.diploma, v.experience, v.bio,
            v.modes, v.rating_avg::float8 AS rating_avg, v.rating_count,
            g.slug AS gov_slug, g.name_fr AS gov_fr, g.name_ar AS gov_ar
       FROM visible_teacher_profiles v
       JOIN governorates g ON g.id = v.governorate_id
      WHERE v.slug = $1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;

  const [zones, subjects, levels] = await Promise.all([
    db.query(
      `SELECT d.name_fr, d.name_ar FROM teacher_zones z
         JOIN delegations d ON d.id = z.delegation_id
        WHERE z.teacher_id = $1 ORDER BY d.name_fr`,
      [row.user_id],
    ),
    db.query(
      `SELECT s.slug, s.name_fr, s.name_ar, ts.hourly_rate_millimes
         FROM teacher_subjects ts
         JOIN subjects s ON s.id = ts.subject_id AND s.status = 'approved' AND s.is_active
        WHERE ts.teacher_id = $1 ORDER BY s.sort_order`,
      [row.user_id],
    ),
    db.query(
      `SELECT l.cycle, l.grade FROM teacher_levels tl
         JOIN levels l ON l.id = tl.level_id
        WHERE tl.teacher_id = $1`,
      [row.user_id],
    ),
  ]);

  return {
    userId: row.user_id,
    slug: row.slug,
    fullName: row.full_name,
    photoKey: row.photo_key,
    diploma: row.diploma,
    experience: row.experience,
    bio: row.bio,
    modes: row.modes,
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    governorate: {
      slug: row.gov_slug,
      nameFr: row.gov_fr,
      nameAr: row.gov_ar,
    },
    zones: zones.rows.map((z) => ({ nameFr: z.name_fr, nameAr: z.name_ar })),
    subjects: subjects.rows.map((s) => ({
      slug: s.slug,
      nameFr: s.name_fr,
      nameAr: s.name_ar,
      rateMillimes: s.hourly_rate_millimes,
    })),
    levels: levels.rows,
  };
}

export type SitemapData = {
  profiles: { slug: string; updatedAt: Date }[];
  /** Governorate + subject pairs with at least one teacher living there. */
  landings: { governorate: string; subject: string }[];
};

/** The addresses the sitemap may list. Hidden profiles are never in it. */
export async function getSitemapData(db: Queryable): Promise<SitemapData> {
  const [profiles, landings] = await Promise.all([
    db.query<{ slug: string; updated_at: Date }>(
      `SELECT v.slug, p.updated_at
         FROM visible_teacher_profiles v
         JOIN teacher_profiles p ON p.user_id = v.user_id
        WHERE v.slug IS NOT NULL
        ORDER BY v.slug`,
    ),
    db.query<{ governorate: string; subject: string }>(
      `SELECT DISTINCT g.slug AS governorate, s.slug AS subject
         FROM visible_teacher_profiles v
         JOIN governorates g ON g.id = v.governorate_id AND g.is_active
         JOIN teacher_subjects ts ON ts.teacher_id = v.user_id
         JOIN subjects s ON s.id = ts.subject_id AND s.status = 'approved' AND s.is_active
        ORDER BY g.slug, s.slug`,
    ),
  ]);
  return {
    profiles: profiles.rows.map((r) => ({
      slug: r.slug,
      updatedAt: r.updated_at,
    })),
    landings: landings.rows,
  };
}
