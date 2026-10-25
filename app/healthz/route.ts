import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

// Used by uptime monitors and the host. Returns 200 when the site and database
// answer, 503 when the database does not. Never exposes details.
export async function GET() {
  let database: 'ok' | 'down' = 'ok';
  try {
    await getPool().query('SELECT 1');
  } catch (error) {
    database = 'down';
    console.error('healthz: database check failed:', (error as Error).message);
  }

  return NextResponse.json(
    {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      time: new Date().toISOString(),
    },
    {
      status: database === 'ok' ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
