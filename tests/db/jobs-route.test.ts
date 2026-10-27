import type { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as route from '@/app/api/jobs/daily/route';
import { runMigrations } from '@/db/migrate';
import { clearAuthTables } from './auth-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';
import { purchaseCode, atDays } from './billing-helpers';
import { createAdminUser, createTeacher } from './profile-helpers';
import { T0 } from './auth-helpers';

// The secured endpoint the host's cron calls once a day (spec 8.1).

const URL_JOB = 'http://localhost/api/jobs/daily';
const SECRET = 'a-cron-secret-of-enough-length';

const call = (authorization?: string) =>
  route.POST(
    new Request(URL_JOB, {
      method: 'POST',
      headers: authorization ? { authorization } : {},
    }),
  );

describe.skipIf(!testDatabaseUrl)('daily job endpoint (database)', () => {
  let pool: Pool;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    delete (globalThis as { pgPool?: Pool }).pgPool;
    pool = createTestPool();
    await runMigrations(pool);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await (globalThis as { pgPool?: Pool }).pgPool?.end();
    delete (globalThis as { pgPool?: Pool }).pgPool;
    await pool.end();
  });
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await clearAuthTables(pool);
  });

  it('is switched off while no CRON_SECRET is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer anything')).status).toBe(503);
  });

  it('refuses a missing, wrong or look-alike secret, and does nothing', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const admin = await createAdminUser(pool);
    const teacher = await createTeacher(pool);
    await purchaseCode(pool, admin, teacher, { plan: 'mensuel', now: T0 });
    await pool.query(`UPDATE activation_codes SET expires_at = '2000-01-01'`);

    for (const header of [
      undefined,
      '',
      'Bearer',
      'Bearer wrong',
      SECRET,
      `bearer ${SECRET}`,
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
    ]) {
      expect((await call(header)).status, String(header)).toBe(401);
    }
    const { rows } = await pool.query('SELECT status FROM activation_codes');
    expect(rows[0].status).toBe('issued'); // untouched
  });

  it('runs the tasks with the right secret, and again without harm', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const admin = await createAdminUser(pool);
    const teacher = await createTeacher(pool);
    await purchaseCode(pool, admin, teacher, { plan: 'mensuel', now: T0 });
    await pool.query(`UPDATE activation_codes SET expires_at = $1`, [
      atDays(-1),
    ]);

    const first = await call(`Bearer ${SECRET}`);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, codesExpired: 1 });
    const second = await call(`Bearer ${SECRET}`);
    expect(await second.json()).toEqual({ ok: true, codesExpired: 0 });
  });

  it('only answers to POST', async () => {
    expect('GET' in route).toBe(false);
  });
});
