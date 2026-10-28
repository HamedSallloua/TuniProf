import type { Pool } from 'pg';
import {
  getEmailProvider,
  type EmailProvider,
} from '@/lib/notifications/email';
import {
  deliverPendingEmails,
  type EmailDelivery,
} from '@/lib/notifications/deliver';
import {
  cleanOldRows,
  queueExpiredNotices,
  queueExpiryReminders,
  queueGraceWarnings,
  type CleanupResult,
} from '@/lib/notifications/schedule';
import { expireStaleCodes } from './codes';

// The daily job (spec 8.1). It runs from a secured endpoint called by the host's cron
// (/api/jobs/daily) or from the command line (npm run job:daily).
//
// Visibility and Dashboard expiry need no job: they are read from the dates, so a profile
// leaves the results the moment visibility_until passes (teacher_is_visible), and the
// read-only period of the Dashboard is derived from dashboard_until (dashboardAccess).
// The job queues the messages around those dates, sends the e-mails, and cleans old rows.
//
// EVERY step is safe to run twice: messages carry a key made from what triggers them, and
// the cleanup only deletes what is old.
//
// Not here yet, because the tables do not exist yet: creating the monthly accounts (M10) and
// the 12-month retention of Dashboard data with its two deletion warnings (M10, once there is
// Dashboard data to delete). See docs/PRE_PRODUCTION_NOTES.md.

export type DailyJobResult = {
  codesExpired: number;
  remindersQueued: number;
  expiredNoticesQueued: number;
  graceWarningsQueued: number;
  emails: EmailDelivery;
  cleaned: CleanupResult;
};

export async function runDailyJob(
  pool: Pool,
  now: Date = new Date(),
  deps: { email?: EmailProvider | null } = {},
): Promise<DailyJobResult> {
  const email = deps.email === undefined ? getEmailProvider() : deps.email;

  const codesExpired = await expireStaleCodes(pool, now);
  const remindersQueued = await queueExpiryReminders(pool, now);
  const expiredNoticesQueued = await queueExpiredNotices(pool, now);
  const graceWarningsQueued = await queueGraceWarnings(pool, now);
  // After the queueing, so the e-mails of today go out today.
  const emails = await deliverPendingEmails(pool, email, now);
  const cleaned = await cleanOldRows(pool, now);

  return {
    codesExpired,
    remindersQueued,
    expiredNoticesQueued,
    graceWarningsQueued,
    emails,
    cleaned,
  };
}
