import type { Pool, PoolClient } from 'pg';
import { withTransaction, type Queryable } from '@/lib/db/transaction';
import { isActiveAdmin } from '@/lib/auth/admin';
import { slugify } from '@/lib/slug';
import { startCredit } from '@/lib/billing/entitlements';
import { tryGrantFounding } from '@/lib/billing/founding';
import { loadProfile, type TeacherProfile } from './repo';
import { isRejectionReason } from './rules';

// Admin side of profiles (spec 6): review queue, approve, refuse, suspend. Every function
// checks in the database that the actor is an active admin, and leaves an audit_log row.

export type ReviewFailure =
  | 'forbidden' // the actor is not an active admin
  | 'not_found'
  | 'invalid_state' // that action is not possible in the profile's current status
  | 'incomplete' // the profile lacks required fields
  | 'invalid_reason'; // missing or unknown reason

type Failure = { ok: false; reason: ReviewFailure };

// ------------------------------------------------------------------------------ the queue

export type QueueItem = {
  userId: string;
  fullName: string | null;
  phone: string;
  governorateName: string | null;
  /** When the teacher submitted the profile, or the pending change. */
  submittedAt: Date | null;
  kind: 'profile' | 'version';
};

export async function listReviewQueue(db: Queryable): Promise<QueueItem[]> {
  const { rows } = await db.query(
    `SELECT p.user_id, p.full_name, u.phone_e164, g.name_fr AS governorate_name, p.status,
            CASE WHEN p.status = 'pending' THEN p.submitted_at
                 ELSE (p.pending_version ->> 'submitted_at')::timestamptz END AS waiting_since
     FROM teacher_profiles p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN governorates g ON g.id = p.governorate_id
     WHERE p.status = 'pending' OR (p.status = 'approved' AND p.pending_version IS NOT NULL)
     ORDER BY waiting_since ASC NULLS LAST, p.user_id`,
  );
  return rows.map((r) => ({
    userId: r.user_id,
    fullName: r.full_name,
    phone: r.phone_e164,
    governorateName: r.governorate_name,
    submittedAt: r.waiting_since,
    kind: r.status === 'pending' ? 'profile' : 'version',
  }));
}

export type ReviewDetail = {
  profile: TeacherProfile;
  phone: string;
  governorateName: string | null;
  zoneNames: string[];
  levelNames: string[];
};

export async function loadForReview(
  db: Queryable,
  userId: string,
): Promise<ReviewDetail | null> {
  const profile = await loadProfile(db, userId);
  if (!profile) return null;
  const [user, gov, zones, levels] = await Promise.all([
    db.query<{ phone_e164: string }>(
      'SELECT phone_e164 FROM users WHERE id = $1',
      [userId],
    ),
    db.query<{ name_fr: string }>(
      'SELECT name_fr FROM governorates WHERE id = $1',
      [profile.governorateId],
    ),
    db.query<{ name_fr: string }>(
      `SELECT d.name_fr FROM teacher_zones z JOIN delegations d ON d.id = z.delegation_id
       WHERE z.teacher_id = $1 ORDER BY d.name_fr`,
      [userId],
    ),
    db.query<{ name_fr: string }>(
      `SELECT l.name_fr FROM teacher_levels tl JOIN levels l ON l.id = tl.level_id
       WHERE tl.teacher_id = $1 ORDER BY l.sort_order`,
      [userId],
    ),
  ]);
  return {
    profile,
    phone: user.rows[0].phone_e164,
    governorateName: gov.rows[0]?.name_fr ?? null,
    zoneNames: zones.rows.map((r) => r.name_fr),
    levelNames: levels.rows.map((r) => r.name_fr),
  };
}

// ------------------------------------------------------------------------------ helpers

type Locked = {
  status: string;
  slug: string | null;
  full_name: string | null;
  photo_key: string | null;
  bio: string | null;
  diploma: string | null;
  pending_version: {
    full_name?: string;
    photo_key?: string | null;
    bio?: string;
    diploma?: string;
  } | null;
};

