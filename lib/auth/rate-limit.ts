import type { Queryable } from '@/lib/db/transaction';

export type LimitCheck = {
  bucket: string; // what is counted, e.g. "challenge:phone"
  key: string; // who: a phone number, a device hash, an address hash
  limit: number; // events allowed in the window
};

export type LimitResult =
  { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Sliding window: the request is allowed when, for every check, fewer than `limit`
 * events were recorded in the last `windowMs`. Does not record anything.
 */
export async function checkLimits(
  db: Queryable,
  windowMs: number,
  checks: LimitCheck[],
  now: Date = new Date(),
): Promise<LimitResult> {
  const since = new Date(now.getTime() - windowMs);
  let retryAfterMs = 0;

  for (const check of checks) {
    const { rows } = await db.query<{ created_at: Date }>(
      `SELECT created_at FROM rate_limit_events
       WHERE bucket = $1 AND key = $2 AND created_at > $3
       ORDER BY created_at DESC LIMIT $4`,
      [check.bucket, check.key, since, check.limit],
    );
    if (rows.length >= check.limit) {
      // Allowed again when the oldest of the counted events leaves the window.
      const oldest = rows[rows.length - 1].created_at.getTime();
      retryAfterMs = Math.max(retryAfterMs, oldest + windowMs - now.getTime());
    }
  }

  return retryAfterMs > 0
    ? { allowed: false, retryAfterMs }
    : { allowed: true };
}

/** Records one event for each (bucket, key) pair. */
export async function recordEvents(
  db: Queryable,
  events: Pick<LimitCheck, 'bucket' | 'key'>[],
  now: Date = new Date(),
): Promise<void> {
  if (events.length === 0) return;
  await db.query(
    `INSERT INTO rate_limit_events (bucket, key, created_at)
     SELECT b, k, $3 FROM unnest($1::text[], $2::text[]) AS e(b, k)`,
    [events.map((e) => e.bucket), events.map((e) => e.key), now],
  );
}
