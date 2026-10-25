import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import {
  CHECK_VIOLATION,
  createTestPool,
  testDatabaseUrl,
  UNIQUE_VIOLATION,
  withRollback,
} from './helpers';

describe.skipIf(!testDatabaseUrl)('users table rules (database)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  type Row = Partial<{
    role: string;
    phone: string;
    email: string | null;
    hash: string | null;
    status: string;
    verified: boolean;
    consent: boolean;
  }>;

  // Inserts a user. Defaults describe a valid, active teacher; tests break one thing at a time.
  const insert = (client: PoolClient, row: Row = {}) => {
    const r = {
      role: 'teacher',
      phone: '+21622345678',
      email: null,
      hash: '$argon2id$placeholder',
      status: 'active',
      verified: true,
      consent: true,
      ...row,
    };
    return client.query(
      `INSERT INTO users (role, phone_e164, email, password_hash, status,
                          phone_verified_at, phone_display_consent_at, terms_accepted_at)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6 THEN now() END, CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN now() END)`,
      [r.role, r.phone, r.email, r.hash, r.status, r.verified, r.consent],
    );
  };
  const rejects = (row: Row, code = CHECK_VIOLATION) =>
    expect(withRollback(pool, (c) => insert(c, row))).rejects.toMatchObject({
      code,
    });

  it('accepts a valid teacher, admin and visitor', async () => {
    await withRollback(pool, async (c) => {
      await insert(c);
      await insert(c, {
        role: 'admin_super',
        phone: '+21655111222',
        consent: false,
      });
      await insert(c, {
        role: 'admin_support',
        phone: '+21698765432',
        consent: false,
      });
      await insert(c, {
        role: 'visitor',
        phone: '+21644123456',
        hash: null,
        consent: false,
      });
    });
  });

  describe('password rule (owner decision): NULL for visitors, and only for them', () => {
    it('refuses a teacher or an admin without a password', async () => {
      await rejects({ role: 'teacher', hash: null });
      await rejects({ role: 'admin_super', hash: null, consent: false });
      await rejects({ role: 'admin_support', hash: null, consent: false });
    });

    it('refuses a visitor with a password', async () => {
      await rejects({ role: 'visitor', hash: '$argon2id$x', consent: false });
    });
  });

  describe('phone number', () => {
    it('refuses numbers that are not Tunisian mobile numbers', async () => {
      for (const phone of [
        '+21612345678', // starts with 1
        '+21632345678', // starts with 3
        '+2162234567', // 7 digits
        '+216223456789', // 9 digits
        '21622345678', // no plus sign
        '22345678',
        '+33612345678',
        '+216 22345678',
      ]) {
        await rejects({ phone });
      }
    });

    it('accepts the 4 allowed first digits', async () => {
      await withRollback(pool, async (c) => {
        let i = 0;
        for (const first of ['2', '4', '5', '9']) {
          await insert(c, { phone: `+216${first}000000${i++}` });
        }
      });
    });

    it('is unique: one number, one account', async () => {
      await expect(
        withRollback(pool, async (c) => {
          await insert(c);
          await insert(c, { role: 'visitor', hash: null, consent: false });
        }),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });
  });

  describe('consents and status', () => {
    it('refuses a teacher without the timestamped consents', async () => {
      await rejects({ consent: false });
    });

    it('refuses an active account whose phone is not verified', async () => {
      await rejects({ status: 'active', verified: false });
    });

    it('allows a pending account with an unverified phone', async () => {
      await withRollback(pool, (c) =>
        insert(c, { status: 'pending', verified: false }),
      );
    });

    it('refuses an unknown role or status', async () => {
      await rejects({ role: 'superhero' });
      await rejects({ status: 'banned' });
    });
  });

  describe('email', () => {
    it('is optional, lowercase and shaped like an address', async () => {
      await withRollback(pool, (c) => insert(c, { email: 'prof@example.tn' }));
      await rejects({ email: 'Prof@Example.tn' });
      await rejects({ email: 'not an email' });
      await rejects({ email: 'a@b' });
    });
  });

  describe('sessions and challenges', () => {
    it('a deleted user takes its sessions with it', async () => {
      await withRollback(pool, async (c) => {
        await insert(c);
        await c.query(
          `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
           SELECT id, 'hash-1', now() + interval '1 day' FROM users`,
        );
        await c.query('DELETE FROM users');
        const { rows } = await c.query(
          'SELECT count(*)::int AS n FROM auth_sessions',
        );
        expect(rows[0].n).toBe(0);
      });
    });

    it('two sessions can never share a token hash', async () => {
      await expect(
        withRollback(pool, async (c) => {
          await insert(c);
          const add = () =>
            c.query(
              `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
               SELECT id, 'same', now() + interval '1 day' FROM users`,
            );
          await add();
          await add();
        }),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('a challenge cannot be used before it is verified', async () => {
      await expect(
        withRollback(pool, (c) =>
          c.query(
            `INSERT INTO otp_challenges (id, phone_e164, purpose, code_hash, expires_at, device_hash, consumed_at)
             VALUES (gen_random_uuid(), '+21622345678', 'signup', 'h', now(), 'd', now())`,
          ),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('a challenge has a known purpose and channel', async () => {
      const insertChallenge = (purpose: string, channel: string) =>
        withRollback(pool, (c) =>
          c.query(
            `INSERT INTO otp_challenges (id, phone_e164, purpose, channel, code_hash, expires_at, device_hash)
             VALUES (gen_random_uuid(), '+21622345678', $1, $2, 'h', now(), 'd')`,
            [purpose, channel],
          ),
        );
      await insertChallenge('signup', 'whatsapp_inbound');
      await insertChallenge('reset', 'whatsapp_template');
      await expect(
        insertChallenge('hack', 'whatsapp_inbound'),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(insertChallenge('signup', 'sms')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });
  });
});
