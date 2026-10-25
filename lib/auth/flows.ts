import type { Pool } from 'pg';
import { withTransaction } from '@/lib/db/transaction';
import { RATE_LIMITS } from './config';
import { checkLimits, recordEvents } from './rate-limit';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import type { Role } from './permissions';
import { createSession, revokeAllSessions } from './session';
import {
  consumeChallenge,
  startChallenge,
  type DeviceContext,
  type StartResult,
} from './verification';

// The account flows, without any web code: they take a database pool and plain values,
// so they are tested directly. Pages and server actions only call these.

type Session = { token: string; expiresAt: Date };

// ----------------------------------------------------------------- teacher sign-up

export type SignUpResult =
  | { ok: true; challengeId: string }
  | { ok: false; reason: 'phone_taken' }
  | Extract<StartResult, { ok: false }>;

/**
 * Creates a pending teacher account and starts the WhatsApp verification.
 * A number whose earlier sign-up was never verified can sign up again (the unverified
 * row is replaced). A number with an active account cannot.
 */
export async function signUpTeacher(
  pool: Pool,
  input: {
    phone: string;
    password: string;
    email: string | null;
    device: DeviceContext;
  },
  now: Date = new Date(),
): Promise<SignUpResult> {
  const passwordHash = await hashPassword(input.password);

  const userId = await withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM users WHERE phone_e164 = $1 FOR UPDATE',
      [input.phone],
    );
    const existing = rows[0];
    if (existing && existing.status !== 'pending') return null;

    if (existing) {
      await client.query(
        `UPDATE users SET role = 'teacher', password_hash = $2, email = $3,
           phone_display_consent_at = $4, terms_accepted_at = $4
         WHERE id = $1`,
        [existing.id, passwordHash, input.email, now],
      );
      return existing.id;
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO users (role, phone_e164, email, password_hash, phone_display_consent_at, terms_accepted_at)
       VALUES ('teacher', $1, $2, $3, $4, $4) RETURNING id`,
      [input.phone, input.email, passwordHash, now],
    );
    return created.rows[0].id;
  });
  if (!userId) return { ok: false, reason: 'phone_taken' };

  const started = await startChallenge(
    pool,
    { phone: input.phone, purpose: 'signup', userId, device: input.device },
    now,
  );
  return started.ok ? { ok: true, challengeId: started.challengeId } : started;
}

/** After the WhatsApp check: logs the new teacher in. */
export async function completeSignUp(
  pool: Pool,
  input: {
    challengeId: string;
    device: DeviceContext;
    userAgent: string | null;
  },
  now: Date = new Date(),
): Promise<
  | { ok: true; session: Session }
  | { ok: false; reason: 'not_verified' | 'invalid' }
> {
  return withTransaction(pool, async (client) => {
    const consumed = await consumeChallenge(
      client,
      {
        challengeId: input.challengeId,
        deviceHash: input.device.deviceHash,
        purpose: 'signup',
      },
      now,
    );
    if (!consumed.ok) {
      return {
        ok: false,
        reason: consumed.reason === 'not_verified' ? 'not_verified' : 'invalid',
      } as const;
    }
    const { rows } = await client.query<{
      id: string;
      role: Role;
      status: string;
    }>('SELECT id, role, status FROM users WHERE id = $1', [consumed.userId]);
    const user = rows[0];
    if (!user || user.status !== 'active')
      return { ok: false, reason: 'invalid' } as const;

    const session = await createSession(
      client,
      {
        userId: user.id,
        role: user.role,
        ipHash: input.device.ipHash,
        userAgent: input.userAgent,
      },
      now,
    );
    return { ok: true, session } as const;
  });
}

// ------------------------------------------------------------------------- login

export type LoginResult =
  | { ok: true; session: Session; role: Role }
  | { ok: false; reason: 'invalid_credentials' | 'suspended' }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number }
  // Right password, but the phone was never verified: the caller restarts verification.
  | { ok: false; reason: 'not_verified'; userId: string };

export async function loginWithPassword(
  pool: Pool,
  input: {
    phone: string;
    password: string;
    device: DeviceContext;
    userAgent: string | null;
  },
  now: Date = new Date(),
): Promise<LoginResult> {
  const limits = RATE_LIMITS.loginFailure;
  const checks = [
    { bucket: 'login_failure:phone', key: input.phone, limit: limits.perPhone },
    {
      bucket: 'login_failure:device',
      key: input.device.deviceHash,
      limit: limits.perDevice,
    },
    ...(input.device.ipHash
      ? [
          {
            bucket: 'login_failure:ip',
            key: input.device.ipHash,
            limit: limits.perIp,
          },
        ]
      : []),
  ];
  const allowed = await checkLimits(pool, limits.windowMs, checks, now);
  if (!allowed.allowed) {
    return {
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: allowed.retryAfterMs,
    };
  }

  const { rows } = await pool.query<{
    id: string;
    role: Role;
    password_hash: string | null;
    status: 'pending' | 'active' | 'suspended';
  }>(
    'SELECT id, role, password_hash, status FROM users WHERE phone_e164 = $1',
    [input.phone],
  );
  const user = rows[0];

  // Same work whether or not the account exists, so timing reveals nothing.
  const passwordOk = user?.password_hash
    ? await verifyPassword(user.password_hash, input.password)
    : await verifyAgainstDummy(input.password);

  if (!user || !passwordOk) {
    await recordEvents(
      pool,
      checks.map(({ bucket, key }) => ({ bucket, key })),
      now,
    );
    return { ok: false, reason: 'invalid_credentials' };
  }
  if (user.status === 'suspended') return { ok: false, reason: 'suspended' };
  if (user.status === 'pending')
    return { ok: false, reason: 'not_verified', userId: user.id };

  const session = await createSession(
    pool,
    {
      userId: user.id,
      role: user.role,
      ipHash: input.device.ipHash,
      userAgent: input.userAgent,
    },
    now,
  );
  return { ok: true, session, role: user.role };
}

// ------------------------------------------------------------------ password reset

/**
 * Starts a password reset. The answer never says whether the number has an account:
 * the person only learns that at the end, after proving they own the number.
 */
export async function requestPasswordReset(
  pool: Pool,
  input: { phone: string; device: DeviceContext },
  now: Date = new Date(),
): Promise<StartResult> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users
     WHERE phone_e164 = $1 AND password_hash IS NOT NULL AND status <> 'suspended'`,
    [input.phone],
  );
  return startChallenge(
    pool,
    {
      phone: input.phone,
      purpose: 'reset',
      userId: rows[0]?.id ?? null,
      device: input.device,
    },
    now,
  );
}

