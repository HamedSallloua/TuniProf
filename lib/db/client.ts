import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getDatabaseUrl } from '@/lib/env';

// Next.js reloads modules in development; keeping the pool on globalThis
// avoids opening a new set of connections on every reload.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.pgPool) {
    const pool = new Pool({ connectionString: getDatabaseUrl(), max: 10 });
    // An idle connection can drop (database restart); without this the process would crash.
    pool.on('error', (error) => {
      console.error('PostgreSQL pool error:', error.message);
    });
    globalForDb.pgPool = pool;
  }
  return globalForDb.pgPool;
}

export function getDb() {
  return drizzle(getPool());
}
