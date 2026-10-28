import type { Queryable } from '@/lib/db/transaction';
import {
  CHANNELS_BY_KIND,
  type NotificationKind,
  type NotificationParams,
} from './kinds';

// Putting messages in the queue. Called inside the transaction of the thing that happened
// (an approval, a payment decision...), so a message exists if and only if the event does.

/**
 * Queues the message on every channel of its kind. E-mail only when the person gave an
 * address. The same `dedupeKey` for the same person and channel is queued once, so calling
 * this twice (a job run twice, a repeated click) never sends two messages.
 * Returns how many rows were really created.
 */
export async function enqueueNotification(
  db: Queryable,
  input: {
    userId: string;
    kind: NotificationKind;
    dedupeKey: string;
    params?: NotificationParams;
  },
): Promise<number> {
  const { rows } = await db.query<{
    email: string | null;
    full_name: string | null;
  }>(
    `SELECT u.email, p.full_name
       FROM users u LEFT JOIN teacher_profiles p ON p.user_id = u.id
      WHERE u.id = $1`,
    [input.userId],
  );
  if (!rows[0]) return 0;

  const channels = CHANNELS_BY_KIND[input.kind].filter(
    (channel) => channel !== 'email' || rows[0].email,
  );
  // The name is stored with the message so that it reads the same later, whatever happens
  // to the profile.
  const params = { name: rows[0].full_name, ...input.params };

  let created = 0;
  for (const channel of channels) {
    const result = await db.query(
      `INSERT INTO notifications (user_id, kind, channel, params, dedupe_key)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (user_id, channel, dedupe_key) DO NOTHING`,
      [
        input.userId,
        input.kind,
        channel,
        JSON.stringify(params),
        input.dedupeKey,
      ],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}
