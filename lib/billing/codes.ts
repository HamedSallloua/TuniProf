import { createHmac, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { isActiveAdmin } from '@/lib/auth/admin';
import { CODE_ALPHABET, hmac } from '@/lib/auth/crypto';
import { recordEvents } from '@/lib/auth/rate-limit';
import { withTransaction } from '@/lib/db/transaction';
import { getAuthSecret } from '@/lib/env';
import { addDays, DAY_MS } from './entitlements';
import { getPlan } from './plans';
import { getNumberSetting } from './settings';

// Activation codes (spec 2.4, invariant 4): TTP-XXXX-XXXX-XXXX, 12 characters of a 32-character
// alphabet without 0, O, 1 and I. Generated only by an admin, single use, bound to a plan, a
// payment request and a teacher, valid 90 days, hashed in the database.
//
// Like the WhatsApp codes, the code is DERIVED from its id and the server secret: the database
// keeps only its keyed hash, and the teacher's space can still show it (spec 4.3 step 4).
// (Changing AUTH_SECRET would make unredeemed codes unreadable: they would be re-issued.)

export const CODE_FAILURE_LIMIT = 5; // wrong attempts per hour (spec 2.4)
export const CODE_LOCK_MS = 60 * 60 * 1000;
const CODE_BUCKET = 'code_failure:user';

export function deriveActivationCode(codeId: string): string {
  const bytes = createHmac('sha256', getAuthSecret())
    .update(`activation-code:${codeId}`)
    .digest();
  let chars = '';
  for (let i = 0; i < 12; i++) chars += CODE_ALPHABET[bytes[i] % 32]; // 256 / 32: no bias
  return `TTP-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** Accepts the code typed with or without dashes, spaces, any case. Null if it cannot be one. */
export function normalizeActivationCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  if (!/^TTP[A-Z0-9]{12}$/.test(compact)) return null;
  const body = compact.slice(3);
  if ([...body].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `TTP-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export function hashActivationCode(code: string): string {
  return hmac('activation-code-hash', code);
}

// ---------------------------------------------------------------------------- issuing

export type IssueFailure =
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid_state' | 'invalid_input';
    }
  | { ok: false; reason: 'transaction_reused' };

/**
 * Admin step 5 of the checklist (spec 13.3): the money is visible in the account, the
 * transaction number is new, the code is generated from THAT request and the payment is
 * marked verified, atomically. The plain code is returned once, to be sent to the teacher.
 */
export async function issueCode(
  pool: Pool,
  adminId: string,
  requestId: string,
  input: {
    transactionRef: string;
    transactionDate: string;
    note?: string | null;
  },
  now: Date = new Date(),
): Promise<{ ok: true; code: string; codeId: string } | IssueFailure> {
  const transactionRef = input.transactionRef.trim();
  if (
    !transactionRef ||
    transactionRef.length > 100 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate)
  ) {
    return { ok: false, reason: 'invalid_input' };
  }

  try {
    return await withTransaction(pool, async (client) => {
      if (!(await isActiveAdmin(client, adminId)))
        return { ok: false, reason: 'forbidden' } as const;

      const { rows } = await client.query(
        `SELECT id, teacher_id, plan_id, kind, with_dashboard, upgrade_dashboard_days, status
         FROM payment_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      const request = rows[0];
      if (!request) return { ok: false, reason: 'not_found' } as const;
      if (request.status !== 'pending' && request.status !== 'proof_received') {
        return { ok: false, reason: 'invalid_state' } as const;
      }

      const plan = await getPlan(client, request.plan_id);
      if (!plan) return { ok: false, reason: 'not_found' } as const;
      const visibilityDays = request.kind === 'upgrade' ? 0 : plan.durationDays;
      const dashboardDays =
        request.kind === 'upgrade'
          ? request.upgrade_dashboard_days
          : request.with_dashboard
            ? plan.durationDays
            : 0;

      // The same proof can never pay twice: transaction_ref is unique (23505 below).
      await client.query(
        `UPDATE payment_requests SET status = 'verified', transaction_ref = $2,
           transaction_date = $3, note = COALESCE($4, note), handled_by = $5, handled_at = $6
         WHERE id = $1`,
        [
          requestId,
          transactionRef,
          input.transactionDate,
          input.note ?? null,
          adminId,
          now,
        ],
      );

      const expiryDays = await getNumberSetting(
        client,
        'codes.expiry_days',
        90,
      );
      const codeId = randomUUID();
      const code = deriveActivationCode(codeId);
      await client.query(
        `INSERT INTO activation_codes
           (id, code_hash, plan_id, visibility_days, dashboard_days, payment_request_id,
            teacher_id, expires_at, issued_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          codeId,
          hashActivationCode(code),
          plan.id,
          visibilityDays,
          dashboardDays,
          requestId,
          request.teacher_id,
          new Date(now.getTime() + expiryDays * DAY_MS),
          adminId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at)
         VALUES ($1, 'payment.issue_code', 'payment_request', $2, $3::jsonb, $4)`,
        [
          adminId,
          requestId,
          JSON.stringify({ transactionRef, codeId, planId: plan.id }),
          now,
        ],
      );
      return { ok: true, code, codeId } as const;
    });
  } catch (error) {
    if ((error as { code?: string; constraint?: string }).code === '23505') {
      return { ok: false, reason: 'transaction_reused' };
    }
    throw error;
  }
}

/** An unredeemed code is cancelled (fraud, mistake). The payment request is then closed. */
export async function revokeCode(
  pool: Pool,
  adminId: string,
  requestId: string,
  reason: string,
  now: Date = new Date(),
): Promise<
  | { ok: true }
  | {
      ok: false;
      reason: 'forbidden' | 'not_found' | 'invalid_state' | 'invalid_input';
    }
> {
  const note = reason.trim();
  if (!note || note.length > 500) return { ok: false, reason: 'invalid_input' };
  return withTransaction(pool, async (client) => {
    if (!(await isActiveAdmin(client, adminId)))
      return { ok: false, reason: 'forbidden' } as const;
    const { rows } = await client.query(
      `SELECT id, status FROM activation_codes WHERE payment_request_id = $1 FOR UPDATE`,
      [requestId],
    );
    if (!rows[0]) return { ok: false, reason: 'not_found' } as const;
    if (rows[0].status !== 'issued')
      return { ok: false, reason: 'invalid_state' } as const;

    await client.query(
      `UPDATE activation_codes SET status = 'revoked', revoked_by = $2, revoked_at = $3 WHERE id = $1`,
      [rows[0].id, adminId, now],
    );
    await client.query(
      `UPDATE payment_requests SET status = 'rejected', note = $2, handled_by = $3, handled_at = $4
       WHERE id = $1`,
      [requestId, note, adminId, now],
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at)
       VALUES ($1, 'payment.revoke_code', 'payment_request', $2, $3::jsonb, $4)`,
      [
        adminId,
        requestId,
        JSON.stringify({ codeId: rows[0].id, reason: note }),
        now,
      ],
    );
    return { ok: true } as const;
  });
}

// -------------------------------------------------------------------------- redeeming

export type RedeemFailure =
  | {
      ok: false;
      reason: 'invalid' | 'used' | 'revoked' | 'expired' | 'suspended';
    }
  | { ok: false; reason: 'locked'; retryAfterMs: number };

export type RedeemSuccess = {
  ok: true;
  /** The days were stored as credit: they start when the profile is approved. */
  credited: boolean;
  visibilityDays: number;
  dashboardDays: number;
};

/**
 * Milliseconds left of the lockout, or 0 (spec 2.4, acceptance test 13).
 * Five wrong attempts within one hour lock the account for one hour from the LAST of them,
 * even for a right code. Four mistakes, or mistakes spread over more than an hour, never lock.
 */
async function lockStatus(
  pool: Pool,
  teacherId: string,
  now: Date,
): Promise<number> {
  // The five latest mistakes. Older than two hours cannot matter: a lock lasts one hour from
  // the latest mistake, and the five must fit in one hour.
  const since = new Date(now.getTime() - 2 * CODE_LOCK_MS);
  const { rows } = await pool.query<{ created_at: Date }>(
    `SELECT created_at FROM rate_limit_events WHERE bucket = $1 AND key = $2 AND created_at > $3
     ORDER BY created_at DESC LIMIT $4`,
    [CODE_BUCKET, teacherId, since, CODE_FAILURE_LIMIT],
  );
  if (rows.length < CODE_FAILURE_LIMIT) return 0;

  const latest = rows[0].created_at.getTime();
  const fifth = rows[CODE_FAILURE_LIMIT - 1].created_at.getTime();
  if (latest - fifth > CODE_LOCK_MS) return 0; // spread over more than an hour
  return Math.max(0, latest + CODE_LOCK_MS - now.getTime());
}

export async function redeemCode(
  pool: Pool,
  teacherId: string,
  rawCode: string,
  now: Date = new Date(),
): Promise<RedeemSuccess | RedeemFailure> {
  const lockedFor = await lockStatus(pool, teacherId, now);
  if (lockedFor > 0)
    return { ok: false, reason: 'locked', retryAfterMs: lockedFor };

  const fail = async (
    reason: 'invalid' | 'used' | 'revoked' | 'expired',
  ): Promise<RedeemFailure> => {
    await recordEvents(pool, [{ bucket: CODE_BUCKET, key: teacherId }], now);
    return { ok: false, reason };
  };

  const code = normalizeActivationCode(rawCode);
  if (!code) return fail('invalid');

  const outcome = await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT id, teacher_id, plan_id, visibility_days, dashboard_days, status, expires_at,
              payment_request_id
       FROM activation_codes WHERE code_hash = $1 FOR UPDATE`,
      [hashActivationCode(code)],
    );
    const row = rows[0];
    // A code of another teacher is "invalid", like an unknown one: it must not be usable
    // by someone else, and the answer does not tell that it exists.
    if (!row || row.teacher_id !== teacherId)
      return { kind: 'fail', reason: 'invalid' } as const;
    if (row.status === 'redeemed')
      return { kind: 'fail', reason: 'used' } as const;
    if (row.status === 'revoked')
      return { kind: 'fail', reason: 'revoked' } as const;
    if (row.status === 'expired' || row.expires_at <= now) {
      await client.query(
        `UPDATE activation_codes SET status = 'expired' WHERE id = $1 AND status = 'issued'`,
        [row.id],
      );
      return { kind: 'fail', reason: 'expired' } as const;
    }

    // A suspended teacher keeps the code for later; it is not a wrong attempt.
    const { rows: prof } = await client.query<{ status: string | null }>(
      'SELECT (SELECT status FROM teacher_profiles WHERE user_id = $1) AS status',
      [teacherId],
    );
    if (prof[0].status === 'suspended') return { kind: 'suspended' } as const;

    const { credited } = await addDays(client, {
      teacherId,
      source: 'code',
      visibilityDays: row.visibility_days,
      dashboardDays: row.dashboard_days,
      now,
      planId: row.plan_id,
      activationCodeId: row.id,
      paymentRequestId: row.payment_request_id,
    });
    await client.query(
      `UPDATE activation_codes SET status = 'redeemed', redeemed_at = $2 WHERE id = $1`,
      [row.id, now],
    );
    return {
      kind: 'ok',
      credited,
      visibilityDays: row.visibility_days as number,
      dashboardDays: row.dashboard_days as number,
    } as const;
  });

  if (outcome.kind === 'fail') return fail(outcome.reason);
  if (outcome.kind === 'suspended') return { ok: false, reason: 'suspended' };
  return {
    ok: true,
    credited: outcome.credited,
    visibilityDays: outcome.visibilityDays,
    dashboardDays: outcome.dashboardDays,
  };
}

// --------------------------------------------------------------------------- reading

/** The code of a teacher's verified request, while it is still waiting to be redeemed. */
export async function findIssuedCodeForTeacher(
  pool: Pool,
  teacherId: string,
  now: Date = new Date(),
): Promise<{ code: string; expiresAt: Date; planId: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, expires_at, plan_id FROM activation_codes
     WHERE teacher_id = $1 AND status = 'issued' AND expires_at > $2
     ORDER BY created_at DESC LIMIT 1`,
    [teacherId, now],
  );
  return rows[0]
    ? {
        code: deriveActivationCode(rows[0].id),
        expiresAt: rows[0].expires_at,
        planId: rows[0].plan_id,
      }
    : null;
}

/** Daily job (spec 8.1): unredeemed codes older than their expiry become 'expired'. */
export async function expireStaleCodes(
  pool: Pool,
  now: Date = new Date(),
): Promise<number> {
  const result = await pool.query(
    `UPDATE activation_codes SET status = 'expired' WHERE status = 'issued' AND expires_at <= $1`,
    [now],
  );
  return result.rowCount ?? 0;
}
