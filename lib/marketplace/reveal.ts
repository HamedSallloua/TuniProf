import type { Pool } from 'pg';
import { checkLimits, recordEvents } from '@/lib/auth/rate-limit';
import type { DeviceContext } from '@/lib/auth/verification';
import { withTransaction } from '@/lib/db/transaction';
import { REVEAL_LIMITS } from './config';
import { verifyTurnstile, type TurnstileVerifier } from './turnstile';

// "Voir les coordonnées" (spec 3.4, invariant 5, acceptance test 14). This is the only code
// that reads a teacher's phone number for the public site. Every reveal is logged, limited
// to 30 per device per hour, and asks for a Turnstile check from the 11th.

export type RevealResult =
  | { ok: true; phone: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number }
  | { ok: false; reason: 'captcha_required' | 'captcha_failed' };

const DEVICE_BUCKET = 'reveal:device';
const IP_BUCKET = 'reveal:ip';

export async function revealContact(
  pool: Pool,
  input: {
    slug: string;
    device: DeviceContext;
    /** The Turnstile answer, when the page showed the widget. */
    turnstileToken?: string | null;
    /** The visitor's address for Cloudflare (optional). */
    remoteIp?: string | null;
  },
  deps: { now?: Date; verify?: TurnstileVerifier } = {},
): Promise<RevealResult> {
  const now = deps.now ?? new Date();
  const verify = deps.verify ?? verifyTurnstile;

  // Ask Cloudflare before taking any database lock: it is a network call.
  const tokenValid = input.turnstileToken
    ? await verify(input.turnstileToken, input.remoteIp)
    : null;

  return withTransaction(pool, async (client) => {
    // Two clicks at the same moment from one device are handled one after the other, so the
    // 31st can never slip through together with the 30th.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${DEVICE_BUCKET}:${input.device.deviceHash}`,
    ]);

    // Same rule as the visibility view, evaluated at `now`.
    const { rows } = await client.query<{
      user_id: string;
      phone_e164: string;
    }>(
      `SELECT p.user_id, u.phone_e164
         FROM teacher_profiles p JOIN users u ON u.id = p.user_id
        WHERE p.slug = $1 AND teacher_is_visible(p.user_id, $2)`,
      [input.slug, now],
    );
    if (rows.length === 0) return { ok: false, reason: 'not_found' } as const;

    const limits = await checkLimits(
      client,
      REVEAL_LIMITS.windowMs,
      [
        {
          bucket: DEVICE_BUCKET,
          key: input.device.deviceHash,
          limit: REVEAL_LIMITS.perDevice,
        },
        ...(input.device.ipHash
          ? [
              {
                bucket: IP_BUCKET,
                key: input.device.ipHash,
                limit: REVEAL_LIMITS.perIp,
              },
            ]
          : []),
      ],
      now,
    );
    if (!limits.allowed) {
      return {
        ok: false,
        reason: 'rate_limited',
        retryAfterMs: limits.retryAfterMs,
      } as const;
    }

    const { rows: counted } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rate_limit_events
        WHERE bucket = $1 AND key = $2 AND created_at > $3`,
      [
        DEVICE_BUCKET,
        input.device.deviceHash,
        new Date(now.getTime() - REVEAL_LIMITS.windowMs),
      ],
    );
    if (counted[0].n >= REVEAL_LIMITS.turnstileAfter) {
      if (tokenValid === null) {
        return { ok: false, reason: 'captcha_required' } as const;
      }
      if (!tokenValid) return { ok: false, reason: 'captcha_failed' } as const;
    }

    await recordEvents(
      client,
      [
        { bucket: DEVICE_BUCKET, key: input.device.deviceHash },
        ...(input.device.ipHash
          ? [{ bucket: IP_BUCKET, key: input.device.ipHash }]
          : []),
      ],
      now,
    );
    await client.query(
      `INSERT INTO contact_events (teacher_id, session_hash, type, created_at)
       VALUES ($1, $2, 'reveal', $3)`,
      [rows[0].user_id, input.device.deviceHash, now],
    );
    return { ok: true, phone: rows[0].phone_e164 } as const;
  });
}
