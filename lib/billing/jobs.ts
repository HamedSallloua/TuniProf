import type { Pool } from 'pg';
import { expireStaleCodes } from './codes';

// The daily job (spec 8.1). It runs from a secured endpoint called by the host's cron
// (/api/jobs/daily) or from the command line (npm run job:daily).
//
// Visibility and Dashboard expiry need no job: they are read from the dates, so a profile
// leaves the results the moment visibility_until passes (teacher_is_visible).
// Reminders at 30, 7 and 1 day and the grace-period and retention steps need the message
// queue and come with M7. Every task here must be safe to run twice.

export type DailyJobResult = { codesExpired: number };

export async function runDailyJob(
  pool: Pool,
  now: Date = new Date(),
): Promise<DailyJobResult> {
  return { codesExpired: await expireStaleCodes(pool, now) };
}
