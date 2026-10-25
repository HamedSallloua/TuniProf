import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction, type Queryable } from '@/lib/db/transaction';
import { slugify } from '@/lib/slug';
import type { Diploma, Experience, Mode } from './rules';

// DATA-ACCESS LAYER for a teacher's own profile (invariant 16). Every function needs the
// authenticated teacher's id and only ever touches that teacher's rows: there is no
// function that takes a profile id from a request. Admin access is in review.ts.

export type ProfileStatus =
  'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';

export type PendingVersion = {
  fullName: string | null;
  photoKey: string | null;
  bio: string | null;
  diploma: Diploma | null;
  submittedAt: string;
};

export type OwnSubject = {
  subjectId: string;
  nameFr: string;
  nameAr: string;
  status: 'approved' | 'pending';
  rateMillimes: number;
};

export type TeacherProfile = {
  userId: string;
  slug: string | null;
  fullName: string | null;
  photoKey: string | null;
  diploma: Diploma | null;
  experience: Experience | null;
  bio: string | null;
  governorateId: string | null;
  modes: Mode[];
  status: ProfileStatus;
  rejectionReason: string | null;
  rejectionNote: string | null;
  suspensionReason: string | null;
  isListed: boolean;
  ratingAvg: number;
  ratingCount: number;
  pendingVersion: PendingVersion | null;
  versionRejectionReason: string | null;
  versionRejectionNote: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  updatedAt: Date;
  phoneVerified: boolean;
  levelIds: string[];
  zoneIds: string[];
  subjects: OwnSubject[];
};

const PROFILE_SQL = `
  SELECT p.*, u.phone_verified_at IS NOT NULL AS phone_verified,
    COALESCE((SELECT array_agg(level_id::text) FROM teacher_levels WHERE teacher_id = p.user_id), '{}') AS level_ids,
    COALESCE((SELECT array_agg(delegation_id::text) FROM teacher_zones WHERE teacher_id = p.user_id), '{}') AS zone_ids
  FROM teacher_profiles p JOIN users u ON u.id = p.user_id
  WHERE p.user_id = $1`;

export async function loadProfile(
  db: Queryable,
  teacherId: string,
): Promise<TeacherProfile | null> {
  const { rows } = await db.query(PROFILE_SQL, [teacherId]);
  const p = rows[0];
  if (!p) return null;

  const { rows: subjectRows } = await db.query(
    `SELECT ts.subject_id, s.name_fr, s.name_ar, s.status, ts.hourly_rate_millimes
     FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
     WHERE ts.teacher_id = $1 ORDER BY s.sort_order, s.name_fr`,
    [teacherId],
  );

  const pending = p.pending_version as {
    full_name?: string | null;
    photo_key?: string | null;
    bio?: string | null;
    diploma?: Diploma | null;
    submitted_at?: string;
  } | null;

  return {
    userId: p.user_id,
    slug: p.slug,
    fullName: p.full_name,
    photoKey: p.photo_key,
    diploma: p.diploma,
    experience: p.experience,
    bio: p.bio,
    governorateId: p.governorate_id,
    modes: p.modes,
    status: p.status,
    rejectionReason: p.rejection_reason,
    rejectionNote: p.rejection_note,
    suspensionReason: p.suspension_reason,
    isListed: p.is_listed,
    ratingAvg: Number(p.rating_avg),
    ratingCount: p.rating_count,
    pendingVersion: pending
      ? {
          fullName: pending.full_name ?? null,
          photoKey: pending.photo_key ?? null,
          bio: pending.bio ?? null,
          diploma: pending.diploma ?? null,
          submittedAt: pending.submitted_at ?? '',
        }
      : null,
    versionRejectionReason: p.version_rejection_reason,
    versionRejectionNote: p.version_rejection_note,
    submittedAt: p.submitted_at,
    approvedAt: p.approved_at,
    updatedAt: p.updated_at,
    phoneVerified: p.phone_verified,
    levelIds: p.level_ids,
    zoneIds: p.zone_ids,
    subjects: subjectRows.map((s) => ({
      subjectId: s.subject_id,
      nameFr: s.name_fr,
      nameAr: s.name_ar,
      status: s.status,
      rateMillimes: s.hourly_rate_millimes,
    })),
  };
}

