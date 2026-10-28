import type { Pool } from 'pg';
import { checkLimits, recordEvents } from '@/lib/auth/rate-limit';
import type { DeviceContext } from '@/lib/auth/verification';
import { withTransaction, type Queryable } from '@/lib/db/transaction';
import { REPORT_LIMITS } from '@/lib/marketplace/config';
import { parseReply, parseReviewInput, parseReviewReport } from './rules';

// Reviews (spec 3.5). Reviewers write, the public reads published ones, a teacher answers and
// reports the reviews of THEIR profile only (every teacher function takes the teacher's id and
// filters by it, invariant 16). Moderation by admins is in moderation.ts.

const UNIQUE_VIOLATION = '23505';
const DAILY_LIMIT_VIOLATION = 'TP002'; // raised by the trigger of migration 0014

export type ReviewStatus = 'pending' | 'published' | 'rejected' | 'hidden';

// --------------------------------------------------------------------------- writing

export type SubmitResult =
  | { ok: true; reviewId: string }
  | {
      ok: false;
      reason:
        | 'invalid' // missing rating, comment too long
        | 'forbidden' // not an active reviewer account (a teacher or an admin)
        | 'not_found' // the profile is not visible
        | 'already_reviewed'
        | 'daily_limit';
    };

export async function submitReview(
  pool: Pool,
  input: { authorId: string; slug: string; rating: unknown; comment: unknown },
  now: Date = new Date(),
): Promise<SubmitResult> {
  const parsed = parseReviewInput({
    rating: input.rating,
    comment: input.comment,
  });
  if (!parsed) return { ok: false, reason: 'invalid' };

  try {
    return await withTransaction(pool, async (client) => {
      // Only an active reviewer account may write; a teacher number can never become one.
      const author = await client.query(
        `SELECT 1 FROM users WHERE id = $1 AND role = 'visitor' AND status = 'active'`,
        [input.authorId],
      );
      if (author.rows.length === 0)
        return { ok: false, reason: 'forbidden' } as const;

      const teacher = await client.query<{ user_id: string }>(
        `SELECT user_id FROM teacher_profiles
          WHERE slug = $1 AND teacher_is_visible(user_id, $2)`,
        [input.slug, now],
      );
      if (teacher.rows.length === 0)
        return { ok: false, reason: 'not_found' } as const;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO reviews (teacher_id, author_id, rating, comment, created_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          teacher.rows[0].user_id,
          input.authorId,
          parsed.rating,
          parsed.comment,
          now,
        ],
      );
      return { ok: true, reviewId: rows[0].id } as const;
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === UNIQUE_VIOLATION)
      return { ok: false, reason: 'already_reviewed' };
    if (code === DAILY_LIMIT_VIOLATION)
      return { ok: false, reason: 'daily_limit' };
    throw error;
  }
}

/** The review this reviewer already wrote for this profile (to show its status), if any. */
export async function getOwnReview(
  db: Queryable,
  authorId: string,
  teacherId: string,
): Promise<{ status: ReviewStatus; rating: number } | null> {
  const { rows } = await db.query(
    'SELECT status, rating FROM reviews WHERE author_id = $1 AND teacher_id = $2',
    [authorId, teacherId],
  );
  return rows[0] ? { status: rows[0].status, rating: rows[0].rating } : null;
}

// --------------------------------------------------------------------------- reading

export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  reply: string | null;
  repliedAt: Date | null;
};

export const PUBLIC_REVIEWS_SHOWN = 20;

/** Published reviews of a profile, newest first. The author is never exposed. */
export async function listPublishedReviews(
  db: Queryable,
  teacherId: string,
  limit: number = PUBLIC_REVIEWS_SHOWN,
): Promise<PublicReview[]> {
  const { rows } = await db.query(
    `SELECT id, rating, comment, created_at, teacher_reply, replied_at
       FROM reviews
      WHERE teacher_id = $1 AND status = 'published'
      ORDER BY created_at DESC, id LIMIT $2`,
    [teacherId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
    reply: r.teacher_reply,
    repliedAt: r.replied_at,
  }));
}

