import type { Queryable } from '@/lib/db/transaction';
import { SEARCH } from './config';
import type { LevelRef } from './levels';
import { rankTeachers, type RankInput } from './ranking';
import type { Mode, SearchFilters } from './search-params';

// Public search (spec 3.2). Every query starts from `visible_teacher_profiles`, the one
// definition of "publicly visible" (invariant 1), so a hidden profile can never appear here.
// No phone number is read anywhere in this file.

export type Named = { nameFr: string; nameAr: string | null };

export type TeacherCard = {
  userId: string;
  slug: string;
  fullName: string;
  photoKey: string | null;
  diploma: string;
  experience: string;
  modes: Mode[];
  governorate: Named & { slug: string };
  zones: Named[];
  subjects: (Named & { rateMillimes: number })[];
  levels: LevelRef[];
  ratingAvg: number;
  ratingCount: number;
  /** "à partir de": the lowest rate among the subjects matching the search. */
  fromRateMillimes: number;
};

export type SearchResult = {
  cards: TeacherCard[];
  total: number;
  page: number;
  pageCount: number;
};

type ResolvedFilters = {
  governorateId: string | null;
  delegationId: string | null;
  levelId: string | null;
  subjectId: string | null;
};

/** Turns the slugs of the address bar into ids. An unknown slug is ignored like any bad value. */
export async function resolveFilters(
  db: Queryable,
  filters: SearchFilters,
): Promise<ResolvedFilters> {
  const [governorate, level, subject] = await Promise.all([
    filters.governorate
      ? db.query<{ id: string }>(
          'SELECT id FROM governorates WHERE slug = $1 AND is_active',
          [filters.governorate],
        )
      : null,
    filters.level
      ? db.query<{ id: string }>(
          'SELECT id FROM levels WHERE slug = $1 AND is_active',
          [filters.level],
        )
      : null,
    filters.subject
      ? db.query<{ id: string }>(
          `SELECT id FROM subjects WHERE slug = $1 AND is_active AND status = 'approved'`,
          [filters.subject],
        )
      : null,
  ]);
  const governorateId = governorate?.rows[0]?.id ?? null;
  const delegation =
    governorateId && filters.delegation
      ? await db.query<{ id: string }>(
          `SELECT id FROM delegations
           WHERE governorate_id = $1 AND slug = $2 AND is_active`,
          [governorateId, filters.delegation],
        )
      : null;
  return {
    governorateId,
    delegationId: delegation?.rows[0]?.id ?? null,
    levelId: level?.rows[0]?.id ?? null,
    subjectId: subject?.rows[0]?.id ?? null,
  };
}

type CandidateRow = {
  user_id: string;
  has_photo: boolean;
  bio_length: number;
  subject_count: number;
  rating_avg: number;
  rating_count: number;
  last_renewed_at: Date | null;
  approved_at: Date | null;
  from_rate: number;
};

/**
 * The teachers matching the filters, with what the ranking needs. Online teachers appear in
 * every governorate's results (spec 3.2), unless the visitor asked for another mode.
 */
export async function findCandidates(
  db: Queryable,
  filters: SearchFilters,
  resolved: ResolvedFilters,
): Promise<(RankInput & { userId: string })[]> {
  const onlineEverywhere = !filters.mode || filters.mode === 'online';
  const { rows } = await db.query<CandidateRow>(
    `SELECT v.user_id,
            v.photo_key IS NOT NULL AS has_photo,
            char_length(v.bio) AS bio_length,
            (SELECT count(*)::int FROM teacher_subjects x
               JOIN subjects xs ON xs.id = x.subject_id AND xs.status = 'approved' AND xs.is_active
              WHERE x.teacher_id = v.user_id) AS subject_count,
            v.rating_avg::float8 AS rating_avg,
            v.rating_count,
            (SELECT max(g.granted_at) FROM entitlement_grants g
              WHERE g.teacher_id = v.user_id AND g.revoked_at IS NULL) AS last_renewed_at,
            v.approved_at,
            rates.from_rate
       FROM visible_teacher_profiles v
       JOIN LATERAL (
         SELECT min(ts.hourly_rate_millimes)::int AS from_rate
           FROM teacher_subjects ts
           JOIN subjects s ON s.id = ts.subject_id AND s.status = 'approved' AND s.is_active
          WHERE ts.teacher_id = v.user_id
            AND ($1::uuid IS NULL OR ts.subject_id = $1)
            AND ($2::int IS NULL OR ts.hourly_rate_millimes >= $2)
            AND ($3::int IS NULL OR ts.hourly_rate_millimes <= $3)
       ) rates ON rates.from_rate IS NOT NULL
      WHERE ($4::uuid IS NULL OR $6::boolean AND 'online' = ANY(v.modes)
             OR CASE WHEN $5::uuid IS NOT NULL
                     THEN EXISTS (SELECT 1 FROM teacher_zones z
                                   WHERE z.teacher_id = v.user_id AND z.delegation_id = $5)
                     ELSE v.governorate_id = $4 END)
        AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM teacher_levels tl
                                          WHERE tl.teacher_id = v.user_id AND tl.level_id = $7))
        AND ($8::text IS NULL OR $8 = ANY(v.modes))
        AND ($9::numeric IS NULL OR (v.rating_count > 0 AND v.rating_avg >= $9))
      LIMIT $10`,
    [
      resolved.subjectId,
      filters.minRateMillimes ?? null,
      filters.maxRateMillimes ?? null,
      resolved.governorateId,
      resolved.delegationId,
      onlineEverywhere,
      resolved.levelId,
      filters.mode ?? null,
      filters.minRating ?? null,
      SEARCH.maxCandidates,
    ],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    hasPhoto: row.has_photo,
    bioLength: row.bio_length,
    subjectCount: row.subject_count,
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    lastRenewedAt: row.last_renewed_at,
    approvedAt: row.approved_at,
    fromRateMillimes: row.from_rate,
  }));
}