/** The teacher's profile, created empty (draft) the first time it is needed. */
export async function getOrCreateProfile(
  pool: Pool,
  teacherId: string,
): Promise<TeacherProfile> {
  await pool.query(
    'INSERT INTO teacher_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
    [teacherId],
  );
  return (await loadProfile(pool, teacherId))!;
}

// ------------------------------------------------------------------------------- saving edits

export type SubjectChoice = {
  /** An approved subject from the list. */
  subjectId?: string;
  /** "Autre": a subject the teacher typed. Needs an admin's approval before it is public. */
  customName?: string;
  rateMillimes: number;
};

/** Everything the form sends, already validated field by field (see form.ts). */
export type ProfileInput = {
  fullName: string | null;
  diploma: Diploma | null;
  experience: Experience | null;
  bio: string | null;
  governorateId: string | null;
  modes: Mode[];
  levelIds: string[];
  zoneIds: string[];
  subjects: SubjectChoice[];
  /** keep the current photo, remove it, or use `newPhotoKey` (already stored). */
  photo:
    | { action: 'keep' }
    | { action: 'remove' }
    | { action: 'replace'; key: string };
};

export type SaveError =
  'suspended' | 'incomplete' | 'invalidSelection' | 'tooManyCustomSubjects';

export type SaveResult =
  | { ok: true; profile: TeacherProfile; unusedPhotoKeys: string[] }
  | { ok: false; error: SaveError };

const MAX_CUSTOM_SUBJECTS = 3;

/**
 * Saves the form. What happens depends on the status (spec 4.2, "Review rules"):
 * - draft, rejected, pending: everything is saved as is (it is not public yet);
 * - approved: price, zone, level, subject, mode and experience changes apply at once;
 *   changes to name, photo, bio or diploma are kept as a PENDING VERSION and the approved
 *   one stays live until an admin approves the new one;
 * - suspended: nothing can be changed.
 * `strict` (used on submit and for approved profiles) refuses an incomplete result.
 * Returns the photo files that are no longer used, for the caller to delete.
 */