// --------------------------------------------------------------------- teacher's side

export type TeacherReview = PublicReview & {
  /** This teacher already reported this review and the report is still open. */
  reported: boolean;
};

/** The teacher's own published reviews, to answer or report. */
export async function listReviewsForTeacher(
  db: Queryable,
  teacherId: string,
): Promise<TeacherReview[]> {
  const { rows } = await db.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, r.teacher_reply, r.replied_at,
            EXISTS (SELECT 1 FROM reports x
                     WHERE x.review_id = r.id AND x.reporter_id = $1 AND x.status = 'open') AS reported
       FROM reviews r
      WHERE r.teacher_id = $1 AND r.status = 'published'
      ORDER BY r.created_at DESC, r.id`,
    [teacherId],
  );
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
    reply: r.teacher_reply,
    repliedAt: r.replied_at,
    reported: r.reported,
  }));
}

export type ReplyResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'not_found' | 'already_replied' };

/** One public reply per review, on a published review of this teacher (spec 3.5). */
export async function replyToReview(
  pool: Pool,
  teacherId: string,
  reviewId: string,
  text: unknown,
  now: Date = new Date(),
): Promise<ReplyResult> {
  const reply = parseReply(text);
  if (!reply) return { ok: false, reason: 'invalid' };

  const updated = await pool.query(
    `UPDATE reviews SET teacher_reply = $3, replied_at = $4
      WHERE id = $1 AND teacher_id = $2 AND status = 'published' AND teacher_reply IS NULL`,
    [reviewId, teacherId, reply, now],
  );
  if (updated.rowCount === 1) return { ok: true };

  const existing = await pool.query<{ teacher_reply: string | null }>(
    `SELECT teacher_reply FROM reviews
      WHERE id = $1 AND teacher_id = $2 AND status = 'published'`,
    [reviewId, teacherId],
  );
  return {
    ok: false,
    reason: existing.rows[0] ? 'already_replied' : 'not_found',
  };
}

export type ReportReviewResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid' | 'not_found' | 'already_reported' | 'rate_limited';
    };

/** The teacher reports a review of their profile; an admin decides (spec 3.5). */
export async function reportReview(
  pool: Pool,
  input: {
    teacherId: string;
    reviewId: string;
    reason: unknown;
    note: unknown;
    device: DeviceContext;
  },
  now: Date = new Date(),
): Promise<ReportReviewResult> {
  const parsed = parseReviewReport({ reason: input.reason, note: input.note });
  if (!parsed) return { ok: false, reason: 'invalid' };

  try {
    return await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `report:device:${input.device.deviceHash}`,
      ]);
      const review = await client.query(
        `SELECT 1 FROM reviews WHERE id = $1 AND teacher_id = $2 AND status = 'published'`,
        [input.reviewId, input.teacherId],
      );
      if (review.rows.length === 0)
        return { ok: false, reason: 'not_found' } as const;

      const limits = await checkLimits(
        client,
        REPORT_LIMITS.windowMs,
        [
          {
            bucket: 'report:device',
            key: input.device.deviceHash,
            limit: REPORT_LIMITS.perDevice,
          },
        ],
        now,
      );
      if (!limits.allowed)
        return { ok: false, reason: 'rate_limited' } as const;

      await client.query(
        `INSERT INTO reports (teacher_id, review_id, reason, note, reporter_id, session_hash, created_at)
         VALUES ($1, $2, $3, $4, $1, $5, $6)`,
        [
          input.teacherId,
          input.reviewId,
          parsed.reason,
          parsed.note,
          input.device.deviceHash,
          now,
        ],
      );
      await recordEvents(
        client,
        [{ bucket: 'report:device', key: input.device.deviceHash }],
        now,
      );
      return { ok: true } as const;
    });
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION)
      return { ok: false, reason: 'already_reported' };
    throw error;
  }
}
