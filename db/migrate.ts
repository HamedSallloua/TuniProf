import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

// Any number works; it only has to be the same for every runner so that two
// runners (for example two terminals) never apply migrations at the same time.
const LOCK_ID = 727001;

const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Applies the .sql files of `dir` that have not been applied yet, in name order.
 * Each file runs in its own transaction: it fully succeeds or leaves nothing behind.
 * An already applied file must never be edited; create a new file instead.
 * Returns the names of the files applied by this call.
 */
export async function runMigrations(
  pool: Pool,
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const alreadyApplied = new Map(rows.map((row) => [row.name, row.checksum]));

    const files = (await readdir(dir))
      .filter((f) => FILE_PATTERN.test(f))
      .sort();
    const appliedNow: string[] = [];

    for (const file of files) {
      const sql = await readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');

      const previous = alreadyApplied.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${file} was edited after it was applied. Restore it and add a new migration file instead.`,
          );
        }
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
        appliedNow.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${file} failed: ${(error as Error).message}`,
        );
      }
    }

    return appliedNow;
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [LOCK_ID])
      .catch(() => {});
    client.release();
  }
}