export async function saveProfile(
  pool: Pool,
  teacherId: string,
  input: ProfileInput,
  options: { strict: boolean },
  now: Date = new Date(),
): Promise<SaveResult> {
  try {
    return await withTransaction(pool, async (client): Promise<SaveResult> => {
      await client.query(
        'INSERT INTO teacher_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [teacherId],
      );
      const { rows } = await client.query(
        'SELECT * FROM teacher_profiles WHERE user_id = $1 FOR UPDATE',
        [teacherId],
      );
      const current = rows[0];
      if (current.status === 'suspended')
        return { ok: false, error: 'suspended' };

      const unused: string[] = [];
      const approved = current.status === 'approved';

      // 1. Subjects: link the chosen ones, creating "Autre" subjects (pending) when needed.
      const subjects = await resolveSubjects(client, teacherId, input.subjects);
      if (!subjects.ok) return subjects;

      // 2. The photo.
      const livePhoto: string | null = current.photo_key;
      const previousPending = current.pending_version as {
        photo_key?: string | null;
      } | null;
      let photoKey = livePhoto;
      if (approved)
        photoKey = previousPending
          ? (previousPending.photo_key ?? null)
          : livePhoto;
      if (input.photo.action === 'remove') photoKey = null;
      if (input.photo.action === 'replace') photoKey = input.photo.key;

      // 3. Name, photo, bio, diploma.
      if (approved) {
        const proposed = {
          full_name: input.fullName ?? current.full_name,
          photo_key: photoKey,
          bio: input.bio ?? current.bio,
          diploma: input.diploma ?? current.diploma,
        };
        const changed =
          proposed.full_name !== current.full_name ||
          proposed.photo_key !== livePhoto ||
          proposed.bio !== current.bio ||
          proposed.diploma !== current.diploma;

        // A photo that was in the old pending version and is not kept is unused now.
        const oldPendingPhoto = previousPending?.photo_key ?? null;
        if (
          oldPendingPhoto &&
          oldPendingPhoto !== livePhoto &&
          oldPendingPhoto !== proposed.photo_key
        ) {
          unused.push(oldPendingPhoto);
        }

        if (changed) {
          await client.query(
            `UPDATE teacher_profiles SET pending_version = $2::jsonb,
               version_rejection_reason = NULL, version_rejection_note = NULL
             WHERE user_id = $1`,
            [
              teacherId,
              JSON.stringify({ ...proposed, submitted_at: now.toISOString() }),
            ],
          );
        } else {
          await client.query(
            'UPDATE teacher_profiles SET pending_version = NULL WHERE user_id = $1',
            [teacherId],
          );
        }
        await client.query(
          'UPDATE teacher_profiles SET experience = $2, modes = $3 WHERE user_id = $1',
          [
            teacherId,
            input.experience ?? current.experience,
            // An empty list is a real request (remove all modes): it is refused below,
            // because the profile would be incomplete.
            input.modes,
          ],
        );
      } else {
        if (livePhoto && livePhoto !== photoKey) unused.push(livePhoto);
        await client.query(
          `UPDATE teacher_profiles SET full_name = $2, photo_key = $3, diploma = $4,
             experience = $5, bio = $6, modes = $7
           WHERE user_id = $1`,
          [
            teacherId,
            input.fullName,
            photoKey,
            input.diploma,
            input.experience,
            input.bio,
            input.modes,
          ],
        );
      }

      // 4. Governorate and zones. A zone must belong to the governorate, so changing
      //    governorate needs the old zones removed first (the database insists), so the
      //    zones are always removed, then written again from the form.
      const governorateId =
        input.governorateId ?? (approved ? current.governorate_id : null);
      await client.query('DELETE FROM teacher_zones WHERE teacher_id = $1', [
        teacherId,
      ]);
      await client.query(
        'UPDATE teacher_profiles SET governorate_id = $2 WHERE user_id = $1',
        [teacherId, governorateId],
      );
      if (governorateId && input.zoneIds.length) {
        await client.query(
          `INSERT INTO teacher_zones (teacher_id, governorate_id, delegation_id)
           SELECT $1, $2, z FROM unnest($3::uuid[]) AS z`,
          [teacherId, governorateId, input.zoneIds],
        );
      }

      // 5. Levels and subjects.
      await client.query('DELETE FROM teacher_levels WHERE teacher_id = $1', [
        teacherId,
      ]);
      if (input.levelIds.length) {
        await client.query(
          'INSERT INTO teacher_levels (teacher_id, level_id) SELECT $1, l FROM unnest($2::uuid[]) AS l',
          [teacherId, input.levelIds],
        );
      }
      await client.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [
        teacherId,
      ]);
      if (subjects.rows.length) {
        await client.query(
          `INSERT INTO teacher_subjects (teacher_id, subject_id, hourly_rate_millimes)
           SELECT $1, s, r FROM unnest($2::uuid[], $3::int[]) AS t(s, r)`,
          [
            teacherId,
            subjects.rows.map((r) => r.subjectId),
            subjects.rows.map((r) => r.rate),
          ],
        );
      }

      // 6. An approved profile must stay complete, and a submission must be complete.
      if (options.strict || approved) {
        const { rows: check } = await client.query<{ ok: boolean }>(
          'SELECT profile_is_complete($1) AS ok',
          [teacherId],
        );
        if (!check[0].ok) {
          // Undo everything done above in this transaction.
          throw new IncompleteError();
        }
      }

      const profile = (await loadProfile(client, teacherId))!;
      return { ok: true, profile, unusedPhotoKeys: unused };
    });
  } catch (error) {
    if (error instanceof IncompleteError)
      return { ok: false, error: 'incomplete' };
    // 23503: a chosen level, zone, subject or governorate does not exist (or the zone is
    // not in the chosen governorate).
    if ((error as { code?: string }).code === '23503')
      return { ok: false, error: 'invalidSelection' };
    throw error;
  }
}

