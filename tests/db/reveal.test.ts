import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { REPORT_LIMITS, REVEAL_LIMITS } from '@/lib/marketplace/config';
import { reportProfile } from '@/lib/marketplace/reports';
import { revealContact } from '@/lib/marketplace/reveal';
import { saveProfile, submitProfile } from '@/lib/profile/repo';
import { approveProfile } from '@/lib/profile/review';
import { at, clearAuthTables, device, minutes, T0 } from './auth-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';
import {
  completeInput,
  createAdminUser,
  createTeacher,
  loadCatalogueIds,
  type CatalogueIds,
} from './profile-helpers';

const accept = async () => true;
const refuse = async () => false;

describe.skipIf(!testDatabaseUrl)(
  'contact reveal and reports (database)',
  () => {
    let pool: Pool;
    let ids: CatalogueIds;
    let admin: string;

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

    /** An approved teacher, visible at T0. Returns the slug and the real phone. */
    async function visibleTeacher() {
      const id = await createTeacher(pool);
      const saved = await saveProfile(pool, id, completeInput(ids), {
        strict: true,
      });
      if (!saved.ok) throw new Error('save failed');
      const submitted = await submitProfile(pool, id, T0);
      if (!submitted.ok) throw new Error('submit failed');
      const result = await approveProfile(pool, admin, id, T0);
      if (!result.ok) throw new Error('approve failed');
      const { rows } = await pool.query(
        'SELECT phone_e164 FROM users WHERE id = $1',
        [id],
      );
      return { id, slug: result.slug, phone: rows[0].phone_e164 as string };
    }

    const revealCount = async (teacher: string) =>
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM contact_events
          WHERE teacher_id = $1 AND type = 'reveal'`,
          [teacher],
        )
      ).rows[0].n as number;

    describe('click-to-reveal', () => {
      it('gives the phone number and logs the reveal without storing it', async () => {
        const teacher = await visibleTeacher();
        const result = await revealContact(
          pool,
          { slug: teacher.slug, device: device('a') },
          { now: at(minutes(1)) },
        );
        expect(result).toEqual({ ok: true, phone: teacher.phone });

        const { rows } = await pool.query(
          'SELECT * FROM contact_events WHERE teacher_id = $1',
          [teacher.id],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          type: 'reveal',
          session_hash: device('a').deviceHash,
        });
        expect(JSON.stringify(rows)).not.toContain(teacher.phone.slice(4));
      });

      it('refuses a hidden profile and logs nothing', async () => {
        const teacher = await visibleTeacher();
        await pool.query(
          `UPDATE entitlements SET visibility_until = $2 WHERE teacher_id = $1`,
          [teacher.id, at(minutes(5))],
        );
        expect(
          await revealContact(
            pool,
            { slug: teacher.slug, device: device('a') },
            { now: at(minutes(10)) },
          ),
        ).toEqual({ ok: false, reason: 'not_found' });
        expect(
          await revealContact(
            pool,
            { slug: 'unknown-address', device: device('a') },
            { now: at(minutes(10)) },
          ),
        ).toEqual({ ok: false, reason: 'not_found' });
        expect(await revealCount(teacher.id)).toBe(0);
      });

      it('asks for Turnstile from the 11th reveal in an hour', async () => {
        const teacher = await visibleTeacher();
        for (let i = 0; i < REVEAL_LIMITS.turnstileAfter; i++) {
          const result = await revealContact(
            pool,
            { slug: teacher.slug, device: device('a') },
            { now: at(minutes(i)), verify: refuse },
          );
          expect(result.ok).toBe(true);
        }
        const now = at(minutes(20));
        expect(
          await revealContact(
            pool,
            { slug: teacher.slug, device: device('a') },
            { now, verify: accept },
          ),
        ).toEqual({ ok: false, reason: 'captcha_required' });
        expect(
          await revealContact(
            pool,
            { slug: teacher.slug, device: device('a'), turnstileToken: 'bad' },
            { now, verify: refuse },
          ),
        ).toEqual({ ok: false, reason: 'captcha_failed' });
        expect(
          await revealContact(
            pool,
            { slug: teacher.slug, device: device('a'), turnstileToken: 'good' },
            { now, verify: accept },
          ),
        ).toMatchObject({ ok: true });
        // The refused attempts were not counted.
        expect(await revealCount(teacher.id)).toBe(
          REVEAL_LIMITS.turnstileAfter + 1,
        );
      });

      it('blocks the 31st reveal from one device in an hour (acceptance test 14)', async () => {
        const teacher = await visibleTeacher();
        for (let i = 0; i < REVEAL_LIMITS.perDevice; i++) {
          const result = await revealContact(
            pool,
            {
              slug: teacher.slug,
              device: device('a'),
              // from the 11th reveal the widget is shown and its answer sent
              turnstileToken: i >= REVEAL_LIMITS.turnstileAfter ? 'good' : null,
            },
            { now: at(minutes(i)), verify: accept },
          );
          expect(result.ok).toBe(true);
        }

        const blocked = await revealContact(
          pool,
          { slug: teacher.slug, device: device('a'), turnstileToken: 'good' },
          { now: at(minutes(40)), verify: accept },
        );
        expect(blocked).toMatchObject({ ok: false, reason: 'rate_limited' });
        if (!blocked.ok && blocked.reason === 'rate_limited') {
          // The first reveal (minute 0) leaves the hour window at minute 60.
          expect(blocked.retryAfterMs).toBe(minutes(20));
        }
        expect(await revealCount(teacher.id)).toBe(REVEAL_LIMITS.perDevice);

        // Another device is not affected.
        expect(
          await revealContact(
            pool,
            { slug: teacher.slug, device: device('b') },
            { now: at(minutes(40)) },
          ),
        ).toMatchObject({ ok: true });

        // An hour after the first reveal, the device can reveal again.
        expect(
          await revealContact(
            pool,
            { slug: teacher.slug, device: device('a'), turnstileToken: 'good' },
            { now: at(minutes(61)), verify: accept },
          ),
        ).toMatchObject({ ok: true });
      });

      it('counts reveals of different teachers together', async () => {
        const first = await visibleTeacher();
        const second = await visibleTeacher();
        for (let i = 0; i < REVEAL_LIMITS.perDevice; i++) {
          const target = i % 2 === 0 ? first : second;
          await revealContact(
            pool,
            {
              slug: target.slug,
              device: device('a'),
              turnstileToken: 'good',
            },
            { now: at(minutes(i)), verify: accept },
          );
        }
        expect(
          await revealContact(
            pool,
            { slug: second.slug, device: device('a'), turnstileToken: 'good' },
            { now: at(minutes(45)), verify: accept },
          ),
        ).toMatchObject({ ok: false, reason: 'rate_limited' });
      });

      it('limits one network address across devices', async () => {
        const teacher = await visibleTeacher();
        // Many different devices behind one address (clearing cookies does not help).
        for (let i = 0; i < REVEAL_LIMITS.perIp; i++) {
          await pool.query(
            `INSERT INTO rate_limit_events (bucket, key, created_at)
           VALUES ('reveal:ip', 'ip-hash-shared', $1)`,
            [at(minutes(1))],
          );
        }
        expect(
          await revealContact(
            pool,
            {
              slug: teacher.slug,
              device: {
                deviceHash: 'brand-new-device',
                ipHash: 'ip-hash-shared',
              },
            },
            { now: at(minutes(2)) },
          ),
        ).toMatchObject({ ok: false, reason: 'rate_limited' });
      });
    });

    describe('Signaler ce profil', () => {
      const report = (
        slug: string,
        overrides: Partial<Parameters<typeof reportProfile>[1]> = {},
        now = at(minutes(1)),
      ) =>
        reportProfile(
          pool,
          {
            slug,
            reason: 'wrong_info',
            note: '',
            reporterId: null,
            device: device('a'),
            ...overrides,
          },
          now,
        );

      it('stores an open report', async () => {
        const teacher = await visibleTeacher();
        expect(
          await report(teacher.slug, { note: '  Diplôme douteux  ' }),
        ).toEqual({
          ok: true,
        });
        const { rows } = await pool.query(
          'SELECT reason, note, status, session_hash FROM reports WHERE teacher_id = $1',
          [teacher.id],
        );
        expect(rows).toEqual([
          {
            reason: 'wrong_info',
            note: 'Diplôme douteux',
            status: 'open',
            session_hash: device('a').deviceHash,
          },
        ]);
      });

      it('needs a note for "other", and refuses unknown reasons or long notes', async () => {
        const teacher = await visibleTeacher();
        expect(
          await report(teacher.slug, { reason: 'other', note: '   ' }),
        ).toEqual({
          ok: false,
          reason: 'invalid',
        });
        expect(
          await report(teacher.slug, { reason: 'other', note: 'Explication' }),
        ).toEqual({
          ok: true,
        });
        expect(await report(teacher.slug, { reason: 'spam' })).toEqual({
          ok: false,
          reason: 'invalid',
        });
        expect(
          await report(teacher.slug, {
            note: 'x'.repeat(501),
            device: device('c'),
          }),
        ).toEqual({ ok: false, reason: 'invalid' });
      });

      it('accepts one open report per browser and profile', async () => {
        const teacher = await visibleTeacher();
        expect(await report(teacher.slug)).toEqual({ ok: true });
        expect(await report(teacher.slug)).toEqual({
          ok: false,
          reason: 'already_reported',
        });
        // Another browser can report the same profile.
        expect(await report(teacher.slug, { device: device('b') })).toEqual({
          ok: true,
        });
        const { rows } = await pool.query(
          'SELECT count(*)::int AS n FROM reports WHERE teacher_id = $1',
          [teacher.id],
        );
        expect(rows[0].n).toBe(2);
      });

      it('refuses a hidden profile', async () => {
        const teacher = await visibleTeacher();
        await pool.query(
          'UPDATE teacher_profiles SET is_listed = false WHERE user_id = $1',
          [teacher.id],
        );
        expect(await report(teacher.slug)).toEqual({
          ok: false,
          reason: 'not_found',
        });
      });

      it('limits how many reports one browser can send in an hour', async () => {
        for (let i = 0; i < REPORT_LIMITS.perDevice; i++) {
          const teacher = await visibleTeacher();
          expect(await report(teacher.slug)).toEqual({ ok: true });
        }
        const extra = await visibleTeacher();
        expect(await report(extra.slug)).toEqual({
          ok: false,
          reason: 'rate_limited',
        });
        // An hour later it works again.
        expect(await report(extra.slug, {}, at(minutes(62)))).toEqual({
          ok: true,
        });
      });
    });
  },
);
