import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  completePasswordReset,
  completeSignUp,
  completeVisitorLogin,
  loginWithPassword,
  requestPasswordReset,
  signUpTeacher,
  startVisitorLogin,
} from '@/lib/auth/flows';
import { can } from '@/lib/auth/permissions';
import {
  createSession,
  getSessionUser,
  revokeAllSessions,
  revokeSession,
} from '@/lib/auth/session';
import { SESSION_TTL_MS } from '@/lib/auth/config';
import { runMigrations } from '@/db/migrate';
import {
  at,
  clearAuthTables,
  device,
  minutes,
  PHONE_A,
  PHONE_B,
  PHONE_C,
  T0,
  verifyChallenge,
} from './auth-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';

const PASSWORD = 'correct horse battery';
const HOUR = minutes(60);

describe.skipIf(!testDatabaseUrl)('account flows (database)', () => {
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

  const userRow = async (phone: string) =>
    (await pool.query('SELECT * FROM users WHERE phone_e164 = $1', [phone]))
      .rows[0];

  /** Full teacher sign-up, up to and including the first session. */
  async function registerTeacher(
    phone = PHONE_A,
    dev = device(),
    password = PASSWORD,
  ) {
    const signUp = await signUpTeacher(
      pool,
      { phone, password, email: null, device: dev },
      T0,
    );
    if (!signUp.ok) throw new Error(`sign-up failed: ${signUp.reason}`);
    await verifyChallenge(pool, signUp.challengeId, phone, at(minutes(1)));
    const done = await completeSignUp(
      pool,
      { challengeId: signUp.challengeId, device: dev, userAgent: 'test' },
      at(minutes(1)),
    );
    if (!done.ok) throw new Error(`complete failed: ${done.reason}`);
    return { challengeId: signUp.challengeId, session: done.session };
  }

  describe('teacher sign-up', () => {
    it('creates a pending account with timestamped consents and an argon2id hash', async () => {
      const result = await signUpTeacher(
        pool,
        {
          phone: PHONE_A,
          password: PASSWORD,
          email: 'prof@example.tn',
          device: device(),
        },
        T0,
      );
      expect(result.ok).toBe(true);

      const user = await userRow(PHONE_A);
      expect(user).toMatchObject({
        role: 'teacher',
        status: 'pending',
        phone_verified_at: null,
        email: 'prof@example.tn',
      });
      expect(user.password_hash).toMatch(/^\$argon2id\$/);
      expect(user.phone_display_consent_at).toEqual(T0);
      expect(user.terms_accepted_at).toEqual(T0);
    });

    it('activates the account only once WhatsApp proves the number, then logs in', async () => {
      const { session } = await registerTeacher();
      expect((await userRow(PHONE_A)).status).toBe('active');
      expect((await userRow(PHONE_A)).phone_verified_at).not.toBeNull();

      const user = await getSessionUser(pool, session.token, at(minutes(2)));
      expect(user).toMatchObject({ role: 'teacher', phone: PHONE_A });
    });

    it('cannot finish before the WhatsApp message, nor twice', async () => {
      const signUp = await signUpTeacher(
        pool,
        { phone: PHONE_A, password: PASSWORD, email: null, device: device() },
        T0,
      );
      if (!signUp.ok) throw new Error('setup');
      const finish = () =>
        completeSignUp(
          pool,
          {
            challengeId: signUp.challengeId,
            device: device(),
            userAgent: null,
          },
          at(minutes(1)),
        );

      expect(await finish()).toEqual({ ok: false, reason: 'not_verified' });
      await verifyChallenge(pool, signUp.challengeId, PHONE_A, at(minutes(1)));
      expect((await finish()).ok).toBe(true);
      expect(await finish()).toEqual({ ok: false, reason: 'invalid' });
    });

    it('another browser cannot finish someone else’s sign-up', async () => {
      const signUp = await signUpTeacher(
        pool,
        {
          phone: PHONE_A,
          password: PASSWORD,
          email: null,
          device: device('victim'),
        },
        T0,
      );
      if (!signUp.ok) throw new Error('setup');
      await verifyChallenge(pool, signUp.challengeId, PHONE_A, at(minutes(1)));
      expect(
        await completeSignUp(
          pool,
          {
            challengeId: signUp.challengeId,
            device: device('thief'),
            userAgent: null,
          },
          at(minutes(1)),
        ),
      ).toEqual({ ok: false, reason: 'invalid' });
    });

    it('refuses a number that already has an active account', async () => {
      await registerTeacher();
      expect(
        await signUpTeacher(
          pool,
          {
            phone: PHONE_A,
            password: 'another password',
            email: null,
            device: device('x'),
          },
          at(minutes(10)),
        ),
      ).toEqual({ ok: false, reason: 'phone_taken' });
    });

    it('lets a number whose sign-up was never verified sign up again, with the new password', async () => {
      await signUpTeacher(
        pool,
        {
          phone: PHONE_A,
          password: 'first attempt pass',
          email: null,
          device: device(),
        },
        T0,
      );
      await registerTeacher(PHONE_A, device(), 'second attempt pass');

      expect(
        (
          await loginWithPassword(
            pool,
            login(PHONE_A, 'second attempt pass'),
            at(minutes(5)),
          )
        ).ok,
      ).toBe(true);
      expect(
        (
          await loginWithPassword(
            pool,
            login(PHONE_A, 'first attempt pass'),
            at(minutes(5)),
          )
        ).ok,
      ).toBe(false);
    });
  });

  const login = (phone: string, password: string, dev = device()) => ({
    phone,
    password,
    device: dev,
    userAgent: 'test',
  });

  describe('login', () => {
    it('opens a session with the right password', async () => {
      await registerTeacher();
      const result = await loginWithPassword(
        pool,
        login(PHONE_A, PASSWORD),
        at(minutes(5)),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.role).toBe('teacher');
        expect(
          await getSessionUser(pool, result.session.token, at(minutes(6))),
        ).toMatchObject({
          phone: PHONE_A,
        });
      }
    });

    it('says the same thing for a wrong password and for an unknown number', async () => {
      await registerTeacher();
      const wrong = await loginWithPassword(
        pool,
        login(PHONE_A, 'wrong password'),
        at(minutes(5)),
      );
      const unknown = await loginWithPassword(
        pool,
        login(PHONE_C, PASSWORD),
        at(minutes(5)),
      );
      expect(wrong).toEqual({ ok: false, reason: 'invalid_credentials' });
      expect(unknown).toEqual({ ok: false, reason: 'invalid_credentials' });
    });

    it('asks to finish verification when the number was never verified', async () => {
      await signUpTeacher(
        pool,
        { phone: PHONE_A, password: PASSWORD, email: null, device: device() },
        T0,
      );
      const result = await loginWithPassword(
        pool,
        login(PHONE_A, PASSWORD),
        at(minutes(5)),
      );
      expect(result).toMatchObject({ ok: false, reason: 'not_verified' });
    });

    it('refuses a suspended account', async () => {
      await registerTeacher();
      await pool.query("UPDATE users SET status = 'suspended'");
      expect(
        await loginWithPassword(pool, login(PHONE_A, PASSWORD), at(minutes(5))),
      ).toEqual({
        ok: false,
        reason: 'suspended',
      });
    });

    it('blocks a number after 10 wrong passwords in an hour, even with the right one', async () => {
      await registerTeacher();
      for (let i = 0; i < 10; i++) {
        // a new device each time, so only the per-phone limit is reached
        await loginWithPassword(
          pool,
          login(PHONE_A, 'bad password', device(`d${i}`)),
          at(minutes(5)),
        );
      }
      const blocked = await loginWithPassword(
        pool,
        login(PHONE_A, PASSWORD, device('fresh')),
        at(minutes(6)),
      );
      expect(blocked).toMatchObject({ ok: false, reason: 'rate_limited' });

      // An hour after the first failure it works again.
      const later = await loginWithPassword(
        pool,
        login(PHONE_A, PASSWORD, device('fresh')),
        at(minutes(5) + HOUR + 1000),
      );
      expect(later.ok).toBe(true);
    });

    it('blocks a device after 20 wrong passwords, whatever the number', async () => {
      for (let i = 0; i < 20; i++) {
        await loginWithPassword(
          pool,
          login(`+2162234${1000 + i}`, 'bad password', device('one')),
          at(minutes(1)),
        );
      }
      expect(
        await loginWithPassword(
          pool,
          login(PHONE_B, 'bad password', device('one')),
          at(minutes(2)),
        ),
      ).toMatchObject({ ok: false, reason: 'rate_limited' });
    });
  });

  describe('password reset (same WhatsApp check)', () => {
    async function resetFlow(
      phone: string,
      newPassword: string,
      dev = device('r'),
    ) {
      const requested = await requestPasswordReset(
        pool,
        { phone, device: dev },
        at(minutes(10)),
      );
      if (!requested.ok) throw new Error('request failed');
      await verifyChallenge(
        pool,
        requested.challengeId,
        phone,
        at(minutes(11)),
      );
      return completePasswordReset(
        pool,
        { challengeId: requested.challengeId, device: dev, newPassword },
        at(minutes(11)),
      );
    }

    it('sets a new password after the WhatsApp check, and signs the old sessions out', async () => {
      const { session } = await registerTeacher();
      expect(await resetFlow(PHONE_A, 'brand new password')).toEqual({
        ok: true,
      });

      expect(
        (
          await loginWithPassword(
            pool,
            login(PHONE_A, 'brand new password'),
            at(minutes(12)),
          )
        ).ok,
      ).toBe(true);
      expect(
        (
          await loginWithPassword(
            pool,
            login(PHONE_A, PASSWORD),
            at(minutes(12)),
          )
        ).ok,
      ).toBe(false);
      expect(
        await getSessionUser(pool, session.token, at(minutes(12))),
      ).toBeNull();
    });

    it('cannot set a password before the number is verified', async () => {
      await registerTeacher();
      const requested = await requestPasswordReset(
        pool,
        { phone: PHONE_A, device: device('r') },
        at(minutes(10)),
      );
      if (!requested.ok) throw new Error('request failed');
      expect(
        await completePasswordReset(
          pool,
          {
            challengeId: requested.challengeId,
            device: device('r'),
            newPassword: 'sneaky password',
          },
          at(minutes(10)),
        ),
      ).toEqual({ ok: false, reason: 'not_verified' });
      expect(
        (
          await loginWithPassword(
            pool,
            login(PHONE_A, PASSWORD),
            at(minutes(12)),
          )
        ).ok,
      ).toBe(true);
    });

    it('does not reveal whether a number has an account: the start looks the same', async () => {
      const unknown = await requestPasswordReset(
        pool,
        { phone: PHONE_C, device: device('r') },
        T0,
      );
      expect(unknown.ok).toBe(true);
    });

    it('tells the person only after the number is proven that there is no account', async () => {
      expect(await resetFlow(PHONE_C, 'brand new password')).toEqual({
        ok: false,
        reason: 'no_account',
      });
      expect(await userRow(PHONE_C)).toBeUndefined();
    });

    it('finishes an unverified sign-up too', async () => {
      await signUpTeacher(
        pool,
        {
          phone: PHONE_A,
          password: 'forgotten password',
          email: null,
          device: device(),
        },
        T0,
      );
      expect(await resetFlow(PHONE_A, 'remembered password')).toEqual({
        ok: true,
      });
      expect((await userRow(PHONE_A)).status).toBe('active');
      expect(
        (
          await loginWithPassword(
            pool,
            login(PHONE_A, 'remembered password'),
            at(minutes(12)),
          )
        ).ok,
      ).toBe(true);
    });

    it('a reviewer account has no password to reset', async () => {
      await visitorSession(PHONE_B);
      expect(await resetFlow(PHONE_B, 'brand new password')).toEqual({
        ok: false,
        reason: 'no_account',
      });
      expect((await userRow(PHONE_B)).password_hash).toBeNull();
    });
  });

  async function visitorSession(phone: string, dev = device('v'), start = T0) {
    const started = await startVisitorLogin(
      pool,
      { phone, device: dev },
      start,
    );
    if (!started.ok) throw new Error(`start failed: ${started.reason}`);
    await verifyChallenge(
      pool,
      started.challengeId,
      phone,
      at(start.getTime() - T0.getTime() + minutes(1)),
    );
    const done = await completeVisitorLogin(
      pool,
      { challengeId: started.challengeId, device: dev, userAgent: 'test' },
      at(start.getTime() - T0.getTime() + minutes(1)),
    );
    if (!done.ok) throw new Error(`complete failed: ${done.reason}`);
    return done.session;
  }

  describe('reviewer (visitor) accounts: no password, WhatsApp for every session', () => {
    it('creates an active account with NULL password after the WhatsApp check', async () => {
      const session = await visitorSession(PHONE_B);
      expect(await userRow(PHONE_B)).toMatchObject({
        role: 'visitor',
        status: 'active',
        password_hash: null,
        phone_display_consent_at: null,
      });
      const user = await getSessionUser(pool, session.token, at(minutes(2)));
      expect(user?.role).toBe('visitor');
    });

    it('can only review: no teacher space, no admin panel', async () => {
      const session = await visitorSession(PHONE_B);
      const user = await getSessionUser(pool, session.token, at(minutes(2)));
      expect(can(user!.role, 'review:create')).toBe(true);
      expect(can(user!.role, 'teacher:space')).toBe(false);
      expect(can(user!.role, 'admin:panel')).toBe(false);
    });

    it('needs a fresh WhatsApp check for every new session', async () => {
      const first = await visitorSession(PHONE_B, device('v'), T0);
      // A second session on the same account: a new challenge is required; the old
      // verification cannot be reused.
      const started = await startVisitorLogin(
        pool,
        { phone: PHONE_B, device: device('v') },
        at(minutes(30)),
      );
      if (!started.ok) throw new Error('start failed');
      expect(
        await completeVisitorLogin(
          pool,
          {
            challengeId: started.challengeId,
            device: device('v'),
            userAgent: null,
          },
          at(minutes(30)),
        ),
      ).toEqual({ ok: false, reason: 'not_verified' });

      await verifyChallenge(
        pool,
        started.challengeId,
        PHONE_B,
        at(minutes(31)),
      );
      const second = await completeVisitorLogin(
        pool,
        {
          challengeId: started.challengeId,
          device: device('v'),
          userAgent: null,
        },
        at(minutes(31)),
      );
      expect(second.ok).toBe(true);
      expect(first.token).not.toBe(second.ok ? second.session.token : '');
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM users WHERE role = 'visitor'",
          )
        ).rows[0].n,
      ).toBe(1);
    });

    it('sessions are short: 24 hours', async () => {
      const session = await visitorSession(PHONE_B);
      expect(session.expiresAt.getTime() - at(minutes(1)).getTime()).toBe(
        SESSION_TTL_MS.visitor,
      );
      expect(
        await getSessionUser(
          pool,
          session.token,
          at(minutes(1) + SESSION_TTL_MS.visitor - 1000),
        ),
      ).not.toBeNull();
      expect(
        await getSessionUser(
          pool,
          session.token,
          at(minutes(1) + SESSION_TTL_MS.visitor + 1000),
        ),
      ).toBeNull();
    });

    it('cannot sign in with a password, even an empty or guessed one', async () => {
      await visitorSession(PHONE_B);
      for (const password of ['', 'password', PASSWORD]) {
        const result = await loginWithPassword(
          pool,
          login(PHONE_B, password, device(`g${password.length}`)),
          at(minutes(5)),
        );
        expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
      }
    });

    it('a number that belongs to a teacher cannot become a reviewer', async () => {
      await registerTeacher(PHONE_A);
      expect(
        await startVisitorLogin(
          pool,
          { phone: PHONE_A, device: device('v') },
          at(minutes(10)),
        ),
      ).toEqual({
        ok: false,
        reason: 'account_exists',
      });
    });

    it('a suspended reviewer cannot sign in', async () => {
      await visitorSession(PHONE_B);
      await pool.query("UPDATE users SET status = 'suspended'");
      expect(
        await startVisitorLogin(
          pool,
          { phone: PHONE_B, device: device('v') },
          at(minutes(10)),
        ),
      ).toEqual({
        ok: false,
        reason: 'suspended',
      });
    });
  });

  describe('sessions', () => {
    async function makeUser() {
      await registerTeacher();
      return (await userRow(PHONE_A)).id as string;
    }

    it('store only a hash of the cookie value', async () => {
      const id = await makeUser();
      const { token } = await createSession(
        pool,
        { userId: id, role: 'teacher', ipHash: null, userAgent: 'ua' },
        T0,
      );
      const { rows } = await pool.query(
        'SELECT token_hash FROM auth_sessions WHERE token_hash IS NOT NULL',
      );
      expect(
        rows.every(
          (r) => r.token_hash !== token && !r.token_hash.includes(token),
        ),
      ).toBe(true);
    });

    it('last 30 days for a teacher and 12 hours for an admin', async () => {
      const id = await makeUser();
      const teacher = await createSession(
        pool,
        { userId: id, role: 'teacher', ipHash: null, userAgent: null },
        T0,
      );
      const admin = await createSession(
        pool,
        { userId: id, role: 'admin_super', ipHash: null, userAgent: null },
        T0,
      );
      expect(teacher.expiresAt.getTime() - T0.getTime()).toBe(30 * 24 * HOUR);
      expect(admin.expiresAt.getTime() - T0.getTime()).toBe(12 * HOUR);
    });

    it('stop working when expired, revoked, or when the account is suspended', async () => {
      const id = await makeUser();
      const mk = () =>
        createSession(
          pool,
          { userId: id, role: 'teacher', ipHash: null, userAgent: null },
          T0,
        );

      const expired = await mk();
      expect(
        await getSessionUser(pool, expired.token, at(31 * 24 * HOUR)),
      ).toBeNull();

      const revoked = await mk();
      await revokeSession(pool, revoked.token, at(minutes(1)));
      expect(
        await getSessionUser(pool, revoked.token, at(minutes(2))),
      ).toBeNull();

      const all = await mk();
      const other = await mk();
      await revokeAllSessions(pool, id, at(minutes(1)));
      expect(await getSessionUser(pool, all.token, at(minutes(2)))).toBeNull();
      expect(
        await getSessionUser(pool, other.token, at(minutes(2))),
      ).toBeNull();

      const live = await mk();
      expect(
        await getSessionUser(pool, live.token, at(minutes(2))),
      ).not.toBeNull();
      await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [
        id,
      ]);
      expect(await getSessionUser(pool, live.token, at(minutes(3)))).toBeNull();
    });

    it('an unknown or empty cookie value finds nobody', async () => {
      expect(await getSessionUser(pool, 'nope', T0)).toBeNull();
      expect(await getSessionUser(pool, '', T0)).toBeNull();
    });
  });
});
