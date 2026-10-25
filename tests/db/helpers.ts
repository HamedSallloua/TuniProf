import { Pool } from 'pg';

// Database tests need the test database (TEST_DATABASE_URL). In CI it always exists.
// Without it the tests are skipped, and the skip is visible in the report.
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export function createTestPool(): Pool {
  return new Pool({ connectionString: testDatabaseUrl });
}

/**
 * Runs `work` inside a transaction that is always rolled back, so a test can
 * insert or break things without leaving anything in the database.
 */
export async function withRollback<T>(
  pool: Pool,
  work: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

// PostgreSQL error codes (SQLSTATE). Tests check these, never the message text,
// because the server may answer in French or any other language.
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';
export const CHECK_VIOLATION = '23514';
