import type { Pool, PoolClient } from 'pg';

// Anything we can run a query on: the pool, or one connection inside a transaction.
export type Queryable = Pick<Pool, 'query'>;

/** Runs `work` in a transaction: commits if it returns, rolls back if it throws. */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