/** Runs `work` in a transaction with the admin checked and the profile row locked. */
async function asAdmin<T>(
  pool: Pool,
  actorId: string,
  userId: string,
  work: (client: PoolClient, profile: Locked) => Promise<T | Failure>,
): Promise<T | Failure> {
  return withTransaction(pool, async (client) => {
    if (!(await isActiveAdmin(client, actorId)))
      return { ok: false, reason: 'forbidden' } as Failure;
    const { rows } = await client.query<Locked>(
      `SELECT status, slug, full_name, photo_key, bio, diploma, pending_version
       FROM teacher_profiles WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (!rows[0]) return { ok: false, reason: 'not_found' } as Failure;
    return work(client, rows[0]);
  });
}

async function audit(
  client: PoolClient,
  actorId: string,
  action: string,
  userId: string,
  details: Record<string, unknown>,
  now: Date,
) {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at)
     VALUES ($1, $2, 'teacher_profile', $3, $4::jsonb, $5)`,
    [actorId, action, userId, JSON.stringify(details), now],
  );
}

function checkReason(
  reason: string,
  note: string | null,
): note is string | null {
  // A template reason is enough, except "other" which needs an explanation.
  return (
    isRejectionReason(reason) &&
    (reason !== 'other' || Boolean(note && note.trim()))
  );
}

/** /prof/{slug}: name + first subject + governorate, made unique with -2, -3... */
async function makeSlug(
  client: PoolClient,
  userId: string,
  fullName: string,
): Promise<string> {
  const { rows } = await client.query<{
    subject: string | null;
    governorate: string | null;
  }>(
    `SELECT
       (SELECT s.name_fr FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
        WHERE ts.teacher_id = $1 ORDER BY (s.status = 'approved') DESC, s.sort_order, s.name_fr LIMIT 1) AS subject,
       (SELECT g.name_fr FROM teacher_profiles p JOIN governorates g ON g.id = p.governorate_id
        WHERE p.user_id = $1) AS governorate`,
    [userId],
  );
  const base =
    slugify(
      [fullName, rows[0]?.subject, rows[0]?.governorate]
        .filter(Boolean)
        .join(' '),
    ) || 'prof';
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await client.query(
      'SELECT 1 FROM teacher_profiles WHERE slug = $1',
      [candidate],
    );
    if (taken.rows.length === 0) return candidate;
  }
  throw new Error('Could not find a free slug');
}

// ------------------------------------------------------------------------------ decisions

/** pending -> approved. The address /prof/{slug} is created now and never changes. */
export async function approveProfile(
  pool: Pool,
  actorId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true; slug: string } | Failure> {
  try {
    return await asAdmin(pool, actorId, userId, async (client, profile) => {
      if (profile.status !== 'pending')
        return { ok: false, reason: 'invalid_state' } as Failure;
      const slug =
        profile.slug ??
        (await makeSlug(client, userId, profile.full_name ?? 'prof'));
      // The database refuses (check_violation) if a required field is missing.
      await client.query(
        `UPDATE teacher_profiles SET status = 'approved', slug = $2, approved_at = $3, reviewed_by = $4,
           rejection_reason = NULL, rejection_note = NULL
         WHERE user_id = $1`,
        [userId, slug, now, actorId],
      );
      // In the same transaction (invariants 3 and 6): days bought before approval start now,
      // and the founding offer is applied automatically if a slot is left.
      const credit = await startCredit(client, userId, now);
      const founding = await tryGrantFounding(client, userId, now);
      await audit(
        client,
        actorId,
        'profile.approve',
        userId,
        {
          from: 'pending',
          to: 'approved',
          slug,
          creditStarted: credit,
          foundingGranted: founding.granted,
        },
        now,
      );
      return { ok: true, slug } as const;
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23514')
      return { ok: false, reason: 'incomplete' };
    throw error;
  }
}

/** pending -> rejected, with a reason from the templates (and a note). */
export async function rejectProfile(
  pool: Pool,
  actorId: string,
  userId: string,
  input: { reason: string; note: string | null },
  now: Date = new Date(),
): Promise<{ ok: true } | Failure> {
  if (!checkReason(input.reason, input.note))
    return { ok: false, reason: 'invalid_reason' };
  return asAdmin(pool, actorId, userId, async (client, profile) => {
    if (profile.status !== 'pending')
      return { ok: false, reason: 'invalid_state' } as Failure;
    await client.query(
      `UPDATE teacher_profiles SET status = 'rejected', rejection_reason = $2, rejection_note = $3, reviewed_by = $4
       WHERE user_id = $1`,
      [userId, input.reason, input.note?.trim() || null, actorId],
    );
    await audit(
      client,
      actorId,
      'profile.reject',
      userId,
      { reason: input.reason, note: input.note },
      now,
    );
    return { ok: true } as const;
  });
}

/** The pending version of an approved profile goes live; the old photo is released. */
export async function approveVersion(
  pool: Pool,
  actorId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true; unusedPhotoKeys: string[] } | Failure> {
  return asAdmin(pool, actorId, userId, async (client, profile) => {
    const version = profile.pending_version;
    if (profile.status !== 'approved' || !version)
      return { ok: false, reason: 'invalid_state' } as Failure;

    const newPhoto = version.photo_key ?? null;
    await client.query(
      `UPDATE teacher_profiles SET full_name = $2, photo_key = $3, bio = $4, diploma = $5,
         pending_version = NULL, version_rejection_reason = NULL, version_rejection_note = NULL,
         reviewed_by = $6
       WHERE user_id = $1`,
      [
        userId,
        version.full_name ?? profile.full_name,
        newPhoto,
        version.bio ?? profile.bio,
        version.diploma ?? profile.diploma,
        actorId,
      ],
    );
    await audit(client, actorId, 'profile.approve_version', userId, {}, now);
    const unused =
      profile.photo_key && profile.photo_key !== newPhoto
        ? [profile.photo_key]
        : [];
    return { ok: true, unusedPhotoKeys: unused } as const;
  });
}

/** The pending version is refused; the approved version stays live as it was. */
export async function rejectVersion(
  pool: Pool,
  actorId: string,
  userId: string,
  input: { reason: string; note: string | null },
  now: Date = new Date(),
): Promise<{ ok: true; unusedPhotoKeys: string[] } | Failure> {
  if (!checkReason(input.reason, input.note))
    return { ok: false, reason: 'invalid_reason' };
  return asAdmin(pool, actorId, userId, async (client, profile) => {
    const version = profile.pending_version;
    if (profile.status !== 'approved' || !version)
      return { ok: false, reason: 'invalid_state' } as Failure;

    await client.query(
      `UPDATE teacher_profiles SET pending_version = NULL,
         version_rejection_reason = $2, version_rejection_note = $3, reviewed_by = $4
       WHERE user_id = $1`,
      [userId, input.reason, input.note?.trim() || null, actorId],
    );
    await audit(
      client,
      actorId,
      'profile.reject_version',
      userId,
      { reason: input.reason, note: input.note },
      now,
    );
    const photo = version.photo_key ?? null;
    return {
      ok: true,
      unusedPhotoKeys: photo && photo !== profile.photo_key ? [photo] : [],
    } as const;
  });
}

/** approved -> suspended. Needs a written reason. */
export async function suspendProfile(
  pool: Pool,
  actorId: string,
  userId: string,
  reason: string,
  now: Date = new Date(),
): Promise<{ ok: true } | Failure> {
  const text = reason.trim();
  if (!text || text.length > 500)
    return { ok: false, reason: 'invalid_reason' };
  return asAdmin(pool, actorId, userId, async (client, profile) => {
    if (profile.status !== 'approved')
      return { ok: false, reason: 'invalid_state' } as Failure;
    await client.query(
      `UPDATE teacher_profiles SET status = 'suspended', suspension_reason = $2, reviewed_by = $3
       WHERE user_id = $1`,
      [userId, text, actorId],
    );
    await audit(
      client,
      actorId,
      'profile.suspend',
      userId,
      { reason: text },
      now,
    );
    return { ok: true } as const;
  });
}

/** suspended -> approved again. */
export async function restoreProfile(
  pool: Pool,
  actorId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | Failure> {
  try {
    return await asAdmin(pool, actorId, userId, async (client, profile) => {
      if (profile.status !== 'suspended')
        return { ok: false, reason: 'invalid_state' } as Failure;
      await client.query(
        `UPDATE teacher_profiles SET status = 'approved', suspension_reason = NULL, reviewed_by = $2
         WHERE user_id = $1`,
        [userId, actorId],
      );
      await audit(client, actorId, 'profile.restore', userId, {}, now);
      return { ok: true } as const;
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23514')
      return { ok: false, reason: 'incomplete' };
    throw error;
  }
}
