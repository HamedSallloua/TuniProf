import type { Queryable } from '@/lib/db/transaction';
import { SESSION_TTL_MS } from './config';
import { randomToken, sha256 } from './crypto';
import type { Role } from './permissions';

// Server-side sessions: the browser holds a random token in an httpOnly cookie,
// the database holds only its SHA-256, so a database leak gives no usable session.

export type SessionUser = {
  id: string;
  role: Role;
  phone: string;
  email: string | null;
};

export async function createSession(
  db: Queryable,
  input: {
    userId: string;
    role: Role;
    ipHash: string | null;
    userAgent: string | null;
  },
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS[input.role]);
  await db.query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at, ip_hash, user_agent, created_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [
      input.userId,
      sha256(token),
      expiresAt,
      input.ipHash,
      input.userAgent?.slice(0, 300) ?? null,
      now,
    ],
  );
  await db.query('UPDATE users SET last_login_at = $2 WHERE id = $1', [
    input.userId,
    now,
  ]);
  return { token, expiresAt };
}

/** The user behind a cookie value, or null (unknown, expired, revoked, or not active). */
export async function getSessionUser(
  db: Queryable,
  token: string,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  const { rows } = await db.query<{
    id: string;
    role: Role;
    phone_e164: string;
    email: string | null;
  }>(
    `SELECT u.id, u.role, u.phone_e164, u.email
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
       AND u.status = 'active'`,
    [sha256(token), now],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    phone: row.phone_e164,
    email: row.email,
  };
}

export async function revokeSession(
  db: Queryable,
  token: string,
  now: Date = new Date(),
): Promise<void> {
  await db.query(
    'UPDATE auth_sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
    [sha256(token), now],
  );
}

export async function revokeAllSessions(
  db: Queryable,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.query(
    'UPDATE auth_sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
    [userId, now],
  );
}
