import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveVerificationCode } from '@/lib/auth/crypto';
import {
  consumeChallenge,
  getChallengeView,
  startChallenge,
  type StartResult,
} from '@/lib/auth/verification';
import { runMigrations } from '@/db/migrate';
import {
  at,
  challengeStatus,
  clearAuthTables,
  device,
  minutes,
  PHONE_A,
  PHONE_B,
  sendWhatsApp,
  T0,
  verifyChallenge,
} from './auth-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';

describe.skipIf(!testDatabaseUrl)('WhatsApp verification (database)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await clearAuthTables(pool);
  });

  async function start(
    phone = PHONE_A,
    dev = device(),
    now = T0,
    purpose: 'signup' | 'reset' | 'visitor_login' = 'visitor_login',
  ): Promise<Extract<StartResult, { ok: true }>> {
    const result = await startChallenge(
      pool,
      { phone, purpose, userId: null, device: dev },
      now,
    );
    if (!result.ok) throw new Error(`could not start: ${result.reason}`);
    return result;
  }

  describe('starting', () => {
    it('shows a TTP-XXXX code to the browser that asked, and stores only a hash', async () => {
      const { challengeId } = await start();
      const view = await getChallengeView(
        pool,
        challengeId,
        device().deviceHash,
        T0,
      );
      expect(view?.status).toBe('pending');
      expect(view?.code).toMatch(/^TTP-[A-HJ-NP-Z2-9]{4}$/);

      const { rows } = await pool.query(
        'SELECT code_hash FROM otp_challenges WHERE id = $1',
        [challengeId],
      );
      expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].code_hash).not.toContain(view!.code!.slice(4));
    });

    it('is invisible to any other browser', async () => {
      const { challengeId } = await start();
      expect(
        await getChallengeView(
          pool,
          challengeId,
          device('other').deviceHash,
          T0,
        ),
      ).toBeNull();
      expect(
        await getChallengeView(pool, 'not-a-uuid', device().deviceHash, T0),
      ).toBeNull();
    });

    it('lasts 5 minutes', async () => {
      const { challengeId, expiresAt } = await start();
      expect(expiresAt.getTime() - T0.getTime()).toBe(minutes(5));
      expect(
        await challengeStatus(pool, challengeId, device(), at(minutes(4.9))),
      ).toBe('pending');
      expect(
        await challengeStatus(pool, challengeId, device(), at(minutes(5))),
      ).toBe('expired');
    });

    it('a newer challenge replaces the older one', async () => {
      const first = await start(PHONE_A, device(), T0);
      const second = await start(PHONE_A, device(), at(minutes(1)));
      expect(
        await challengeStatus(
          pool,
          first.challengeId,
          device(),
          at(minutes(1)),
        ),
      ).toBe('expired');
      // The old code no longer verifies; the new one does.
      expect(
        await verifyChallenge(pool, first.challengeId, PHONE_A, at(minutes(1))),
      ).toBe('wrong_code');
      expect(
        await verifyChallenge(
          pool,
          second.challengeId,
          PHONE_A,
          at(minutes(1)),
        ),
      ).toBe('verified');
    });
  });

  describe('acceptance test 21', () => {
    it('verifies when the right code comes from the number that was typed', async () => {
      const { challengeId } = await start();
      expect(
        await verifyChallenge(pool, challengeId, PHONE_A, at(minutes(1))),
      ).toBe('verified');
      expect(
        await challengeStatus(pool, challengeId, device(), at(minutes(1))),
      ).toBe('verified');
    });

    it('FAILS when the code is sent from a different phone than the one typed', async () => {
      const { challengeId } = await start(PHONE_A);
      const outcome = await verifyChallenge(
        pool,
        challengeId,
        PHONE_B,
        at(minutes(1)),
      );
      expect(outcome).toBe('wrong_sender');
      expect(
        await challengeStatus(pool, challengeId, device(), at(minutes(1))),
      ).toBe('pending');
    });

    it('FAILS when the sender has its own waiting challenge and sends the other code', async () => {
      const a = await start(PHONE_A, device('a'));
      await start(PHONE_B, device('b'));
      expect(
        await verifyChallenge(pool, a.challengeId, PHONE_B, at(minutes(1))),
      ).toBe('wrong_code');
      expect(
        await challengeStatus(pool, a.challengeId, device('a'), at(minutes(1))),
      ).toBe('pending');
    });

    it('FAILS when the code is older than 5 minutes', async () => {
      const { challengeId } = await start();
      expect(
        await verifyChallenge(
          pool,
          challengeId,
          PHONE_A,
          at(minutes(5) + 1000),
        ),
      ).toBe('expired');
      expect(
        await challengeStatus(
          pool,
          challengeId,
          device(),
          at(minutes(5) + 1000),
        ),
      ).toBe('expired');
    });

    it('locks for one hour after 5 wrong tries: the 6th attempt fails even with the right code', async () => {
      const { challengeId } = await start();

      for (let i = 1; i <= 5; i++) {
        const outcome = await sendWhatsApp(
          pool,
          PHONE_A,
          `TTP-ZZZ${i + 1}`,
          at(minutes(1)),
        );
        expect(outcome).toBe('wrong_code');
      }
      // 6th attempt, with the RIGHT code:
      expect(
        await verifyChallenge(pool, challengeId, PHONE_A, at(minutes(2))),
      ).toBe('locked');
      expect(
        await challengeStatus(pool, challengeId, device(), at(minutes(2))),
      ).toBe('locked');

      // A new challenge for that number is refused for one hour...
      const retry = await startChallenge(
        pool,
        {
          phone: PHONE_A,
          purpose: 'visitor_login',
          userId: null,
          device: device(),
        },
        at(minutes(30)),
      );
      expect(retry).toMatchObject({ ok: false, reason: 'locked' });
      if (!retry.ok) {
        // 5th wrong try at +1 min, locked until +61 min; asked at +30 min.
        expect(retry.retryAfterMs).toBe(minutes(31));
      }

      // ...and accepted after it.
      const later = await startChallenge(
        pool,
        {
          phone: PHONE_A,
          purpose: 'visitor_login',
          userId: null,
          device: device(),
        },
        at(minutes(62)),
      );
      expect(later.ok).toBe(true);
    });

    it('the code sent from a wrong phone also counts as an attempt against the challenge', async () => {
      const { challengeId } = await start(PHONE_A);
      for (let i = 0; i < 5; i++) {
        const outcome = await verifyChallenge(
          pool,
          challengeId,
          PHONE_B,
          at(minutes(1)),
        );
        expect(outcome).toBe('wrong_sender');
      }
      // Now locked, even from the right phone.
      expect(
        await verifyChallenge(pool, challengeId, PHONE_A, at(minutes(1))),
      ).toBe('locked');
    });
  });

  describe('messages WhatsApp may send', () => {
    it('accepts the code inside any text, in any case', async () => {
      const { challengeId } = await start();
      const code = deriveVerificationCode(challengeId).toLowerCase();
      expect(
        await sendWhatsApp(
          pool,
          PHONE_A,
          `merci de vérifier mon numéro ${code} svp`,
          at(1000),
        ),
      ).toBe('verified');
    });

    it('ignores messages without a code and from numbers nobody waits for', async () => {
      await start();
      expect(await sendWhatsApp(pool, PHONE_A, 'bonjour')).toBe('no_code');
      expect(await sendWhatsApp(pool, PHONE_B, 'TTP-ABCD')).toBe(
        'no_challenge',
      );
      expect(await sendWhatsApp(pool, '+33612345678', 'TTP-ABCD')).toBe(
        'no_challenge',
      );
    });

    it('does not count the same message twice when Meta delivers it again', async () => {
      const { challengeId } = await start();
      expect(
        await sendWhatsApp(pool, PHONE_A, 'TTP-ZZZ2', T0, 'wamid.same'),
      ).toBe('wrong_code');
      expect(
        await sendWhatsApp(pool, PHONE_A, 'TTP-ZZZ2', T0, 'wamid.same'),
      ).toBe('duplicate');
      const { rows } = await pool.query(
        'SELECT attempts FROM otp_challenges WHERE id = $1',
        [challengeId],
      );
      expect(rows[0].attempts).toBe(1);
    });

    it('a code works only once', async () => {
      const { challengeId } = await start();
      expect(await verifyChallenge(pool, challengeId, PHONE_A)).toBe(
        'verified',
      );
      // Already verified: nobody is waiting any more.
      expect(await verifyChallenge(pool, challengeId, PHONE_A)).toBe(
        'no_challenge',
      );
    });
  });

  describe('using a verified challenge', () => {
    const use = (
      challengeId: string,
      dev = device(),
      now = at(minutes(1)),
      purpose: 'signup' | 'reset' | 'visitor_login' = 'visitor_login',
    ) =>
      consumeChallenge(
        pool,
        { challengeId, deviceHash: dev.deviceHash, purpose },
        now,
      );

    it('refuses before the number is verified', async () => {
      const { challengeId } = await start();
      expect(await use(challengeId)).toEqual({
        ok: false,
        reason: 'not_verified',
      });
    });

    it('works once, from the same browser, for the same purpose', async () => {
      const { challengeId } = await start();
      await verifyChallenge(pool, challengeId, PHONE_A, at(minutes(1)));

      expect(await use(challengeId, device('other'))).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(await use(challengeId, device(), at(minutes(1)), 'reset')).toEqual(
        {
          ok: false,
          reason: 'not_found',
        },
      );
      expect(await use(challengeId)).toEqual({
        ok: true,
        phone: PHONE_A,
        userId: null,
      });
      expect(await use(challengeId)).toEqual({
        ok: false,
        reason: 'already_used',
      });
    });

    it('refuses when more than 5 minutes passed after the verification', async () => {
      const { challengeId } = await start();
      await verifyChallenge(pool, challengeId, PHONE_A, at(minutes(1)));
      expect(
        await use(challengeId, device(), at(minutes(1) + minutes(5) + 1000)),
      ).toEqual({
        ok: false,
        reason: 'too_late',
      });
    });
  });

  describe('rate limits', () => {
    it('allows 5 verification requests per phone per hour, then says when to retry', async () => {
      for (let i = 0; i < 5; i++)
        await start(PHONE_A, device(), at(minutes(i)));
      const sixth = await startChallenge(
        pool,
        {
          phone: PHONE_A,
          purpose: 'visitor_login',
          userId: null,
          device: device(),
        },
        at(minutes(5)),
      );
      expect(sixth).toMatchObject({ ok: false, reason: 'rate_limited' });
      if (!sixth.ok) expect(sixth.retryAfterMs).toBe(minutes(55)); // first one leaves the window at +60

      expect(
        (
          await startChallenge(
            pool,
            {
              phone: PHONE_A,
              purpose: 'visitor_login',
              userId: null,
              device: device(),
            },
            at(minutes(61)),
          )
        ).ok,
      ).toBe(true);
    });

    it('allows 10 requests per device per hour, even for different phones', async () => {
      for (let i = 0; i < 10; i++) {
        await start(
          `+2162234${String(1000 + i)}`,
          device('same'),
          at(minutes(i)),
        );
      }
      const eleventh = await startChallenge(
        pool,
        {
          phone: PHONE_B,
          purpose: 'visitor_login',
          userId: null,
          device: device('same'),
        },
        at(minutes(10)),
      );
      expect(eleventh).toMatchObject({ ok: false, reason: 'rate_limited' });

      // Another device is not affected.
      expect(
        (
          await startChallenge(
            pool,
            {
              phone: PHONE_B,
              purpose: 'visitor_login',
              userId: null,
              device: device('other'),
            },
            at(minutes(10)),
          )
        ).ok,
      ).toBe(true);
    });
  });
});