class IncompleteError extends Error {}

type ResolvedSubjects =
  | { ok: true; rows: { subjectId: string; rate: number }[] }
  | { ok: false; error: SaveError };

async function resolveSubjects(
  client: PoolClient,
  teacherId: string,
  choices: SubjectChoice[],
): Promise<ResolvedSubjects> {
  const rows: { subjectId: string; rate: number }[] = [];
  const seen = new Set<string>();

  for (const choice of choices) {
    let subjectId = choice.subjectId;

    if (!subjectId && choice.customName) {
      const name = choice.customName;
      // The same subject typed twice (or already in the catalogue) is reused, not duplicated.
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM subjects WHERE lower(name_fr) = lower($1) OR lower(name_ar) = lower($1) LIMIT 1`,
        [name],
      );
      if (existing.rows[0]) {
        subjectId = existing.rows[0].id;
      } else {
        const { rows: count } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM subjects WHERE suggested_by = $1 AND status = 'pending'`,
          [teacherId],
        );
        if (count[0].n >= MAX_CUSTOM_SUBJECTS)
          return { ok: false, error: 'tooManyCustomSubjects' };
        subjectId = await insertPendingSubject(client, teacherId, name);
      }
    }
    if (!subjectId) return { ok: false, error: 'invalidSelection' };
    if (seen.has(subjectId)) continue; // chosen twice: the first one counts
    seen.add(subjectId);
    rows.push({ subjectId, rate: choice.rateMillimes });
  }
  return { ok: true, rows };
}

async function insertPendingSubject(
  client: PoolClient,
  teacherId: string,
  name: string,
): Promise<string> {
  // Latin names give a readable address; other scripts get a short stable code.
  const base =
    slugify(name) ||
    `x-${createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 8)}`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug =
      attempt === 0 ? `custom-${base}` : `custom-${base}-${attempt + 1}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO subjects (slug, name_fr, name_ar, status, suggested_by, sort_order)
       VALUES ($1, $2, $2, 'pending', $3, 1000)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [slug, name, teacherId],
    );
    if (rows[0]) return rows[0].id;
  }
  throw new Error('Could not create a slug for the custom subject');
}

// ---------------------------------------------------------------------- submit and small edits

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: 'incomplete' | 'invalid_state' | 'suspended' };

/** draft or rejected -> pending (waiting for an admin). The database refuses incomplete profiles. */
export async function submitProfile(
  pool: Pool,
  teacherId: string,
  now: Date = new Date(),
): Promise<SubmitResult> {
  try {
    const { rows } = await pool.query<{ status: ProfileStatus }>(
      `UPDATE teacher_profiles SET status = 'pending', submitted_at = $2,
         rejection_reason = NULL, rejection_note = NULL
       WHERE user_id = $1 AND status IN ('draft', 'rejected')
       RETURNING status`,
      [teacherId, now],
    );
    if (rows[0]) return { ok: true };
    const current = await pool.query<{ status: ProfileStatus }>(
      'SELECT status FROM teacher_profiles WHERE user_id = $1',
      [teacherId],
    );
    return {
      ok: false,
      error:
        current.rows[0]?.status === 'suspended' ? 'suspended' : 'invalid_state',
    };
  } catch (error) {
    if ((error as { code?: string }).code === '23514')
      return { ok: false, error: 'incomplete' };
    throw error;
  }
}

/** The teacher pauses or resumes the public listing (spec 2.3). Not possible when suspended. */
export async function setListed(
  pool: Pool,
  teacherId: string,
  listed: boolean,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE teacher_profiles SET is_listed = $2 WHERE user_id = $1 AND status <> 'suspended'`,
    [teacherId, listed],
  );
  return rowCount === 1;
}
