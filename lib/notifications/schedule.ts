import type { Pool } from 'pg';
import { DAY_MS, GRACE_DAYS } from '@/lib/billing/entitlements';
import { withTransaction } from '@/lib/db/transaction';
import { enqueueNotification } from './queue';

// What the daily job queues (spec 9, AGENT_CONTEXT M7). Each message has a key made from the
// thing that triggers it (the end date of the plan, for example), so running the job twice,
// or after a missed day, never queues the same message twice. A renewal changes the end date,
// so the next term gets its own reminders.

/** Reminders go out 30, 7 and 1 day before the plan ends (spec 9, owner's M7 list). */
export const REMINDER_DAYS = [30, 7, 1] as const;

/** The grace-period warning goes out this many days before the read-only access ends. */
export const GRACE_WARNING_DAYS = 7;

/**
 * Which reminder is due when `msLeft` milliseconds remain: the smallest threshold that is
 * still at least the days left. 20 days left gives 30, 5 days give 7, 1 day gives 1. Only one
 * is due at a time, so a teacher who joins late or a job that missed a day does not receive
 * three messages at once. Null when more than 30 days remain or the plan has ended.
 */
export function dueReminder(msLeft: number): 30 | 7 | 1 | null {
  if (msLeft <= 0) return null;
  const days = Math.ceil(msLeft / DAY_MS);
  return (
    REMINDER_DAYS.slice()
      .reverse()
      .find((threshold) => days <= threshold) ?? null
  );
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

type Teacher = {
  teacher_id: string;
  visibility_until: Date | null;
  dashboard_until: Date | null;
};

/** Teachers whose profile was approved: only they ever had a visible profile to lose. */
async function approvedTeachers(pool: Pool, where: string, params: unknown[]) {
  const { rows } = await pool.query<Teacher>(
    `SELECT e.teacher_id, e.visibility_until, e.dashboard_until
       FROM entitlements e
       JOIN teacher_profiles p ON p.user_id = e.teacher_id AND p.status IN ('approved', 'suspended')
       JOIN users u ON u.id = e.teacher_id AND u.status = 'active'
      WHERE ${where}`,
    params,
  );
  return rows;
}

/** "Votre abonnement se termine dans N jours" at 30, 7 and 1 day. */
export async function queueExpiryReminders(
  pool: Pool,
  now: Date,
): Promise<number> {
  const horizon = new Date(now.getTime() + REMINDER_DAYS[0] * DAY_MS);
  const teachers = await approvedTeachers(
    pool,
    'e.visibility_until > $1 AND e.visibility_until <= $2',
    [now, horizon],
  );
  let created = 0;
  for (const teacher of teachers) {
    const until = teacher.visibility_until!;
    const days = dueReminder(until.getTime() - now.getTime());
    if (!days) continue;
    created += await withTransaction(pool, (client) =>
      enqueueNotification(client, {
        userId: teacher.teacher_id,
        kind: 'plan_expiring',
        dedupeKey: `plan_expiring:${days}:${dayKey(until)}`,
        params: { days, date: until.toISOString() },
      }),
    );
  }
  return created;
}

/** "Votre abonnement est terminé", once, for plans that ended in the last 30 days. */
export async function queueExpiredNotices(
  pool: Pool,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const teachers = await approvedTeachers(
    pool,
    'e.visibility_until <= $1 AND e.visibility_until > $2',
    [now, since],
  );
  let created = 0;
  for (const teacher of teachers) {
    const until = teacher.visibility_until!;
    created += await withTransaction(pool, (client) =>
      enqueueNotification(client, {
        userId: teacher.teacher_id,
        kind: 'plan_expired',
        dedupeKey: `plan_expired:${dayKey(until)}`,
        params: { date: until.toISOString() },
      }),
    );
  }
  return created;
}

/**
 * "Fin de l'accès à votre Dashboard": the Dashboard ended and its 30-day read-only access
 * (with export) is about to end too. Once per Dashboard term.
 */
export async function queueGraceWarnings(
  pool: Pool,
  now: Date,
): Promise<number> {
  const teachers = await approvedTeachers(
    pool,
    // ended, and the grace ends within GRACE_WARNING_DAYS from now
    `e.dashboard_until <= $1
       AND e.dashboard_until + ($2 || ' days')::interval > $1
       AND e.dashboard_until + ($2 || ' days')::interval <= $1::timestamptz + ($3 || ' days')::interval`,
    [now, String(GRACE_DAYS), String(GRACE_WARNING_DAYS)],
  );
  let created = 0;
  for (const teacher of teachers) {
    const dashboardUntil = teacher.dashboard_until!;
    const graceEnd = new Date(dashboardUntil.getTime() + GRACE_DAYS * DAY_MS);
    created += await withTransaction(pool, (client) =>
      enqueueNotification(client, {
        userId: teacher.teacher_id,
        kind: 'grace_ending',
        dedupeKey: `grace_ending:${dayKey(dashboardUntil)}`,
        params: { date: graceEnd.toISOString() },
      }),
    );
  }
  return created;
}

// ----------------------------------------------------------------------------- cleanup

export type CleanupResult = {
  rateLimitEvents: number;
  webhookEvents: number;
  verificationChallenges: number;
  sessions: number;
  notifications: number;
};

// How long finished rows are kept. These are my choices (the spec only says to clean up).
const KEEP = {
  rateLimitDays: 2, // the longest limit window is 1 hour
  webhookDays: 30, // Meta retries a message for a few days at most
  challengeDays: 30,
  sessionDays: 30,
  notificationMonths: 12, // read or sent messages, as the 12-month retention of spec 2.5
} as const;

/**
 * Deletes what nothing needs any more: counters of expired rate limits, old webhook message
 * ids, finished verification challenges and sessions, and old read or sent notifications.
 */
export async function cleanOldRows(
  pool: Pool,
  now: Date,
): Promise<CleanupResult> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const run = async (sql: string, cutoff: Date) =>
    (await pool.query(sql, [cutoff])).rowCount ?? 0;

  return {
    rateLimitEvents: await run(
      'DELETE FROM rate_limit_events WHERE created_at < $1',
      ago(KEEP.rateLimitDays),
    ),
    webhookEvents: await run(
      'DELETE FROM webhook_events WHERE received_at < $1',
      ago(KEEP.webhookDays),
    ),
    verificationChallenges: await run(
      'DELETE FROM otp_challenges WHERE expires_at < $1',
      ago(KEEP.challengeDays),
    ),
    sessions: await run(
      'DELETE FROM auth_sessions WHERE expires_at < $1 OR revoked_at < $1',
      ago(KEEP.sessionDays),
    ),
    notifications: await run(
      `DELETE FROM notifications WHERE status IN ('sent', 'read') AND created_at < $1`,
      ago(KEEP.notificationMonths * 30),
    ),
  };
}
