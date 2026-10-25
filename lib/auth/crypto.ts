import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { getAuthSecret } from '@/lib/env';

// 32 characters, without 0, O, 1 and I (spec 2.4): easy to read and to type.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Keyed hash of a value (codes, devices, addresses): useless without AUTH_SECRET. */
export function hmac(purpose: string, value: string): string {
  return createHmac('sha256', getAuthSecret())
    .update(`${purpose}:${value}`)
    .digest('hex');
}

/** Plain hash, for random tokens that already have 256 bits of entropy (session cookies). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 256-bit random value for cookies. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The verification code shown on screen, e.g. "TTP-7KQ2". It is derived from the challenge
 * id and the secret, so it needs no storage: the database keeps only its hash.
 */
export function deriveVerificationCode(challengeId: string): string {
  const bytes = createHmac('sha256', getAuthSecret())
    .update(`verification-code:${challengeId}`)
    .digest();
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[bytes[i] % 32];
  return `TTP-${suffix}`;
}

export function hashVerificationCode(code: string): string {
  return hmac('verification-code-hash', code.toUpperCase());
}

// "TTP-" + 4 characters of the alphabet, not followed by more code characters
// (so an activation code TTP-XXXX-XXXX-XXXX is never mistaken for this one).
const CODE_IN_TEXT = /\bTTP-([A-HJ-NP-Z2-9]{4})(?![A-Za-z0-9-])/i;

/** Finds the verification code inside a WhatsApp message, or null. */
export function extractVerificationCode(text: string): string | null {
  const match = CODE_IN_TEXT.exec(text);
  return match ? `TTP-${match[1].toUpperCase()}` : null;
}