export async function completePasswordReset(
  pool: Pool,
  input: { challengeId: string; device: DeviceContext; newPassword: string },
  now: Date = new Date(),
): Promise<
  | { ok: true }
  | { ok: false; reason: 'not_verified' | 'invalid' | 'no_account' }
> {
  const passwordHash = await hashPassword(input.newPassword);

  return withTransaction(pool, async (client) => {
    const consumed = await consumeChallenge(
      client,
      {
        challengeId: input.challengeId,
        deviceHash: input.device.deviceHash,
        purpose: 'reset',
      },
      now,
    );
    if (!consumed.ok) {
      return {
        ok: false,
        reason: consumed.reason === 'not_verified' ? 'not_verified' : 'invalid',
      } as const;
    }
    if (!consumed.userId) return { ok: false, reason: 'no_account' } as const;

    // Proving the number also finishes an unverified sign-up.
    await client.query(
      `UPDATE users SET password_hash = $2,
         phone_verified_at = COALESCE(phone_verified_at, $3),
         status = CASE WHEN status = 'pending' THEN 'active' ELSE status END
       WHERE id = $1`,
      [consumed.userId, passwordHash, now],
    );
    // Whoever had the old password is signed out everywhere.
    await revokeAllSessions(client, consumed.userId, now);
    return { ok: true } as const;
  });
}

// ------------------------------------------------- reviewer (visitor) login: no password

export type VisitorStartResult =
  | { ok: true; challengeId: string }
  | { ok: false; reason: 'account_exists' | 'suspended' }
  | Extract<StartResult, { ok: false }>;

export async function startVisitorLogin(
  pool: Pool,
  input: { phone: string; device: DeviceContext },
  now: Date = new Date(),
): Promise<VisitorStartResult> {
  const { rows } = await pool.query<{ id: string; role: Role; status: string }>(
    'SELECT id, role, status FROM users WHERE phone_e164 = $1',
    [input.phone],
  );
  const user = rows[0];
  // One number, one role: a teacher or admin number signs in with its password.
  if (user && user.role !== 'visitor')
    return { ok: false, reason: 'account_exists' };
  if (user?.status === 'suspended') return { ok: false, reason: 'suspended' };

  const started = await startChallenge(
    pool,
    {
      phone: input.phone,
      purpose: 'visitor_login',
      userId: user?.id ?? null,
      device: input.device,
    },
    now,
  );
  return started.ok ? { ok: true, challengeId: started.challengeId } : started;
}

/** After the WhatsApp check: creates the reviewer account if new, and a short session. */
export async function completeVisitorLogin(
  pool: Pool,
  input: {
    challengeId: string;
    device: DeviceContext;
    userAgent: string | null;
  },
  now: Date = new Date(),
): Promise<
  | { ok: true; session: Session }
  | {
      ok: false;
      reason: 'not_verified' | 'invalid' | 'account_exists' | 'suspended';
    }
> {
  return withTransaction(pool, async (client) => {
    const consumed = await consumeChallenge(
      client,
      {
        challengeId: input.challengeId,
        deviceHash: input.device.deviceHash,
        purpose: 'visitor_login',
      },
      now,
    );
    if (!consumed.ok) {
      return {
        ok: false,
        reason: consumed.reason === 'not_verified' ? 'not_verified' : 'invalid',
      } as const;
    }

    await client.query(
      `INSERT INTO users (role, phone_e164, status, phone_verified_at)
       VALUES ('visitor', $1, 'active', $2)
       ON CONFLICT (phone_e164) DO NOTHING`,
      [consumed.phone, now],
    );
    const { rows } = await client.query<{
      id: string;
      role: Role;
      status: string;
    }>('SELECT id, role, status FROM users WHERE phone_e164 = $1', [
      consumed.phone,
    ]);
    const user = rows[0];
    if (user.role !== 'visitor')
      return { ok: false, reason: 'account_exists' } as const;
    if (user.status === 'suspended')
      return { ok: false, reason: 'suspended' } as const;
    if (user.status === 'pending') {
      await client.query(
        `UPDATE users SET status = 'active', phone_verified_at = $2 WHERE id = $1`,
        [user.id, now],
      );
    }

    const session = await createSession(
      client,
      {
        userId: user.id,
        role: 'visitor',
        ipHash: input.device.ipHash,
        userAgent: input.userAgent,
      },
      now,
    );
    return { ok: true, session } as const;
  });
}
