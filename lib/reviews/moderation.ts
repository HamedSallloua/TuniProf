import type { Pool } from 'pg';
import { isActiveAdmin } from '@/lib/auth/admin';
import { withTransaction, type Queryable } from '@/lib/db/transaction';
import { enqueueNotification } from '@/lib/notifications/queue';
import type { ReviewStatus } from './repo';

// Admin side of reviews (spec 3.5, 6): publish or reject what is new, take down a published
// review (after a report, for example), bring it back, or keep it when a report is unfounded.
// Every function checks in the database that the actor is an active admin and leaves an
// audit_log row. Banning abusive accounts and the full reports screen come at M11.

export type ModerationItem = {
  id: string;
  status: ReviewStatus;
  rating: number;
  comment: string | null;
  createdAt: Date;
  teacherName: string | null;
  teacherSlug: string | null;
  /** The reviewer's number: an admin needs it to recognise a repeat abuser. */
  authorPhone: string;
  reply: string | null;
  openReports: { reason: string; note: string | null }[];
};

type Row = {
  id: string;
  status: ReviewStatus;
  rating: number;
  comment: string | null;
  created_at: Date;
  full_name: string | null;
  slug: string | null;
  phone_e164: string;
  teacher_reply: string | null;
  reports: { reason: string; note: string | null }[] | null;
};

function toItem(row: Row): ModerationItem {
  return {
    id: row.id,
    status: row.status,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    teacherName: row.full_name,
    teacherSlug: row.slug,
    authorPhone: row.phone_e164,
    reply: row.teacher_reply,
    openReports: row.reports ?? [],
  };
}

const SELECT = `
  SELECT r.id, r.status, r.rating, r.comment, r.created_at, r.teacher_reply,
         p.full_name, p.slug, u.phone_e164,
         (SELECT json_agg(json_build_object('reason', x.reason, 'note', x.note) ORDER BY x.created_at)
            FROM reports x WHERE x.review_id = r.id AND x.status = 'open') AS reports
    FROM reviews r
    JOIN teacher_profiles p ON p.user_id = r.teacher_id
    JOIN users u ON u.id = r.author_id`;

export type ModerationQueue = {
  /** New reviews, oldest first. */
  pending: ModerationItem[];
  /** Published reviews with an open report, oldest report first. */
  reported: ModerationItem[];
  /** Taken down, newest first, so a mistake can be undone. */
  hidden: ModerationItem[];
};

export async function listModerationQueue(
  db: Queryable,
): Promise<ModerationQueue> {
  const [pending, reported, hidden] = await Promise.all([
    db.query<Row>(
      `${SELECT} WHERE r.status = 'pending' ORDER BY r.created_at, r.id`,
    ),
    db.query<Row>(
      `${SELECT} WHERE r.status = 'published'
         AND EXISTS (SELECT 1 FROM reports x WHERE x.review_id = r.id AND x.status = 'open')
       ORDER BY (SELECT min(x.created_at) FROM reports x WHERE x.review_id = r.id AND x.status = 'open'), r.id`,
    ),
    db.query<Row>(
      `${SELECT} WHERE r.status = 'hidden' ORDER BY r.moderated_at DESC NULLS LAST, r.id LIMIT 50`,
    ),
  ]);
  return {
    pending: pending.rows.map(toItem),
    reported: reported.rows.map(toItem),
    hidden: hidden.rows.map(toItem),
  };
}

export const MODERATION_ACTIONS = [
  'publish', // pending -> published
  'reject', // pending -> rejected
  'hide', // published -> hidden (open reports are upheld)
  'keep', // published: open reports are dismissed, the review stays
  'restore', // hidden -> published
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export type ModerationResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'invalid_state' };

const TRANSITIONS: Record<
  ModerationAction,
  { from: ReviewStatus; to: ReviewStatus | null }
> = {
  publish: { from: 'pending', to: 'published' },
  reject: { from: 'pending', to: 'rejected' },
  hide: { from: 'published', to: 'hidden' },
  keep: { from: 'published', to: null },
  restore: { from: 'hidden', to: 'published' },
};

export async function moderateReview(
  pool: Pool,
  actorId: string,
  reviewId: string,
  action: ModerationAction,
  now: Date = new Date(),
): Promise<ModerationResult> {
  const step = TRANSITIONS[action];
  if (!step) return { ok: false, reason: 'invalid_state' };

  return withTransaction(pool, async (client) => {
    if (!(await isActiveAdmin(client, actorId)))
      return { ok: false, reason: 'forbidden' } as const;

    const { rows } = await client.query<{
      status: ReviewStatus;
      teacher_id: string;
      rating: number;
    }>(
      'SELECT status, teacher_id, rating FROM reviews WHERE id = $1 FOR UPDATE',
      [reviewId],
    );
    if (!rows[0]) return { ok: false, reason: 'not_found' } as const;
    if (rows[0].status !== step.from)
      return { ok: false, reason: 'invalid_state' } as const;

    if (step.to) {
      await client.query(
        `UPDATE reviews SET status = $2, moderated_by = $3, moderated_at = $4 WHERE id = $1`,
        [reviewId, step.to, actorId, now],
      );
    }
    // A decision on a published review closes its open reports: "hide" upholds them,
    // "keep" dismisses them.
    if (action === 'hide' || action === 'keep') {
      // The teacher who reported is told what was decided.
      const reports = await client.query<{ id: string; reporter_id: string }>(
        `SELECT id, reporter_id FROM reports
          WHERE review_id = $1 AND status = 'open' AND reporter_id IS NOT NULL`,
        [reviewId],
      );
      for (const report of reports.rows) {
        await enqueueNotification(client, {
          userId: report.reporter_id,
          kind: 'review_report_outcome',
          dedupeKey: `report:${report.id}`,
          params: { outcome: action === 'hide' ? 'upheld' : 'dismissed' },
        });
      }
      await client.query(
        `UPDATE reports SET status = $2, handled_by = $3, handled_at = $4
          WHERE review_id = $1 AND status = 'open'`,
        [reviewId, action === 'hide' ? 'upheld' : 'dismissed', actorId, now],
      );
    }
    // A review that goes live (or comes back) is announced to the teacher, once.
    if (step.to === 'published') {
      await enqueueNotification(client, {
        userId: rows[0].teacher_id,
        kind: 'review_published',
        dedupeKey: `review:${reviewId}`,
        params: { rating: rows[0].rating },
      });
    }
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at)
       VALUES ($1, $2, 'review', $3, $4::jsonb, $5)`,
      [
        actorId,
        `review.${action}`,
        reviewId,
        JSON.stringify({
          teacherId: rows[0].teacher_id,
          from: rows[0].status,
          to: step.to ?? rows[0].status,
        }),
        now,
      ],
    );
    return { ok: true } as const;
  });
}
