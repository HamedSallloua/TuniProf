import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { runDailyJob } from '@/lib/billing/jobs';
import {
  createPaymentRequest,
  markProofReceived,
  rejectPaymentRequest,
} from '@/lib/billing/payments';
import {
  deliverPendingEmails,
  listPendingWhatsApp,
  listSiteNotices,
  markSiteNoticeRead,
  markWhatsAppSent,
  MAX_EMAIL_ATTEMPTS,
} from '@/lib/notifications/deliver';
import type { EmailProvider, OutgoingEmail } from '@/lib/notifications/email';
import { enqueueNotification } from '@/lib/notifications/queue';
import {
  cleanOldRows,
  queueExpiredNotices,
  queueExpiryReminders,
  queueGraceWarnings,
} from '@/lib/notifications/schedule';
import {
  approveVersion,
  rejectProfile,
  rejectVersion,
} from '@/lib/profile/review';
import { saveProfile } from '@/lib/profile/repo';
import { moderateReview } from '@/lib/reviews/moderation';
import { reportReview, submitReview } from '@/lib/reviews/repo';
import { clearAuthTables, device } from './auth-helpers';
import {
  createApprovedTeacher,
  createPendingTeacher,
  planBySlug,
  purchaseCode,
} from './billing-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';
import {
  completeInput,
  createAdminUser,
  loadCatalogueIds,
  type CatalogueIds,
} from './profile-helpers';

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!testDatabaseUrl)(
  'notifications and daily job (database)',
  () => {
    let pool: Pool;
    let ids: CatalogueIds;
    let admin: string;
    let now: Date;

    beforeAll(async () => {
      pool = createTestPool();
      await runMigrations(pool);
      ids = await loadCatalogueIds(pool);
    });

    beforeEach(async () => {
      await clearAuthTables(pool);
      admin = await createAdminUser(pool);
      now = new Date();
    });

    afterAll(async () => {
      await clearAuthTables(pool);
      await pool.end();
    });

    const inDays = (days: number) => new Date(now.getTime() + days * DAY);

    /** An approved teacher whose plan ends `days` from now (negative: ended). */
    async function teacherEndingIn(
      days: number,
      options: { email?: string } = {},
    ) {
      const id = await createApprovedTeacher(pool, ids, admin, now);
      await pool.query(
        'UPDATE entitlements SET visibility_until = $2, dashboard_until = $2 WHERE teacher_id = $1',
        [id, inDays(days)],
      );
      if (options.email)
        await pool.query('UPDATE users SET email = $2 WHERE id = $1', [
          id,
          options.email,
        ]);
      // Approval queued its own messages: this test looks at the schedule only.
      await pool.query('DELETE FROM notifications WHERE user_id = $1', [id]);
      return id;
    }

    const rows = async (userId?: string, kind?: string) =>
      (
        await pool.query(
          `SELECT kind, channel, status, params, dedupe_key FROM notifications
          WHERE ($1::uuid IS NULL OR user_id = $1) AND ($2::text IS NULL OR kind = $2)
          ORDER BY created_at, channel`,
          [userId ?? null, kind ?? null],
        )
      ).rows;

    const channels = async (userId: string, kind: string) =>
      (await rows(userId, kind)).map((r) => r.channel).sort();

    // ------------------------------------------------------------------------- the queue

    describe('the queue', () => {
      it('queues one row per channel, and e-mail only when the person gave an address', async () => {
        const without = await teacherEndingIn(100);
        const withEmail = await teacherEndingIn(100, {
          email: 'prof@example.com',
        });
        for (const id of [without, withEmail]) {
          await enqueueNotification(pool, {
            userId: id,
            kind: 'plan_expired',
            dedupeKey: 'x',
            params: { date: now.toISOString() },
          });
        }
        expect(await channels(without, 'plan_expired')).toEqual([
          'site',
          'whatsapp',
        ]);
        expect(await channels(withEmail, 'plan_expired')).toEqual([
          'email',
          'site',
          'whatsapp',
        ]);
      });

      it('queues the same event once: the same key adds nothing', async () => {
        const id = await teacherEndingIn(100);
        const send = () =>
          enqueueNotification(pool, {
            userId: id,
            kind: 'plan_expired',
            dedupeKey: 'same',
          });
        expect(await send()).toBe(2);
        expect(await send()).toBe(0);
        expect(await rows(id)).toHaveLength(2);
        // A different key is a different event.
        expect(
          await enqueueNotification(pool, {
            userId: id,
            kind: 'plan_expired',
            dedupeKey: 'other',
          }),
        ).toBe(2);
      });

      it('keeps the name of the teacher with the message', async () => {
        const id = await teacherEndingIn(100);
        await enqueueNotification(pool, {
          userId: id,
          kind: 'plan_expired',
          dedupeKey: 'n',
        });
        expect((await rows(id))[0].params.name).toBe('Wassima Chaaben');
      });

      it('ignores an unknown person', async () => {
        expect(
          await enqueueNotification(pool, {
            userId: '00000000-0000-4000-8000-000000000000',
            kind: 'plan_expired',
            dedupeKey: 'x',
          }),
        ).toBe(0);
      });

      it('refuses a status that does not fit the channel (database check)', async () => {
        const id = await teacherEndingIn(100);
        await expect(
          pool.query(
            `INSERT INTO notifications (user_id, kind, channel, dedupe_key, status, read_at)
           VALUES ($1, 'plan_expired', 'whatsapp', 'bad', 'read', now())`,
            [id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      });
    });

    // ------------------------------------------------------------- what the events queue

    describe('messages queued by the events', () => {
      it('approval of a profile', async () => {
        const id = await createApprovedTeacher(pool, ids, admin, now);
        expect(await channels(id, 'profile_approved')).toEqual([
          'site',
          'whatsapp',
        ]);
      });

      it('refusal of a profile keeps the reason and the note', async () => {
        const id = await createPendingTeacher(pool, ids, { submittedAt: now });
        await rejectProfile(
          pool,
          admin,
          id,
          { reason: 'bio_unclear', note: ' Précisez ' },
          now,
        );
        const [site] = await rows(id, 'profile_rejected');
        expect(site.params).toMatchObject({
          reason: 'bio_unclear',
          note: 'Précisez',
        });
      });

      it('approval and refusal of a change of profile', async () => {
        const id = await createApprovedTeacher(pool, ids, admin, now);
        await pool.query('DELETE FROM notifications');
        // Two edits of the sensitive fields, one approved and one refused.
        await saveProfile(
          pool,
          id,
          completeInput(ids, { fullName: 'Nouveau Nom' }),
          { strict: true },
          now,
        );
        expect((await approveVersion(pool, admin, id, now)).ok).toBe(true);
        await saveProfile(
          pool,
          id,
          completeInput(ids, { fullName: 'Autre Nom' }),
          { strict: true },
          now,
        );
        expect(
          (
            await rejectVersion(
              pool,
              admin,
              id,
              { reason: 'name_invalid', note: null },
              new Date(now.getTime() + 1000),
            )
          ).ok,
        ).toBe(true);
        expect(await channels(id, 'version_approved')).toEqual([
          'site',
          'whatsapp',
        ]);
        expect(await channels(id, 'version_rejected')).toEqual([
          'site',
          'whatsapp',
        ]);
      });

      it('proof received, code issued (never with the code), payment refused (never with the note)', async () => {
        const teacher = await createApprovedTeacher(pool, ids, admin, now);
        await pool.query('DELETE FROM notifications');
        const planId = await planBySlug(pool, 'mensuel');
        const created = await createPaymentRequest(
          pool,
          teacher,
          { planId, withDashboard: false, method: 'flouci' },
          now,
        );
        if (!created.ok) throw new Error('request failed');

        expect(
          (await markProofReceived(pool, admin, created.request.id, now)).ok,
        ).toBe(true);
        expect(await channels(teacher, 'payment_proof_received')).toEqual([
          'site',
          'whatsapp',
        ]);
        expect(
          (await rows(teacher, 'payment_proof_received'))[0].params.reference,
        ).toBe(created.request.reference);

        const refused = await rejectPaymentRequest(
          pool,
          admin,
          created.request.id,
          'faux justificatif interne',
          now,
        );
        expect(refused.ok).toBe(true);
        expect(await channels(teacher, 'payment_refused')).toEqual([
          'site',
          'whatsapp',
        ]);
        expect(
          JSON.stringify(await rows(teacher, 'payment_refused')),
        ).not.toContain('faux justificatif');

        const bought = await purchaseCode(pool, admin, teacher, { now });
        expect(await channels(teacher, 'code_issued')).toEqual([
          'site',
          'whatsapp',
        ]);
        // The activation code is hashed everywhere: it must not be stored in a message either.
        expect(
          JSON.stringify(await rows(teacher, 'code_issued')),
        ).not.toContain(bought.code);
        expect(JSON.stringify(await rows(teacher, 'code_issued'))).not.toMatch(
          /TTP-[A-Z0-9]{4}-[A-Z0-9]{4}/,
        ); // a payment reference (TTP-12345) is fine, a code is not
      });

      it('a published review is announced once, even if hidden and restored', async () => {
        const teacher = await createApprovedTeacher(pool, ids, admin, now);
        await pool.query('DELETE FROM notifications');
        const { rows: author } = await pool.query(
          `INSERT INTO users (role, phone_e164, status, phone_verified_at)
         VALUES ('visitor', '+21655000001', 'active', now()) RETURNING id`,
        );
        const { rows: profile } = await pool.query(
          'SELECT slug FROM teacher_profiles WHERE user_id = $1',
          [teacher],
        );
        const review = await submitReview(
          pool,
          {
            authorId: author[0].id,
            slug: profile[0].slug,
            rating: '4',
            comment: '',
          },
          now,
        );
        if (!review.ok) throw new Error('review failed');
        expect(await rows(teacher)).toEqual([]); // waiting: nothing yet

        await moderateReview(pool, admin, review.reviewId, 'publish', now);
        await moderateReview(pool, admin, review.reviewId, 'hide', now);
        await moderateReview(pool, admin, review.reviewId, 'restore', now);
        const notices = await rows(teacher, 'review_published');
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
          channel: 'site',
          params: { rating: 4 },
        });
      });

      it('the outcome of a report goes to the teacher who reported', async () => {
        const teacher = await createApprovedTeacher(pool, ids, admin, now);
        const { rows: author } = await pool.query(
          `INSERT INTO users (role, phone_e164, status, phone_verified_at)
         VALUES ('visitor', '+21655000002', 'active', now()) RETURNING id`,
        );
        const { rows: profile } = await pool.query(
          'SELECT slug FROM teacher_profiles WHERE user_id = $1',
          [teacher],
        );
        const review = await submitReview(
          pool,
          {
            authorId: author[0].id,
            slug: profile[0].slug,
            rating: 1,
            comment: 'x',
          },
          now,
        );
        if (!review.ok) throw new Error('review failed');
        await moderateReview(pool, admin, review.reviewId, 'publish', now);
        await reportReview(
          pool,
          {
            teacherId: teacher,
            reviewId: review.reviewId,
            reason: 'fake_review',
            note: '',
            device: device('t'),
          },
          now,
        );
        await pool.query('DELETE FROM notifications');

        await moderateReview(pool, admin, review.reviewId, 'hide', now);
        const outcome = await rows(teacher, 'review_report_outcome');
        expect(outcome).toHaveLength(1);
        expect(outcome[0].params.outcome).toBe('upheld');
      });
    });

    // -------------------------------------------------------------------------- reminders

    describe('expiry reminders (30, 7 and 1 day)', () => {
      const keys = async (id: string) =>
        [
          ...new Set(
            (await rows(id, 'plan_expiring')).map((r) => r.dedupe_key),
          ),
        ].sort();

      it('queues the right reminder, once, and the next one when its day comes', async () => {
        const teacher = await teacherEndingIn(20);
        expect(await queueExpiryReminders(pool, now)).toBe(2); // site + WhatsApp
        expect(await queueExpiryReminders(pool, now)).toBe(0); // run twice: nothing new
        const until = inDays(20).toISOString().slice(0, 10);
        expect(await keys(teacher)).toEqual([`plan_expiring:30:${until}`]);

        // 6 days later (14 left): still the 30-day reminder, already sent.
        expect(await queueExpiryReminders(pool, inDays(6))).toBe(0);
        // 14 days later (6 left): the 7-day reminder.
        expect(await queueExpiryReminders(pool, inDays(14))).toBe(2);
        // 19.5 days later (about 12 hours left): the 1-day reminder.
        expect(
          await queueExpiryReminders(
            pool,
            new Date(inDays(19).getTime() + 12 * 3600 * 1000),
          ),
        ).toBe(2);
        expect(await keys(teacher)).toEqual(
          [
            `plan_expiring:1:${until}`,
            `plan_expiring:30:${until}`,
            `plan_expiring:7:${until}`,
          ].sort(),
        );
        expect((await rows(teacher, 'plan_expiring'))[0].params).toMatchObject({
          name: 'Wassima Chaaben',
        });
      });

      it('sends one reminder, not three, to a teacher who is already close to the end', async () => {
        const teacher = await teacherEndingIn(5);
        await queueExpiryReminders(pool, now);
        expect(await keys(teacher)).toHaveLength(1);
        expect((await rows(teacher, 'plan_expiring'))[0].params).toMatchObject({
          days: 7,
        });
      });

      it('queues nothing for a plan with more than 30 days, an ended plan, or a profile that never was approved', async () => {
        const far = await teacherEndingIn(40);
        const ended = await teacherEndingIn(-2);
        const pending = await createPendingTeacher(pool, ids, {
          submittedAt: now,
        });
        await pool.query(
          `INSERT INTO entitlements (teacher_id, visibility_until) VALUES ($1, $2)`,
          [pending, inDays(10)],
        );
        expect(await queueExpiryReminders(pool, now)).toBe(0);
        expect(await rows(far)).toEqual([]);
        expect(await rows(ended)).toEqual([]);
        expect(await rows(pending)).toEqual([]);
      });

      it('a renewal moves the end date, so the new term gets its own reminders', async () => {
        const teacher = await teacherEndingIn(20);
        await queueExpiryReminders(pool, now);
        await pool.query(
          'UPDATE entitlements SET visibility_until = $2 WHERE teacher_id = $1',
          [teacher, inDays(110)],
        );
        expect(await queueExpiryReminders(pool, now)).toBe(0); // 110 days left
        expect(await queueExpiryReminders(pool, inDays(85))).toBe(2); // 25 days left: 30-day reminder
        expect(await keys(teacher)).toHaveLength(2);
      });

      it('does not write to a suspended account', async () => {
        const teacher = await teacherEndingIn(10);
        await pool.query(
          `UPDATE users SET status = 'suspended' WHERE id = $1`,
          [teacher],
        );
        expect(await queueExpiryReminders(pool, now)).toBe(0);
      });
    });

    describe('"abonnement terminé" and the end of the Dashboard grace period', () => {
      it('announces an ended plan once, only for the last 30 days', async () => {
        const recent = await teacherEndingIn(-3);
        const old = await teacherEndingIn(-45);
        expect(await queueExpiredNotices(pool, now)).toBe(2);
        expect(await queueExpiredNotices(pool, now)).toBe(0);
        expect(await channels(recent, 'plan_expired')).toEqual([
          'site',
          'whatsapp',
        ]);
        expect(await rows(old)).toEqual([]);
      });

      it('warns 7 days before the 30 read-only days end, once', async () => {
        const soon = await teacherEndingIn(-25); // grace ends in 5 days
        const later = await teacherEndingIn(-10); // 20 days left
        const over = await teacherEndingIn(-31); // already over
        const active = await teacherEndingIn(10); // Dashboard still running
        expect(await queueGraceWarnings(pool, now)).toBe(2);
        expect(await queueGraceWarnings(pool, now)).toBe(0);
        expect(await channels(soon, 'grace_ending')).toEqual([
          'site',
          'whatsapp',
        ]);
        for (const id of [later, over, active])
          expect(await rows(id, 'grace_ending')).toEqual([]);

        const [warning] = await rows(soon, 'grace_ending');
        expect(new Date(warning.params.date).getTime()).toBe(
          inDays(-25).getTime() + 30 * DAY,
        );
        // Later, the teacher whose grace had 20 days left gets theirs too.
        expect(await queueGraceWarnings(pool, inDays(14))).toBe(2);
      });
    });

    // ---------------------------------------------------------------------------- cleanup

    describe('cleaning old rows', () => {
      it('deletes what is old and keeps what is recent', async () => {
        const teacher = await teacherEndingIn(100);
        const old = new Date(now.getTime() - 400 * DAY);
        const recent = new Date(now.getTime() - 1 * DAY);
        await pool.query(
          `INSERT INTO rate_limit_events (bucket, key, created_at) VALUES ('b','old',$1),('b','recent',$2)`,
          [old, recent],
        );
        await pool.query(
          `INSERT INTO webhook_events (provider, message_id, received_at) VALUES ('p','old',$1),('p','recent',$2)`,
          [old, recent],
        );
        await pool.query(
          `INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1,'old',$2),($1,'recent',$3)`,
          [teacher, old, new Date(now.getTime() + DAY)],
        );
        await pool.query(
          `INSERT INTO notifications (user_id, kind, channel, dedupe_key, status, read_at, created_at)
         VALUES ($1,'plan_expired','site','old','read',$2,$2), ($1,'plan_expired','site','recent','read',$3,$3),
                ($1,'plan_expired','whatsapp','pending-old','pending',NULL,$2)`,
          [teacher, old, recent],
        );

        const cleaned = await cleanOldRows(pool, now);
        expect(cleaned).toMatchObject({
          rateLimitEvents: 1,
          webhookEvents: 1,
          sessions: 1,
          notifications: 1,
        });
        expect(
          (await pool.query('SELECT key FROM rate_limit_events')).rows,
        ).toEqual([{ key: 'recent' }]);
        expect(
          (await pool.query('SELECT message_id FROM webhook_events')).rows,
        ).toEqual([{ message_id: 'recent' }]);
        expect(
          (await pool.query('SELECT token_hash FROM auth_sessions')).rows,
        ).toEqual([{ token_hash: 'recent' }]);
        // A message still waiting is never deleted, however old.
        expect((await rows(teacher)).map((r) => r.dedupe_key).sort()).toEqual([
          'pending-old',
          'recent',
        ]);
        expect(await cleanOldRows(pool, now)).toEqual({
          rateLimitEvents: 0,
          webhookEvents: 0,
          verificationChallenges: 0,
          sessions: 0,
          notifications: 0,
        });
      });
    });

    // ------------------------------------------------------------------------------ e-mail

    describe('e-mail delivery', () => {
      class FakeProvider implements EmailProvider {
        sent: OutgoingEmail[] = [];
        failures = 0;
        async send(email: OutgoingEmail) {
          if (this.failures > 0) {
            this.failures -= 1;
            throw new Error('provider down');
          }
          this.sent.push(email);
        }
      }

      it('sends each e-mail once, in French and Arabic, to the address of the teacher', async () => {
        const id = await teacherEndingIn(100, { email: 'prof@example.com' });
        await enqueueNotification(pool, {
          userId: id,
          kind: 'plan_expired',
          dedupeKey: 'a',
          params: { date: now.toISOString() },
        });
        const provider = new FakeProvider();

        expect(await deliverPendingEmails(pool, provider, now)).toEqual({
          sent: 1,
          failed: 0,
          waiting: 0,
        });
        expect(await deliverPendingEmails(pool, provider, now)).toEqual({
          sent: 0,
          failed: 0,
          waiting: 0,
        });
        expect(provider.sent).toHaveLength(1);
        expect(provider.sent[0].to).toBe('prof@example.com');
        expect(provider.sent[0].subject).toBe(
          'Votre abonnement est terminé | انتهى اشتراكك',
        );
        expect(provider.sent[0].text).toContain('Bonjour Wassima Chaaben,');
        expect(provider.sent[0].text).toContain('مرحبًا Wassima Chaaben،');
        expect(
          (await rows(id, 'plan_expired')).find((r) => r.channel === 'email')
            ?.status,
        ).toBe('sent');
      });

      it('tries again after a failure and gives up after 3 attempts', async () => {
        const id = await teacherEndingIn(100, { email: 'prof@example.com' });
        await enqueueNotification(pool, {
          userId: id,
          kind: 'plan_expired',
          dedupeKey: 'a',
          params: { date: now.toISOString() },
        });
        const provider = new FakeProvider();
        provider.failures = 99;

        for (let attempt = 1; attempt < MAX_EMAIL_ATTEMPTS; attempt++) {
          expect(await deliverPendingEmails(pool, provider, now)).toMatchObject(
            { sent: 0, failed: 0, waiting: 1 },
          );
        }
        expect(await deliverPendingEmails(pool, provider, now)).toMatchObject({
          sent: 0,
          failed: 1,
          waiting: 0,
        });
        const email = (
          await pool.query(
            `SELECT status, attempts, last_error FROM notifications WHERE channel = 'email'`,
          )
        ).rows[0];
        expect(email).toEqual({
          status: 'failed',
          attempts: MAX_EMAIL_ATTEMPTS,
          last_error: 'provider down',
        });
        // Nothing more is tried.
        expect(await deliverPendingEmails(pool, provider, now)).toMatchObject({
          sent: 0,
          failed: 0,
          waiting: 0,
        });
      });

      it('a failure that heals is delivered on the next run', async () => {
        const id = await teacherEndingIn(100, { email: 'prof@example.com' });
        await enqueueNotification(pool, {
          userId: id,
          kind: 'plan_expired',
          dedupeKey: 'a',
          params: { date: now.toISOString() },
        });
        const provider = new FakeProvider();
        provider.failures = 1;
        expect(await deliverPendingEmails(pool, provider, now)).toMatchObject({
          sent: 0,
          waiting: 1,
        });
        expect(await deliverPendingEmails(pool, provider, now)).toMatchObject({
          sent: 1,
          waiting: 0,
        });
      });

      it('without a provider the e-mails wait, nothing is lost', async () => {
        const id = await teacherEndingIn(100, { email: 'prof@example.com' });
        await enqueueNotification(pool, {
          userId: id,
          kind: 'plan_expired',
          dedupeKey: 'a',
          params: { date: now.toISOString() },
        });
        expect(await deliverPendingEmails(pool, null, now)).toEqual({
          sent: 0,
          failed: 0,
          waiting: 1,
        });
        expect(
          (await rows(id, 'plan_expired')).find((r) => r.channel === 'email')
            ?.status,
        ).toBe('pending');
      });
    });

    // -------------------------------------------------------------- WhatsApp and site notices

    describe('WhatsApp messages sent by hand and on-site notices', () => {
      it('lists the WhatsApp messages in French and Arabic, and an admin marks one as sent', async () => {
        const teacher = await teacherEndingIn(100);
        await enqueueNotification(pool, {
          userId: teacher,
          kind: 'plan_expired',
          dedupeKey: 'a',
          params: { date: now.toISOString() },
        });
        const [item] = await listPendingWhatsApp(pool);
        expect(item.kind).toBe('plan_expired');
        expect(item.phone).toMatch(/^\+216/);
        expect(item.textFr).toContain('Bonjour Wassima Chaaben,');
        expect(item.textAr).toContain('مرحبًا Wassima Chaaben،');

        // Not a teacher, not a reviewer: only an active admin.
        expect(await markWhatsAppSent(pool, teacher, item.id, now)).toBe(
          'forbidden',
        );
        expect(await markWhatsAppSent(pool, admin, item.id, now)).toBe('ok');
        expect(await markWhatsAppSent(pool, admin, item.id, now)).toBe(
          'not_found',
        );
        expect(await listPendingWhatsApp(pool)).toEqual([]);
        expect(
          (
            await pool.query(
              `SELECT handled_by FROM notifications WHERE id = $1`,
              [item.id],
            )
          ).rows[0].handled_by,
        ).toBe(admin);
      });

      it('a teacher sees their own unread notices and can read only their own', async () => {
        const a = await teacherEndingIn(100);
        const b = await teacherEndingIn(100);
        for (const id of [a, b]) {
          await enqueueNotification(pool, {
            userId: id,
            kind: 'plan_expired',
            dedupeKey: 'a',
            params: { date: now.toISOString() },
          });
        }
        const [mine] = await listSiteNotices(pool, a);
        expect(await listSiteNotices(pool, a)).toHaveLength(1);

        const [theirs] = await listSiteNotices(pool, b);
        expect(await markSiteNoticeRead(pool, a, theirs.id, now)).toBe(false);
        expect(await markSiteNoticeRead(pool, a, mine.id, now)).toBe(true);
        expect(await markSiteNoticeRead(pool, a, mine.id, now)).toBe(false);
        expect(await listSiteNotices(pool, a)).toEqual([]);
        expect(await listSiteNotices(pool, b)).toHaveLength(1);
      });
    });

    // ------------------------------------------------------------------------ the daily job

    describe('the daily job', () => {
      it('is safe to run twice: the second run queues and sends nothing', async () => {
        await teacherEndingIn(20, { email: 'a@example.com' }); // 30-day reminder
        await teacherEndingIn(-3, { email: 'b@example.com' }); // ended
        await teacherEndingIn(-25); // grace ends soon
        const provider: EmailProvider & { sent: OutgoingEmail[] } = {
          sent: [],
          async send(email) {
            this.sent.push(email);
          },
        };

        const first = await runDailyJob(pool, now, { email: provider });
        expect(first).toMatchObject({
          remindersQueued: 3, // teacher A: site + WhatsApp + e-mail
          expiredNoticesQueued: 5, // B: three channels, C: site + WhatsApp
          graceWarningsQueued: 2, // C only: site + WhatsApp
          emails: { sent: 2, failed: 0, waiting: 0 }, // A's reminder and B's notice
        });
        expect(provider.sent.map((e) => e.to).sort()).toEqual([
          'a@example.com',
          'b@example.com',
        ]);
        const afterFirst = await rows();

        const second = await runDailyJob(pool, now, { email: provider });
        expect(second).toMatchObject({
          codesExpired: 0,
          remindersQueued: 0,
          expiredNoticesQueued: 0,
          graceWarningsQueued: 0,
          emails: { sent: 0, failed: 0, waiting: 0 },
        });
        expect(provider.sent).toHaveLength(2);
        expect(await rows()).toEqual(afterFirst);
      });

      it('keeps the e-mails waiting when no provider is set, and still does the rest', async () => {
        await teacherEndingIn(20, { email: 'a@example.com' });
        const result = await runDailyJob(pool, now, { email: null });
        expect(result.remindersQueued).toBe(3);
        expect(result.emails).toEqual({ sent: 0, failed: 0, waiting: 1 });
      });

      it('a broken e-mail provider does not stop the other steps', async () => {
        await teacherEndingIn(20, { email: 'a@example.com' });
        const broken: EmailProvider = {
          async send() {
            throw new Error('down');
          },
        };
        const result = await runDailyJob(pool, now, { email: broken });
        expect(result.remindersQueued).toBe(3);
        expect(result.emails).toMatchObject({ sent: 0, waiting: 1 });
        expect(result.cleaned).toBeDefined();
      });
    });
  },
);
