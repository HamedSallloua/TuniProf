import type { Pool } from 'pg';
import { deriveVerificationCode } from '@/lib/auth/crypto';
import {
  getChallengeView,
  handleInboundMessage,
  type DeviceContext,
  type InboundOutcome,
} from '@/lib/auth/verification';

// A fixed "now" so tests control time instead of waiting for it.
export const T0 = new Date('2026-10-26T10:00:00.000Z');
export const minutes = (n: number) => n * 60 * 1000;
export const at = (ms: number) => new Date(T0.getTime() + ms);

export const PHONE_A = '+21622345678';
export const PHONE_B = '+21655111222';
export const PHONE_C = '+21698765432';

export function device(name = 'a'): DeviceContext {
  return { deviceHash: `device-hash-${name}`, ipHash: `ip-hash-${name}` };
}

/**
 * Empties the account tables (users, sessions, challenges, profiles, audit log) of the
 * TEST database. Plain DELETEs, never TRUNCATE ... CASCADE: that would also empty the
 * catalogues and settings, which point at users.
 */
export async function clearAuthTables(pool: Pool): Promise<void> {
  for (const table of [
    'audit_log',
    'teacher_profiles', // its levels, zones and subjects go with it
    'auth_sessions',
    'otp_challenges',
    'webhook_events',
    'rate_limit_events',
    'users',
  ]) {
    await pool.query(`DELETE FROM ${table}`);
  }
  // Subjects typed by teachers ("Autre") are test leftovers, not catalogue.
  await pool.query("DELETE FROM subjects WHERE status = 'pending'");
}

let messageCounter = 0;

/** Pretends WhatsApp delivered a message from `phone` (E.164) to the platform. */
export function sendWhatsApp(
  pool: Pool,
  phone: string,
  text: string,
  now: Date = T0,
  messageId?: string,
): Promise<InboundOutcome> {
  return handleInboundMessage(
    pool,
    {
      provider: 'test',
      messageId: messageId ?? `msg-${++messageCounter}`,
      from: phone.replace('+', ''),
      text,
    },
    now,
  );
}

/** Sends the right code for a challenge from the right phone. */
export function verifyChallenge(
  pool: Pool,
  challengeId: string,
  phone: string,
  now: Date = T0,
): Promise<InboundOutcome> {
  return sendWhatsApp(
    pool,
    phone,
    `Vérification : ${deriveVerificationCode(challengeId)}`,
    now,
  );
}

export async function challengeStatus(
  pool: Pool,
  challengeId: string,
  dev: DeviceContext,
  now: Date = T0,
) {
  return (await getChallengeView(pool, challengeId, dev.deviceHash, now))
    ?.status;
}
