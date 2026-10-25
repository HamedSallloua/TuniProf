import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAdmin } from '@/lib/auth/admin';
import { SESSION_TTL_MS } from '@/lib/auth/config';
import { loginWithPassword } from '@/lib/auth/flows';
import { can } from '@/lib/auth/permissions';
import { getSessionUser } from '@/lib/auth/session';
import { runMigrations } from '@/db/migrate';
import {
  at,
  clearAuthTables,
  device,
  minutes,
  PHONE_A,
  PHONE_B,
  T0,
} from './auth-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';

describe.skipIf(!testDatabaseUrl)('admin accounts (database)', () => {
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

  it('creates an active, verified admin with an argon2id password', async () => {
    const result = await createAdmin(
      pool,
      {
        phone: PHONE_A,
        role: 'admin_super',
        password: 'a long admin password',
      },
      T0,
    );
    expect(result.ok).toBe(true);
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE phone_e164 = $1',
      [PHONE_A],
    );
    expect(rows[0]).toMatchObject({ role: 'admin_super', status: 'active' });
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].phone_verified_at).toEqual(T0);
  });

  it('never overwrites an existing account', async () => {
    await createAdmin(
      pool,
      {
        phone: PHONE_A,
        role: 'admin_super',
        password: 'a long admin password',
      },
      T0,
    );
    const again = await createAdmin(
      pool,
      {
        phone: PHONE_A,
        role: 'admin_support',
        password: 'another long password',
      },
      T0,
    );
    expect(again).toEqual({ ok: false, reason: 'phone_taken' });
    const { rows } = await pool.query(
      'SELECT role FROM users WHERE phone_e164 = $1',
      [PHONE_A],
    );
    expect(rows[0].role).toBe('admin_super');
  });

  it('signs in with the password, with a 12 hour session and the right rights', async () => {
    await createAdmin(
      pool,
      {
        phone: PHONE_A,
        role: 'admin_support',
        password: 'a long admin password',
      },
      T0,
    );
    await createAdmin(
      pool,
      {
        phone: PHONE_B,
        role: 'admin_super',
        password: 'a long admin password',
      },
      T0,
    );

    const support = await loginWithPassword(
      pool,
      {
        phone: PHONE_A,
        password: 'a long admin password',
        device: device(),
        userAgent: null,
      },
      at(minutes(1)),
    );
    expect(support.ok).toBe(true);
    if (!support.ok) return;
    expect(support.role).toBe('admin_support');
    expect(support.session.expiresAt.getTime() - at(minutes(1)).getTime()).toBe(
      SESSION_TTL_MS.admin_support,
    );

    const user = await getSessionUser(
      pool,
      support.session.token,
      at(minutes(2)),
    );
    expect(can(user!.role, 'admin:panel')).toBe(true);
    expect(can(user!.role, 'admin:settings')).toBe(false); // support cannot change prices or settings
    expect(can(user!.role, 'teacher:space')).toBe(false);

    const sup = await loginWithPassword(
      pool,
      {
        phone: PHONE_B,
        password: 'a long admin password',
        device: device('s'),
        userAgent: null,
      },
      at(minutes(1)),
    );
    if (!sup.ok) throw new Error('super admin login failed');
    const superUser = await getSessionUser(
      pool,
      sup.session.token,
      at(minutes(2)),
    );
    expect(can(superUser!.role, 'admin:settings')).toBe(true);
  });

  it('the database refuses an admin without a password', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (role, phone_e164, status, phone_verified_at)
         VALUES ('admin_super', '+21644123456', 'active', now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
