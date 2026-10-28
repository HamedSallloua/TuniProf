import type { Pool } from 'pg';
import { isActiveAdmin } from '@/lib/auth/admin';
import type { Queryable } from '@/lib/db/transaction';
import type { EmailProvider } from './email';
import type { NotificationKind, NotificationParams } from './kinds';
import { renderMessage } from './render';

// Reading and delivering the queue: on-site notices (read by the teacher), WhatsApp messages
// (copied and sent by an admin), e-mails (sent by the daily job).

export const MAX_EMAIL_ATTEMPTS = 3;

// ----------------------------------------------------------------------- on-site notices

export type SiteNotice = {
  id: string;
  kind: NotificationKind;
  params: NotificationParams;
  createdAt: Date;
};

export async function listSiteNotices(
  db: Queryable,
  userId: string,
  limit = 10,
): Promise<SiteNotice[]> {
  const { rows } = await db.query(
    `SELECT id, kind, params, created_at FROM notifications
      WHERE user_id = $1 AND channel = 'site' AND status = 'pending'
      ORDER BY created_at DESC, id LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    params: r.params,
    createdAt: r.created_at,
  }));
}

/** The teacher dismisses one of their own notices. Never someone else's. */
export async function markSiteNoticeRead(
  pool: Pool,
  userId: string,
  notificationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET status = 'read', read_at = $3
      WHERE id = $1 AND user_id = $2 AND channel = 'site' AND status = 'pending'`,
    [notificationId, userId, now],
  );
  return rowCount === 1;
}

// --------------------------------------------------------------------- WhatsApp by hand

export type PendingWhatsApp = {
  id: string;
  kind: NotificationKind;
  params: NotificationParams;
  createdAt: Date;
  phone: string;
  /** The message in both languages, ready to copy. */
  textFr: string;
  textAr: string;
};

export async function listPendingWhatsApp(
  db: Queryable,
  limit = 100,
): Promise<PendingWhatsApp[]> {
  const { rows } = await db.query(
    `SELECT n.id, n.kind, n.params, n.created_at, u.phone_e164
       FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.channel = 'whatsapp' AND n.status = 'pending'
      ORDER BY n.created_at, n.id LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    params: r.params,
    createdAt: r.created_at,
    phone: r.phone_e164,
    textFr: renderMessage(r.kind, r.params, 'fr').text,
    textAr: renderMessage(r.kind, r.params, 'ar').text,
  }));
}

export async function countPendingWhatsApp(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications
      WHERE channel = 'whatsapp' AND status = 'pending'`,
  );
  return rows[0].n;
}

/** An admin sent the message from the WhatsApp Business app. Checked in the database. */
export async function markWhatsAppSent(
  pool: Pool,
  adminId: string,
  notificationId: string,
  now: Date = new Date(),
): Promise<'ok' | 'forbidden' | 'not_found'> {
  if (!(await isActiveAdmin(pool, adminId))) return 'forbidden';
  const { rowCount } = await pool.query(
    `UPDATE notifications SET status = 'sent', sent_at = $3, handled_by = $2
      WHERE id = $1 AND channel = 'whatsapp' AND status = 'pending'`,
    [notificationId, adminId, now],
  );
  return rowCount === 1 ? 'ok' : 'not_found';
}

// ----------------------------------------------------------------------------- e-mail

export type EmailDelivery = { sent: number; failed: number; waiting: number };

/**
 * Sends the queued e-mails, oldest first. Without a provider they stay queued. A message that
 * fails is tried again on the next run, up to 3 times, then marked failed. Two runs at the same
 * time never take the same message (rows are claimed first).
 */
export async function deliverPendingEmails(
  pool: Pool,
  provider: EmailProvider | null,
  now: Date = new Date(),
  batch = 50,
): Promise<EmailDelivery> {
  if (!provider) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
        WHERE channel = 'email' AND status = 'pending'`,
    );
    return { sent: 0, failed: 0, waiting: rows[0].n };
  }

  const claimed = await pool.query<{
    id: string;
    kind: NotificationKind;
    params: NotificationParams;
    email: string;
    attempts: number;
  }>(
    `UPDATE notifications n SET attempts = n.attempts + 1
      FROM (SELECT id FROM notifications
             WHERE channel = 'email' AND status = 'pending' AND attempts < $1
             ORDER BY created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED) c, users u
     WHERE n.id = c.id AND u.id = n.user_id AND u.email IS NOT NULL
     RETURNING n.id, n.kind, n.params, u.email, n.attempts`,
    [MAX_EMAIL_ATTEMPTS, batch],
  );

  let sent = 0;
  let failed = 0;
  for (const row of claimed.rows) {
    // French first, then Arabic: the teacher's language is not stored.
    const fr = renderMessage(row.kind, row.params, 'fr');
    const ar = renderMessage(row.kind, row.params, 'ar');
    try {
      await provider.send({
        to: row.email,
        subject: `${fr.subject} | ${ar.subject}`,
        text: `${fr.text}\n\n----------\n\n${ar.text}`,
      });
      await pool.query(
        `UPDATE notifications SET status = 'sent', sent_at = $2, last_error = NULL WHERE id = $1`,
        [row.id, now],
      );
      sent += 1;
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 500);
      const giveUp = row.attempts >= MAX_EMAIL_ATTEMPTS;
      await pool.query(
        `UPDATE notifications SET last_error = $2, status = $3 WHERE id = $1`,
        [row.id, message, giveUp ? 'failed' : 'pending'],
      );
      if (giveUp) failed += 1;
    }
  }

  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications
      WHERE channel = 'email' AND status = 'pending'`,
  );
  return { sent, failed, waiting: rows[0].n };
}
