import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTransaction } from '@/lib/db/transaction';
import { fromWhatsAppNumber } from '@/lib/phone';
import {
  OTP_LOCK_MS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  RATE_LIMITS,
} from './config';
import {
  deriveVerificationCode,
  extractVerificationCode,
  hashVerificationCode,
  safeEqual,
} from './crypto';
import { checkLimits, recordEvents } from './rate-limit';

// WhatsApp "send-to-verify" (spec 8.5, method 1). The screen shows a code; the person
// sends it from WhatsApp to the platform number; the webhook receives the message and
// verifies the SENDER's number. The platform sends nothing, so there is no per-code cost.

export type Purpose = 'signup' | 'reset' | 'visitor_login';

export type DeviceContext = {
  deviceHash: string;
  ipHash: string | null;
};

// ---------------------------------------------------------------- starting a challenge

export type StartResult =
  | { ok: true; challengeId: string; expiresAt: Date }
  | { ok: false; reason: 'rate_limited' | 'locked'; retryAfterMs: number };

export async function startChallenge(
  pool: Pool,
  input: {
    phone: string;
    purpose: Purpose;
    userId: string | null;
    device: DeviceContext;
  },
  now: Date = new Date(),
): Promise<StartResult> {
  const { phone, purpose, userId, device } = input;
  const limits = RATE_LIMITS.challenge;

  const checks = [
    { bucket: 'challenge:phone', key: phone, limit: limits.perPhone },
    {
      bucket: 'challenge:device',
      key: device.deviceHash,
      limit: limits.perDevice,
    },
    ...(device.ipHash
      ? [{ bucket: 'challenge:ip', key: device.ipHash, limit: limits.perIp }]
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

  // A number that failed 5 times stays locked for one hour, whatever new challenge is asked.
  const { rows: locks } = await pool.query<{ locked_until: Date }>(
    `SELECT max(locked_until) AS locked_until FROM otp_challenges
     WHERE phone_e164 = $1 AND locked_until > $2`,
    [phone, now],
  );
  if (locks[0]?.locked_until) {
    return {
      ok: false,
      reason: 'locked',
      retryAfterMs: locks[0].locked_until.getTime() - now.getTime(),
    };
  }

  const challengeId = randomUUID();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  await withTransaction(pool, async (client) => {
    // Only the newest challenge of a kind stays usable.
    await client.query(
      `UPDATE otp_challenges SET expires_at = LEAST(expires_at, $3)
       WHERE phone_e164 = $1 AND purpose = $2 AND verified_at IS NULL AND expires_at > $3`,
      [phone, purpose, now],
    );
    await client.query(
      `INSERT INTO otp_challenges
         (id, phone_e164, purpose, code_hash, expires_at, user_id, device_hash, ip_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        challengeId,
        phone,
        purpose,
        hashVerificationCode(deriveVerificationCode(challengeId)),
        expiresAt,
        userId,
        device.deviceHash,
        device.ipHash,
        now,
      ],
    );
    await recordEvents(
      client,
      checks.map(({ bucket, key }) => ({ bucket, key })),
      now,
    );
  });

  return { ok: true, challengeId, expiresAt };
}

// ------------------------------------------------------------ the WhatsApp message arrives

export type InboundOutcome =
  | 'verified'
  | 'wrong_code' // a code was sent, but not the right one
  | 'wrong_sender' // the right code, sent from another number than the one typed
  | 'expired' // older than 5 minutes
  | 'locked' // 5 wrong tries: locked for one hour
  | 'no_challenge' // nobody is waiting for this message
  | 'no_code' // the text holds no verification code
  | 'duplicate'; // Meta delivered the same message twice

export type InboundMessage = {
  provider: string;
  messageId: string;
  /** Sender as WhatsApp gives it: digits with the country code, no "+". */
  from: string;
  text: string;
};

type ChallengeRow = {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  locked_until: Date | null;
  user_id: string | null;
  purpose: Purpose;
};

export async function handleInboundMessage(
  pool: Pool,
  message: InboundMessage,
  now: Date = new Date(),
): Promise<InboundOutcome> {
  return withTransaction(pool, async (client) => {
    const inserted = await client.query(
      `INSERT INTO webhook_events (provider, message_id, received_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [message.provider, message.messageId, now],
    );
    if (inserted.rowCount === 0) return 'duplicate';

    const code = extractVerificationCode(message.text);
    if (!code) return 'no_code';
    const codeHash = hashVerificationCode(code);

    const sender = fromWhatsAppNumber(message.from);
    if (!sender) return 'no_challenge';

    // The challenge is looked up by the SENDER's number: a code sent from any other
    // phone can never verify the number that was typed.
    const { rows } = await client.query<ChallengeRow>(
      `SELECT id, code_hash, attempts, expires_at, locked_until, user_id, purpose
       FROM otp_challenges
       WHERE phone_e164 = $1 AND verified_at IS NULL
       ORDER BY (expires_at > $2) DESC, created_at DESC LIMIT 1 FOR UPDATE`,
      [sender, now],
    );
    let challenge = rows[0];

    if (!challenge) {
      // Right code, wrong phone? Count it against the challenge that owns the code.
      const { rows: owners } = await client.query<ChallengeRow>(
        `SELECT id, code_hash, attempts, expires_at, locked_until, user_id, purpose
         FROM otp_challenges
         WHERE code_hash = $1 AND verified_at IS NULL AND expires_at > $2
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [codeHash, now],
      );
      challenge = owners[0];
      if (!challenge) return 'no_challenge';
      if (challenge.locked_until && challenge.locked_until > now)
        return 'locked';
      await registerWrongAttempt(client, challenge, now);
      return 'wrong_sender';
    }

    if (challenge.locked_until && challenge.locked_until > now) return 'locked';
    if (challenge.expires_at <= now) return 'expired';

    if (!safeEqual(challenge.code_hash, codeHash)) {
      await registerWrongAttempt(client, challenge, now);
      return 'wrong_code';
    }

    await client.query(
      'UPDATE otp_challenges SET verified_at = $2 WHERE id = $1',
      [challenge.id, now],
    );
    if (challenge.purpose === 'signup' && challenge.user_id) {
      // The number is proven: the pending account becomes active.
      await client.query(
        `UPDATE users SET phone_verified_at = $2, status = 'active'
         WHERE id = $1 AND status = 'pending'`,
        [challenge.user_id, now],
      );
    }
    return 'verified';
  });
}

async function registerWrongAttempt(
  client: Pick<Pool, 'query'>,
  challenge: ChallengeRow,
  now: Date,
): Promise<void> {
  const attempts = challenge.attempts + 1;
  const lockedUntil =
    attempts >= OTP_MAX_ATTEMPTS ? new Date(now.getTime() + OTP_LOCK_MS) : null;
  await client.query(
    'UPDATE otp_challenges SET attempts = $2, locked_until = $3 WHERE id = $1',
    [challenge.id, attempts, lockedUntil],
  );
}

// ------------------------------------------------------- the screen asks "is it verified?"

export type ChallengeStatus =
  'pending' | 'verified' | 'expired' | 'locked' | 'consumed';

export type ChallengeView = {
  id: string;
  phone: string;
  purpose: Purpose;
  status: ChallengeStatus;
  expiresAt: Date;
  /** The code to show on screen. Only given while the challenge is pending. */
  code: string | null;
};

/** Only the browser that started the challenge can see it (same device cookie). */
export async function getChallengeView(
  pool: Pool,
  challengeId: string,
  deviceHash: string,
  now: Date = new Date(),
): Promise<ChallengeView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return null;
  const { rows } = await pool.query<{
    id: string;
    phone_e164: string;
    purpose: Purpose;
    expires_at: Date;
    locked_until: Date | null;
    verified_at: Date | null;
    consumed_at: Date | null;
    device_hash: string;
  }>(
    `SELECT id, phone_e164, purpose, expires_at, locked_until, verified_at, consumed_at, device_hash
     FROM otp_challenges WHERE id = $1`,
    [challengeId],
  );
  const row = rows[0];
  if (!row || !safeEqual(row.device_hash, deviceHash)) return null;

  let status: ChallengeStatus;
  if (row.consumed_at) status = 'consumed';
  else if (row.verified_at) status = 'verified';
  else if (row.locked_until && row.locked_until > now) status = 'locked';
  else if (row.expires_at <= now) status = 'expired';
  else status = 'pending';

  return {
    id: row.id,
    phone: row.phone_e164,
    purpose: row.purpose,
    status,
    expiresAt: row.expires_at,
    code: status === 'pending' ? deriveVerificationCode(row.id) : null,
  };
}

// ------------------------------------------------------ using a verified challenge, once

export type ConsumeResult =
  | { ok: true; phone: string; userId: string | null }
  | {
      ok: false;
      reason: 'not_verified' | 'already_used' | 'too_late' | 'not_found';
    };

/**
 * Marks a verified challenge as used. Works once, from the same browser, for the
 * expected purpose, within 5 minutes of the verification.
 */
export async function consumeChallenge(
  client: Pick<Pool, 'query'>,
  input: { challengeId: string; deviceHash: string; purpose: Purpose },
  now: Date = new Date(),
): Promise<ConsumeResult> {
  const { rows } = await client.query<{
    phone_e164: string;
    user_id: string | null;
    purpose: Purpose;
    device_hash: string;
    verified_at: Date | null;
    consumed_at: Date | null;
  }>(
    `SELECT phone_e164, user_id, purpose, device_hash, verified_at, consumed_at
     FROM otp_challenges WHERE id = $1 FOR UPDATE`,
    [input.challengeId],
  );
  const row = rows[0];
  if (
    !row ||
    row.purpose !== input.purpose ||
    !safeEqual(row.device_hash, input.deviceHash)
  ) {
    return { ok: false, reason: 'not_found' };
  }
  if (row.consumed_at) return { ok: false, reason: 'already_used' };
  if (!row.verified_at) return { ok: false, reason: 'not_verified' };
  if (now.getTime() - row.verified_at.getTime() > OTP_TTL_MS) {
    return { ok: false, reason: 'too_late' };
  }

  await client.query(
    'UPDATE otp_challenges SET consumed_at = $2 WHERE id = $1',
    [input.challengeId, now],
  );
  return { ok: true, phone: row.phone_e164, userId: row.user_id };
}