/** The cards of these teachers, in the given order. Re-reads the visible view. */
export async function loadCards(
  db: Queryable,
  ordered: { userId: string; fromRateMillimes: number }[],
): Promise<TeacherCard[]> {
  if (ordered.length === 0) return [];
  const ids = ordered.map((o) => o.userId);

  const [base, zones, subjects, levels] = await Promise.all([
    db.query(
      `SELECT v.user_id, v.slug, v.full_name, v.photo_key, v.diploma, v.experience, v.modes,
              v.rating_avg::float8 AS rating_avg, v.rating_count,
              g.slug AS gov_slug, g.name_fr AS gov_fr, g.name_ar AS gov_ar
         FROM visible_teacher_profiles v
         JOIN governorates g ON g.id = v.governorate_id
        WHERE v.user_id = ANY($1) AND v.slug IS NOT NULL`,
      [ids],
    ),
    db.query(
      `SELECT z.teacher_id, d.name_fr, d.name_ar FROM teacher_zones z
         JOIN delegations d ON d.id = z.delegation_id
        WHERE z.teacher_id = ANY($1) ORDER BY d.name_fr`,
      [ids],
    ),
    db.query(
      `SELECT ts.teacher_id, ts.hourly_rate_millimes, s.name_fr, s.name_ar
         FROM teacher_subjects ts
         JOIN subjects s ON s.id = ts.subject_id AND s.status = 'approved' AND s.is_active
        WHERE ts.teacher_id = ANY($1) ORDER BY s.sort_order`,
      [ids],
    ),
    db.query(
      `SELECT tl.teacher_id, l.cycle, l.grade FROM teacher_levels tl
         JOIN levels l ON l.id = tl.level_id
        WHERE tl.teacher_id = ANY($1)`,
      [ids],
    ),
  ]);

  const group = <R extends { teacher_id: string }>(rows: R[]) => {
    const map = new Map<string, R[]>();
    for (const row of rows) {
      const list = map.get(row.teacher_id) ?? [];
      list.push(row);
      map.set(row.teacher_id, list);
    }
    return map;
  };
  const zonesBy = group(zones.rows);
  const subjectsBy = group(subjects.rows);
  const levelsBy = group(levels.rows);
  const baseBy = new Map(base.rows.map((row) => [row.user_id as string, row]));

  return ordered.flatMap((entry) => {
    const row = baseBy.get(entry.userId);
    if (!row) return []; // became hidden between the two queries
    return [
      {
        userId: row.user_id,
        slug: row.slug,
        fullName: row.full_name,
        photoKey: row.photo_key,
        diploma: row.diploma,
        experience: row.experience,
        modes: row.modes,
        governorate: {
          slug: row.gov_slug,
          nameFr: row.gov_fr,
          nameAr: row.gov_ar,
        },
        zones: (zonesBy.get(row.user_id) ?? []).map((z) => ({
          nameFr: z.name_fr,
          nameAr: z.name_ar,
        })),
        subjects: (subjectsBy.get(row.user_id) ?? []).map((s) => ({
          nameFr: s.name_fr,
          nameAr: s.name_ar,
          rateMillimes: s.hourly_rate_millimes,
        })),
        levels: levelsBy.get(row.user_id) ?? [],
        ratingAvg: row.rating_avg,
        ratingCount: row.rating_count,
        fromRateMillimes: entry.fromRateMillimes,
      } satisfies TeacherCard,
    ];
  });
}

/** One page of results (spec 3.2). */
export async function searchTeachers(
  db: Queryable,
  filters: SearchFilters,
  now: Date = new Date(),
): Promise<SearchResult> {
  const resolved = await resolveFilters(db, filters);
  const candidates = await findCandidates(db, filters, resolved);
  const ranked = rankTeachers(candidates, filters.sort, now);

  const total = ranked.length;
  const pageCount = Math.max(1, Math.ceil(total / SEARCH.pageSize));
  const page = Math.min(filters.page, pageCount);
  const slice = ranked.slice(
    (page - 1) * SEARCH.pageSize,
    page * SEARCH.pageSize,
  );
  return { cards: await loadCards(db, slice), total, page, pageCount };
}

/**
 * Teachers who live in this governorate and teach this subject (online teachers from elsewhere
 * excluded). A landing page is only worth indexing when this is not zero.
 */
export async function countLocalTeachers(
  db: Queryable,
  governorateId: string,
  subjectId: string,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM visible_teacher_profiles v
      WHERE v.governorate_id = $1
        AND EXISTS (SELECT 1 FROM teacher_subjects ts
                      JOIN subjects s ON s.id = ts.subject_id AND s.status = 'approved' AND s.is_active
                     WHERE ts.teacher_id = v.user_id AND ts.subject_id = $2)`,
    [governorateId, subjectId],
  );
  return rows[0].n;
}
