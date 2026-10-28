import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { startVisitorLogin } from '@/lib/auth/flows';
import { searchTeachers } from '@/lib/marketplace/search';
import { parseSearchParams } from '@/lib/marketplace/search-params';
import { listModerationQueue, moderateReview } from '@/lib/reviews/moderation';
import {
  getOwnReview,
  listPublishedReviews,
  listReviewsForTeacher,
  replyToReview,
  reportReview,
  submitReview,
} from '@/lib/reviews/repo';
import { clearAuthTables, device } from './auth-helpers';
import { createApprovedTeacher } from './billing-helpers';
import {
  CHECK_VIOLATION,
  createTestPool,
  FOREIGN_KEY_VIOLATION,
  testDatabaseUrl,
} from './helpers';
import {
  createAdminUser,
  loadCatalogueIds,
  type CatalogueIds,
} from './profile-helpers';

const HOUR = 60 * 60 * 1000;

describe.skipIf(!testDatabaseUrl)('reviews (database)', () => {
  let pool: Pool;
  let ids: CatalogueIds;
  let admin: string;
  let reviewerCounter = 0;

  beforeAll(async () => {
    pool = createTestPool();
    await runMigrations(pool);
    ids = await loadCatalogueIds(pool);
  });

  beforeEach(async () => {
    await clearAuthTables(pool);
    admin = await createAdminUser(pool);
  });

  afterAll(async () => {
    await clearAuthTables(pool);
    await pool.end();
  });

  /** A reviewer account: verified by WhatsApp, no password (M2). */
  async function reviewer(): Promise<string> {
    reviewerCounter += 1;
    const { rows } = await pool.query(
      `INSERT INTO users (role, phone_e164, status, phone_verified_at)
       VALUES ('visitor', $1, 'active', now()) RETURNING id`,
      [`+21655${String(reviewerCounter).padStart(6, '0')}`],
    );
    return rows[0].id;
  }

  /** An approved teacher, visible now. Returns the id and the public address. */
  async function teacher() {
    const id = await createApprovedTeacher(pool, ids, admin, new Date());
    const { rows } = await pool.query(
      'SELECT slug FROM teacher_profiles WHERE user_id = $1',
      [id],
    );
    return { id, slug: rows[0].slug as string };
  }

  const review = (
    author: string,
    slug: string,
    overrides: { rating?: unknown; comment?: unknown; now?: Date } = {},
  ) =>
    submitReview(
      pool,
      {
        authorId: author,
        slug,
        rating: overrides.rating ?? 5,
        comment: overrides.comment ?? 'Très bon professeur.',
      },
      overrides.now,
    );

  const rating = async (teacherId: string) =>
    (
      await pool.query(
        'SELECT rating_avg::float8 AS avg, rating_count AS n FROM teacher_profiles WHERE user_id = $1',
        [teacherId],
      )
    ).rows[0] as { avg: number; n: number };

  async function publish(reviewId: string) {
    expect(await moderateReview(pool, admin, reviewId, 'publish')).toEqual({
      ok: true,
    });
  }

  // ------------------------------------------------------------------ writing a review

  describe('writing a review', () => {
    it('waits for moderation: not public, not counted', async () => {
      const t = await teacher();
      const author = await reviewer();
      const result = await review(author, t.slug, { rating: '4' });
      expect(result.ok).toBe(true);

      expect(await listPublishedReviews(pool, t.id)).toEqual([]);
      expect(await rating(t.id)).toEqual({ avg: 0, n: 0 });
      expect(await getOwnReview(pool, author, t.id)).toEqual({
        status: 'pending',
        rating: 4,
      });
    });

    it('accepts a rating without a comment and trims the comment', async () => {
      const t = await teacher();
      const a = await reviewer();
      const b = await reviewer();
      expect((await review(a, t.slug, { comment: '   ' })).ok).toBe(true);
      expect((await review(b, t.slug, { comment: '  Merci  ' })).ok).toBe(true);
      const { rows } = await pool.query(
        'SELECT comment FROM reviews ORDER BY created_at, id',
      );
      expect(rows.map((r) => r.comment)).toHaveLength(2);
      expect(rows.map((r) => r.comment)).toContain(null);
      expect(rows.map((r) => r.comment)).toContain('Merci');
    });

    it('refuses a missing or invalid rating and a comment over 500 characters', async () => {
      const t = await teacher();
      const author = await reviewer();
      for (const bad of [undefined, '', '0', '6', '4.5', 'abc', -1]) {
        expect(await review(author, t.slug, { rating: bad ?? '' })).toEqual({
          ok: false,
          reason: 'invalid',
        });
      }
      expect(
        await review(author, t.slug, { comment: 'x'.repeat(501) }),
      ).toEqual({ ok: false, reason: 'invalid' });
      expect(
        (await review(author, t.slug, { comment: 'x'.repeat(500) })).ok,
      ).toBe(true);
    });

    it('refuses a second review of the same teacher by the same account, even after a refusal (test 15)', async () => {
      const t = await teacher();
      const author = await reviewer();
      const first = await review(author, t.slug);
      expect(first.ok).toBe(true);
      expect(await review(author, t.slug)).toEqual({
        ok: false,
        reason: 'already_reviewed',
      });

      if (first.ok)
        expect(
          await moderateReview(pool, admin, first.reviewId, 'reject'),
        ).toEqual({
          ok: true,
        });
      expect(await review(author, t.slug)).toEqual({
        ok: false,
        reason: 'already_reviewed',
      });

      // Another account can still review the same teacher.
      expect((await review(await reviewer(), t.slug)).ok).toBe(true);
    });

    it('refuses the 4th review by one account in a day, and accepts it a day later (test 15)', async () => {
      const author = await reviewer();
      const base = new Date();
      const teachers = [
        await teacher(),
        await teacher(),
        await teacher(),
        await teacher(),
      ];

      for (let i = 0; i < 3; i++) {
        const result = await review(author, teachers[i].slug, {
          now: new Date(base.getTime() + i * HOUR),
        });
        expect(result.ok).toBe(true);
      }
      expect(
        await review(author, teachers[3].slug, {
          now: new Date(base.getTime() + 5 * HOUR),
        }),
      ).toEqual({ ok: false, reason: 'daily_limit' });

      // 24 hours after the first review, the window has moved on.
      expect(
        (
          await review(author, teachers[3].slug, {
            now: new Date(base.getTime() + 24 * HOUR + 1000),
          })
        ).ok,
      ).toBe(true);
    });

    it('counts refused and rejected reviews in the daily limit', async () => {
      const author = await reviewer();
      const base = new Date();
      const teachers = [
        await teacher(),
        await teacher(),
        await teacher(),
        await teacher(),
      ];
      for (let i = 0; i < 3; i++) {
        const result = await review(author, teachers[i].slug, { now: base });
        if (result.ok)
          await moderateReview(pool, admin, result.reviewId, 'reject');
      }
      expect(await review(author, teachers[3].slug, { now: base })).toEqual({
        ok: false,
        reason: 'daily_limit',
      });
    });

    it('the database itself refuses the 4th review of a day (not only the application)', async () => {
      const author = await reviewer();
      const teachers = [
        await teacher(),
        await teacher(),
        await teacher(),
        await teacher(),
      ];
      const insert = (teacherId: string) =>
        pool.query(
          'INSERT INTO reviews (teacher_id, author_id, rating) VALUES ($1, $2, 5)',
          [teacherId, author],
        );
      await insert(teachers[0].id);
      await insert(teachers[1].id);
      await insert(teachers[2].id);
      await expect(insert(teachers[3].id)).rejects.toMatchObject({
        code: 'TP002',
      });
    });

    it('a teacher cannot review, and a teacher number cannot become a reviewer (own phone, test 15)', async () => {
      const t = await teacher();
      const other = await teacher();

      // As an author through the application: not a reviewer account.
      expect(await review(t.id, other.slug)).toEqual({
        ok: false,
        reason: 'forbidden',
      });
      // The admin neither.
      expect(await review(admin, other.slug)).toEqual({
        ok: false,
        reason: 'forbidden',
      });
      // Through the database: only a reviewer account can be the author.
      await expect(
        pool.query(
          'INSERT INTO reviews (teacher_id, author_id, rating) VALUES ($1, $2, 5)',
          [other.id, t.id],
        ),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });

      // The teacher's own phone number cannot sign in as a reviewer to review themselves.
      const { rows } = await pool.query(
        'SELECT phone_e164 FROM users WHERE id = $1',
        [t.id],
      );
      expect(
        await startVisitorLogin(pool, {
          phone: rows[0].phone_e164,
          device: device('own'),
        }),
      ).toEqual({ ok: false, reason: 'account_exists' });
    });

    it('refuses a suspended reviewer account', async () => {
      const t = await teacher();
      const author = await reviewer();
      await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [
        author,
      ]);
      expect(await review(author, t.slug)).toEqual({
        ok: false,
        reason: 'forbidden',
      });
    });

    it('refuses a profile that is not visible', async () => {
      const t = await teacher();
      const author = await reviewer();
      await pool.query(
        `UPDATE entitlements SET visibility_until = now() - interval '1 minute' WHERE teacher_id = $1`,
        [t.id],
      );
      expect(await review(author, t.slug)).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(await review(author, 'nobody-here')).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });
  });

  // ------------------------------------------------------- moderation and cached rating

  describe('moderation and the cached rating', () => {
    it('counts only published reviews in rating_avg and rating_count', async () => {
      const t = await teacher();
      const ids5 = [5, 4, 3];
      const created: string[] = [];
      for (const value of ids5) {
        const result = await review(await reviewer(), t.slug, {
          rating: value,
        });
        if (result.ok) created.push(result.reviewId);
      }
      expect(await rating(t.id)).toEqual({ avg: 0, n: 0 });

      await publish(created[0]);
      expect(await rating(t.id)).toEqual({ avg: 5, n: 1 });
      await publish(created[1]);
      expect(await rating(t.id)).toEqual({ avg: 4.5, n: 2 });

      // A rejected review never counts.
      expect(await moderateReview(pool, admin, created[2], 'reject')).toEqual({
        ok: true,
      });
      expect(await rating(t.id)).toEqual({ avg: 4.5, n: 2 });

      // Taking one down and bringing it back updates the figures.
      expect(await moderateReview(pool, admin, created[0], 'hide')).toEqual({
        ok: true,
      });
      expect(await rating(t.id)).toEqual({ avg: 4, n: 1 });
      expect(await moderateReview(pool, admin, created[0], 'restore')).toEqual({
        ok: true,
      });
      expect(await rating(t.id)).toEqual({ avg: 4.5, n: 2 });
    });

    it('rounds the average to two decimals', async () => {
      const t = await teacher();
      for (const value of [5, 5, 4]) {
        const result = await review(await reviewer(), t.slug, {
          rating: value,
        });
        if (result.ok) await publish(result.reviewId);
      }
      expect(await rating(t.id)).toEqual({ avg: 4.67, n: 3 });
    });

    it('updates the figures when a reviewer account is deleted', async () => {
      const t = await teacher();
      const author = await reviewer();
      const result = await review(author, t.slug, { rating: 2 });
      if (result.ok) await publish(result.reviewId);
      expect(await rating(t.id)).toEqual({ avg: 2, n: 1 });
      await pool.query('DELETE FROM users WHERE id = $1', [author]);
      expect(await rating(t.id)).toEqual({ avg: 0, n: 0 });
    });

    it('feeds the search: minimum rating and best-rated sort use the real figures', async () => {
      const good = await teacher();
      const none = await teacher();
      const result = await review(await reviewer(), good.slug, { rating: 5 });
      if (result.ok) await publish(result.reviewId);

      const found = async (params: Record<string, string>) =>
        (await searchTeachers(pool, parseSearchParams(params))).cards.map(
          (c) => c.userId,
        );
      expect(await found({ note: '4' })).toEqual([good.id]);
      expect((await found({ tri: 'mieux-notes' }))[0]).toBe(good.id);
      expect(await found({})).toContain(none.id);
    });

    it('shows published reviews to the public, newest first, without the author', async () => {
      const t = await teacher();
      const base = new Date();
      for (let i = 0; i < 3; i++) {
        const result = await review(await reviewer(), t.slug, {
          comment: `avis ${i}`,
          now: new Date(base.getTime() + i * 1000),
        });
        if (result.ok) await publish(result.reviewId);
      }
      const shown = await listPublishedReviews(pool, t.id);
      expect(shown.map((r) => r.comment)).toEqual([
        'avis 2',
        'avis 1',
        'avis 0',
      ]);
      expect(Object.keys(shown[0]).sort()).toEqual(
        ['comment', 'createdAt', 'id', 'rating', 'reply', 'repliedAt'].sort(),
      );
    });

    it('follows the allowed steps only', async () => {
      const t = await teacher();
      const result = await review(await reviewer(), t.slug);
      if (!result.ok) throw new Error('review failed');
      const id = result.reviewId;

      for (const action of ['hide', 'keep', 'restore'] as const) {
        expect(await moderateReview(pool, admin, id, action)).toEqual({
          ok: false,
          reason: 'invalid_state',
        });
      }
      await publish(id);
      for (const action of ['publish', 'reject', 'restore'] as const) {
        expect(await moderateReview(pool, admin, id, action)).toEqual({
          ok: false,
          reason: 'invalid_state',
        });
      }
      expect(
        await moderateReview(
          pool,
          admin,
          '00000000-0000-4000-8000-000000000000',
          'publish',
        ),
      ).toEqual({ ok: false, reason: 'not_found' });
    });

    it('only an active admin can moderate, and every decision is logged', async () => {
      const t = await teacher();
      const result = await review(await reviewer(), t.slug);
      if (!result.ok) throw new Error('review failed');

      for (const actor of [t.id, await reviewer()]) {
        expect(
          await moderateReview(pool, actor, result.reviewId, 'publish'),
        ).toEqual({
          ok: false,
          reason: 'forbidden',
        });
      }
      await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [
        admin,
      ]);
      expect(
        await moderateReview(pool, admin, result.reviewId, 'publish'),
      ).toEqual({
        ok: false,
        reason: 'forbidden',
      });
      await pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [
        admin,
      ]);

      await publish(result.reviewId);
      await moderateReview(pool, admin, result.reviewId, 'hide');
      const { rows } = await pool.query(
        `SELECT action, actor_id FROM audit_log WHERE target_type = 'review' ORDER BY id`,
      );
      expect(rows).toEqual([
        { action: 'review.publish', actor_id: admin },
        { action: 'review.hide', actor_id: admin },
      ]);
    });

    it('lists what is waiting: new reviews, reported reviews, hidden reviews', async () => {
      const t = await teacher();
      const a = await review(await reviewer(), t.slug, { comment: 'nouveau' });
      const b = await review(await reviewer(), t.slug, { comment: 'signalé' });
      const c = await review(await reviewer(), t.slug, { comment: 'masqué' });
      if (!a.ok || !b.ok || !c.ok) throw new Error('review failed');
      await publish(b.reviewId);
      await publish(c.reviewId);
      await moderateReview(pool, admin, c.reviewId, 'hide');
      expect(
        (
          await reportReview(pool, {
            teacherId: t.id,
            reviewId: b.reviewId,
            reason: 'fake_review',
            note: '',
            device: device('t'),
          })
        ).ok,
      ).toBe(true);

      const queue = await listModerationQueue(pool);
      expect(queue.pending.map((i) => i.comment)).toEqual(['nouveau']);
      expect(queue.reported.map((i) => i.comment)).toEqual(['signalé']);
      expect(queue.reported[0].openReports).toEqual([
        { reason: 'fake_review', note: null },
      ]);
      expect(queue.hidden.map((i) => i.comment)).toEqual(['masqué']);
      expect(queue.pending[0].authorPhone).toMatch(/^\+216/);
    });
  });

  // ------------------------------------------------------------------- teacher's side

  describe('teacher reply and report', () => {
    async function published(t: { slug: string }, comment = 'Bien') {
      const result = await review(await reviewer(), t.slug, { comment });
      if (!result.ok) throw new Error('review failed');
      await publish(result.reviewId);
      return result.reviewId;
    }

    it('lets the teacher post one public reply', async () => {
      const t = await teacher();
      const id = await published(t);
      expect(
        await replyToReview(pool, t.id, id, '  Merci beaucoup !  '),
      ).toEqual({
        ok: true,
      });
      const [shown] = await listPublishedReviews(pool, t.id);
      expect(shown.reply).toBe('Merci beaucoup !');
      expect(shown.repliedAt).toBeInstanceOf(Date);
      expect(await replyToReview(pool, t.id, id, 'Encore un mot')).toEqual({
        ok: false,
        reason: 'already_replied',
      });
      expect((await listPublishedReviews(pool, t.id))[0].reply).toBe(
        'Merci beaucoup !',
      );
    });

    it('refuses an empty or too long reply', async () => {
      const t = await teacher();
      const id = await published(t);
      for (const bad of ['', '   ', 'x'.repeat(501), 12, null]) {
        expect(await replyToReview(pool, t.id, id, bad)).toEqual({
          ok: false,
          reason: 'invalid',
        });
      }
    });

    it('only the teacher of the review can reply, and only once it is published', async () => {
      const t = await teacher();
      const other = await teacher();
      const id = await published(t);
      expect(await replyToReview(pool, other.id, id, 'Pas à moi')).toEqual({
        ok: false,
        reason: 'not_found',
      });

      const waiting = await review(await reviewer(), t.slug);
      if (!waiting.ok) throw new Error('review failed');
      expect(
        await replyToReview(pool, t.id, waiting.reviewId, 'Trop tôt'),
      ).toEqual({
        ok: false,
        reason: 'not_found',
      });
      // The database agrees: a pending review cannot carry a reply.
      await expect(
        pool.query(
          `UPDATE reviews SET teacher_reply = 'x', replied_at = now() WHERE id = $1`,
          [waiting.reviewId],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('a teacher sees only the published reviews of their own profile', async () => {
      const t = await teacher();
      const other = await teacher();
      await published(t, 'pour moi');
      await published(other, 'pour un autre');
      await review(await reviewer(), t.slug, { comment: 'en attente' });

      const mine = await listReviewsForTeacher(pool, t.id);
      expect(mine.map((r) => r.comment)).toEqual(['pour moi']);
      expect(mine[0].reported).toBe(false);
    });

    it('lets the teacher report a review; one open report each; an admin decides', async () => {
      const t = await teacher();
      const id = await published(t, 'injuste');
      const report = (reason: unknown, note: unknown = '') =>
        reportReview(pool, {
          teacherId: t.id,
          reviewId: id,
          reason,
          note,
          device: device('t'),
        });

      expect(await report('spam')).toEqual({ ok: false, reason: 'invalid' });
      expect(await report('wrong_info')).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(await report('other', '  ')).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(await report('inappropriate', 'Insultes')).toEqual({ ok: true });
      expect(await report('fake_review')).toEqual({
        ok: false,
        reason: 'already_reported',
      });
      expect((await listReviewsForTeacher(pool, t.id))[0].reported).toBe(true);

      // "hide" upholds the report and the review disappears; the rating follows.
      expect(await moderateReview(pool, admin, id, 'hide')).toEqual({
        ok: true,
      });
      const { rows } = await pool.query(
        'SELECT status, handled_by FROM reports WHERE review_id = $1',
        [id],
      );
      expect(rows).toEqual([{ status: 'upheld', handled_by: admin }]);
      expect(await listPublishedReviews(pool, t.id)).toEqual([]);
    });

    it('"keep" dismisses the reports and the review stays', async () => {
      const t = await teacher();
      const id = await published(t);
      await reportReview(pool, {
        teacherId: t.id,
        reviewId: id,
        reason: 'inappropriate',
        note: '',
        device: device('t'),
      });
      expect(await moderateReview(pool, admin, id, 'keep')).toEqual({
        ok: true,
      });
      const { rows } = await pool.query(
        'SELECT status FROM reports WHERE review_id = $1',
        [id],
      );
      expect(rows).toEqual([{ status: 'dismissed' }]);
      expect(await listPublishedReviews(pool, t.id)).toHaveLength(1);
      expect((await listModerationQueue(pool)).reported).toEqual([]);
      // The teacher may report again later: the first report is closed.
      expect(
        (
          await reportReview(pool, {
            teacherId: t.id,
            reviewId: id,
            reason: 'other',
            note: 'Nouvel élément',
            device: device('t2'),
          })
        ).ok,
      ).toBe(true);
    });

    it('a teacher cannot report the review of another teacher or an unpublished one', async () => {
      const t = await teacher();
      const other = await teacher();
      const id = await published(other);
      const waiting = await review(await reviewer(), t.slug);
      if (!waiting.ok) throw new Error('review failed');
      for (const reviewId of [id, waiting.reviewId]) {
        expect(
          await reportReview(pool, {
            teacherId: t.id,
            reviewId,
            reason: 'inappropriate',
            note: '',
            device: device('t'),
          }),
        ).toEqual({ ok: false, reason: 'not_found' });
      }
    });

    it('limits reports per device like profile reports', async () => {
      const t = await teacher();
      const results: string[] = [];
      for (let i = 0; i < 6; i++) {
        const id = await published(t, `avis ${i}`);
        const result = await reportReview(pool, {
          teacherId: t.id,
          reviewId: id,
          reason: 'inappropriate',
          note: '',
          device: device('t'),
        });
        results.push(result.ok ? 'ok' : result.reason);
      }
      expect(results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'rate_limited']);
    });
  });

  it('profile reports and review reports do not mix', async () => {
    const t = await teacher();
    // A review report cannot use a profile-only reason, and a profile report cannot use "fake_review".
    await expect(
      pool.query(
        `INSERT INTO reports (teacher_id, reason, session_hash) VALUES ($1, 'fake_review', 'x')`,
        [t.id],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    const author = await reviewer();
    const result = await review(author, t.slug);
    if (!result.ok) throw new Error('review failed');
    await expect(
      pool.query(
        `INSERT INTO reports (teacher_id, review_id, reason, reporter_id, session_hash)
         VALUES ($1, $2, 'wrong_info', $1, 'x')`,
        [t.id, result.reviewId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    // A report about a review needs a reporter account.
    await expect(
      pool.query(
        `INSERT INTO reports (teacher_id, review_id, reason, session_hash)
         VALUES ($1, $2, 'inappropriate', 'x')`,
        [t.id, result.reviewId],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });
});
