import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';

// These tests need the test database (TEST_DATABASE_URL). In CI it always exists.
// On a machine without it they are skipped, and the skip is visible in the report.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('database migrations', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates the three required extensions', async () => {
    await runMigrations(pool);
    const { rows } = await pool.query<{ extname: string }>(
      'SELECT extname FROM pg_extension',
    );
    const names = rows.map((row) => row.extname);
    expect(names).toEqual(
      expect.arrayContaining(['pgcrypto', 'btree_gist', 'pg_trgm']),
    );
  });

  it('is idempotent: a second run applies nothing', async () => {
    await runMigrations(pool);
    expect(await runMigrations(pool)).toEqual([]);
  });

  it('leaves nothing behind when a migration fails', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tuniprof-mig-'));
    try {
      await writeFile(
        path.join(dir, '9999_broken.sql'),
        'CREATE TABLE should_not_exist (id int); SELECT 1/0;',
      );
      await expect(runMigrations(pool, dir)).rejects.toThrow(
        /9999_broken\.sql failed/,
      );
      const { rows } = await pool.query(
        "SELECT to_regclass('public.should_not_exist') AS found",
      );
      expect(rows[0].found).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
