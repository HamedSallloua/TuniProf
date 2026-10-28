import { randomInt } from 'node:crypto';
import type { Pool } from 'pg';
import { isActiveAdmin } from '@/lib/auth/admin';
import { withTransaction, type Queryable } from '@/lib/db/transaction';
import { enqueueNotification } from '@/lib/notifications/queue';
import { addDays, daysLeft, getEntitlements } from './entitlements';
import { getPlan, planPrice, upgradePrice } from './plans';
import { getPaymentSettings, paymentsAvailable } from './settings';

// Payment requests (spec 4.3): the teacher picks a plan and a way to pay, gets a reference and
// the exact amount, pays outside the site, sends the proof, and an admin issues a code.

export const PAYMENT_METHODS = ['flouci', 'd17', 'ccp'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus =
  'pending' | 'proof_received' | 'verified' | 'rejected' | 'cancelled';

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export type PaymentRequest = {
  id: string;
  teacherId: string;
  planId: string;
  kind: 'plan' | 'upgrade';
  withDashboard: boolean;
  amountMillimes: number;
  method: PaymentMethod;
  reference: string;
  status: PaymentStatus;
  transactionRef: string | null;
  note: string | null;
  createdAt: Date;
};

type Row = {
  id: string;
  teacher_id: string;
  plan_id: string;
  kind: 'plan' | 'upgrade';
  with_dashboard: boolean;
  amount_millimes: number;
  method: PaymentMethod;
  reference: string;
  status: PaymentStatus;
  transaction_ref: string | null;
  note: string | null;
  created_at: Date;
};

const toRequest = (r: Row): PaymentRequest => ({
  id: r.id,
  teacherId: r.teacher_id,
  planId: r.plan_id,
  kind: r.kind,
  withDashboard: r.with_dashboard,
  amountMillimes: r.amount_millimes,
  method: r.method,
  reference: r.reference,
  status: r.status,
  transactionRef: r.transaction_ref,
  note: r.note,
  createdAt: r.created_at,
});

// -------------------------------------------------------------------------- teacher side

export type CreateFailure =
  | 'unavailable' // the owner has not configured the payment accounts yet (production)
  | 'invalid_plan'
  | 'invalid_method'
  | 'open_request_exists'
  | 'not_available'; // an upgrade that does not apply

export type CreateResult =
  { ok: true; request: PaymentRequest } | { ok: false; reason: CreateFailure };

async function insertRequest(
  pool: Pool,
  v: {
    teacherId: string;
    planId: string;
    kind: 'plan' | 'upgrade';
    withDashboard: boolean;
    upgradeDays: number | null;
    amount: number;
    method: PaymentMethod;
    now: Date;
  },
): Promise<CreateResult> {
  // A 5-digit reference, e.g. TTP-48213. If it is already taken, draw another one.
  for (let attempt = 0; attempt < 10; attempt++) {
    const reference = `TTP-${randomInt(10000, 100000)}`;
    try {
      const { rows } = await pool.query<Row>(
        `INSERT INTO payment_requests
           (teacher_id, plan_id, kind, with_dashboard, upgrade_dashboard_days, amount_millimes,
            method, reference, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          v.teacherId,
          v.planId,
          v.kind,
          v.withDashboard,
          v.upgradeDays,
          v.amount,
          v.method,
          reference,
          v.now,
        ],
      );
      return { ok: true, request: toRequest(rows[0]) };
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      if (
        e.code === '23505' &&
        e.constraint === 'payment_requests_one_open_idx'
      ) {
        return { ok: false, reason: 'open_request_exists' };
      }
      if (e.code === '23505') continue; // reference already used
      throw error;
    }
  }
  throw new Error('Could not draw a free payment reference');
}

/** A new purchase or renewal. Only one request can be open at a time. */
export async function createPaymentRequest(
  pool: Pool,
  teacherId: string,
  input: { planId: string; withDashboard: boolean; method: string },
  now: Date = new Date(),
): Promise<CreateResult> {
  if (!isPaymentMethod(input.method))
    return { ok: false, reason: 'invalid_method' };
  if (!paymentsAvailable(await getPaymentSettings(pool)))
    return { ok: false, reason: 'unavailable' };

  const plan = await getPlan(pool, input.planId);
  if (!plan) return { ok: false, reason: 'invalid_plan' };
  const active = await pool.query('SELECT is_active FROM plans WHERE id = $1', [
    plan.id,
  ]);
  if (!active.rows[0]?.is_active) return { ok: false, reason: 'invalid_plan' };

  return insertRequest(pool, {
    teacherId,
    planId: plan.id,
    kind: 'plan',
    withDashboard: input.withDashboard,
    upgradeDays: null,
    amount: planPrice(plan, input.withDashboard),
    method: input.method,
    now,
  });
}

export type UpgradeOffer = {
  planId: string;
  /** Dashboard days granted: the visibility days that remain. */
  days: number;
  amountMillimes: number;
};

/**
 * Can this teacher add the Dashboard to the running term, and for how much? (spec 2.2)
 * Needs a running visibility term, a known plan, and no Dashboard running already.
 */
export async function getUpgradeOffer(
  db: Queryable,
  teacherId: string,
  now: Date = new Date(),
): Promise<UpgradeOffer | null> {
  const entitlements = await getEntitlements(db, teacherId);
  const remaining = daysLeft(entitlements?.visibilityUntil ?? null, now);
  const dashboardRunning =
    (entitlements?.dashboardUntil?.getTime() ?? 0) > now.getTime();
  if (
    !entitlements ||
    !entitlements.lastPlanId ||
    remaining < 1 ||
    dashboardRunning
  ) {
    return null;
  }
  const plan = await getPlan(db, entitlements.lastPlanId);
  if (!plan) return null;
  const amount = upgradePrice(plan, remaining);
  return amount > 0
    ? { planId: plan.id, days: remaining, amountMillimes: amount }
    : null;
}

/**
 * Adds the Dashboard to a running term (spec 2.2): grants Dashboard days equal to the remaining
 * visibility days, at a price of the plan's add-on x remaining days / plan days (0.5 DT steps).
 */
export async function createUpgradeRequest(
  pool: Pool,
  teacherId: string,
  input: { method: string },
  now: Date = new Date(),
): Promise<CreateResult> {
  if (!isPaymentMethod(input.method))
    return { ok: false, reason: 'invalid_method' };
  if (!paymentsAvailable(await getPaymentSettings(pool)))
    return { ok: false, reason: 'unavailable' };

  const offer = await getUpgradeOffer(pool, teacherId, now);
  if (!offer) return { ok: false, reason: 'not_available' };

  return insertRequest(pool, {
    teacherId,
    planId: offer.planId,
    kind: 'upgrade',
    withDashboard: true,
    upgradeDays: offer.days,
    amount: offer.amountMillimes,
    method: input.method,
    now,
  });
}

/** The teacher gives up a request that no admin has handled yet. */
export async function cancelPaymentRequest(
  pool: Pool,
  teacherId: string,
  requestId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE payment_requests SET status = 'cancelled'
     WHERE id = $1 AND teacher_id = $2 AND status = 'pending'`,
    [requestId, teacherId],
  );
  return rowCount === 1;
}

export async function listPaymentRequestsForTeacher(
  db: Queryable,
  teacherId: string,
): Promise<PaymentRequest[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM payment_requests WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT 20',
    [teacherId],
  );
  return rows.map(toRequest);
}

/** Always filtered by the teacher's id (invariant 16): a reference of someone else finds nothing. */
export async function getPaymentRequestByReference(
  db: Queryable,
  teacherId: string,
  reference: string,
): Promise<PaymentRequest | null> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM payment_requests WHERE teacher_id = $1 AND reference = $2',
    [teacherId, reference],
  );
  return rows[0] ? toRequest(rows[0]) : null;
}

// ---------------------------------------------------------------------------- admin side

export type AdminFailure = {
  ok: false;
  reason: 'forbidden' | 'not_found' | 'invalid_state' | 'invalid_input';
};

async function adminAudit(
  client: Queryable,
  adminId: string,
  action: string,
  requestId: string,
  details: Record<string, unknown>,
  now: Date,
) {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at)
     VALUES ($1, $2, 'payment_request', $3, $4::jsonb, $5)`,
    [adminId, action, requestId, JSON.stringify(details), now],
  );
}

/** "Preuve reçue": the teacher's proof arrived on WhatsApp or Messenger (not yet checked). */
export async function markProofReceived(
  pool: Pool,
  adminId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | AdminFailure> {
  return withTransaction(pool, async (client) => {
    if (!(await isActiveAdmin(client, adminId)))
      return { ok: false, reason: 'forbidden' } as const;
    const updated = await client.query<{
      teacher_id: string;
      reference: string;
    }>(
      `UPDATE payment_requests SET status = 'proof_received', handled_by = $2, handled_at = $3
       WHERE id = $1 AND status = 'pending'
       RETURNING teacher_id, reference`,
      [requestId, adminId, now],
    );
    if (updated.rowCount !== 1) {
      const exists = await client.query(
        'SELECT 1 FROM payment_requests WHERE id = $1',
        [requestId],
      );
      return {
        ok: false,
        reason: exists.rows.length ? 'invalid_state' : 'not_found',
      } as const;
    }
    await adminAudit(
      client,
      adminId,
      'payment.proof_received',
      requestId,
      {},
      now,
    );
    await enqueueNotification(client, {
      userId: updated.rows[0].teacher_id,
      kind: 'payment_proof_received',
      dedupeKey: `proof:${requestId}`,
      params: { reference: updated.rows[0].reference },
    });
    return { ok: true } as const;
  });
}

/** The payment is not valid (nothing received, wrong amount, fake proof). A note is required. */
export async function rejectPaymentRequest(
  pool: Pool,
  adminId: string,
  requestId: string,
  note: string,
  now: Date = new Date(),
): Promise<{ ok: true } | AdminFailure> {
  const text = note.trim();
  if (!text || text.length > 500) return { ok: false, reason: 'invalid_input' };
  return withTransaction(pool, async (client) => {
    if (!(await isActiveAdmin(client, adminId)))
      return { ok: false, reason: 'forbidden' } as const;
    const updated = await client.query<{
      teacher_id: string;
      reference: string;
    }>(
      `UPDATE payment_requests SET status = 'rejected', note = $2, handled_by = $3, handled_at = $4
       WHERE id = $1 AND status IN ('pending', 'proof_received')
       RETURNING teacher_id, reference`,
      [requestId, text, adminId, now],
    );
    if (updated.rowCount !== 1) {
      const exists = await client.query(
        'SELECT 1 FROM payment_requests WHERE id = $1',
        [requestId],
      );
      return {
        ok: false,
        reason: exists.rows.length ? 'invalid_state' : 'not_found',
      } as const;
    }
    await adminAudit(
      client,
      adminId,
      'payment.reject',
      requestId,
      { note: text },
      now,
    );
    // The admin's note stays internal: the teacher only gets the reference.
    await enqueueNotification(client, {
      userId: updated.rows[0].teacher_id,
      kind: 'payment_refused',
      dedupeKey: `refused:${requestId}`,
      params: { reference: updated.rows[0].reference },
    });
    return { ok: true } as const;
  });
}

/**
 * A manual extension (or a gesture after a refund), spec 6: always with a written note.
 * Follows the same rule as a code: if the profile is not approved yet, the days wait as credit.
 */
export async function grantDaysManually(
  pool: Pool,
  adminId: string,
  teacherId: string,
  input: { visibilityDays: number; dashboardDays: number; note: string },
  now: Date = new Date(),
): Promise<{ ok: true; credited: boolean } | AdminFailure> {
  const note = input.note.trim();
  const { visibilityDays, dashboardDays } = input;
  if (
    !note ||
    note.length > 500 ||
    !Number.isInteger(visibilityDays) ||
    !Number.isInteger(dashboardDays) ||
    visibilityDays < 0 ||
    dashboardDays < 0 ||
    visibilityDays + dashboardDays === 0 ||
    visibilityDays > 730 ||
    dashboardDays > 730
  ) {
    return { ok: false, reason: 'invalid_input' };
  }
  return withTransaction(pool, async (client) => {
    if (!(await isActiveAdmin(client, adminId)))
      return { ok: false, reason: 'forbidden' } as const;
    const teacher = await client.query(
      `SELECT 1 FROM users WHERE id = $1 AND role = 'teacher'`,
      [teacherId],
    );
    if (!teacher.rows.length)
      return { ok: false, reason: 'not_found' } as const;

    const { credited } = await addDays(client, {
      teacherId,
      source: 'admin',
      visibilityDays,
      dashboardDays,
      now,
      note,
      grantedBy: adminId,
    });
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at)
       VALUES ($1, 'entitlement.manual_grant', 'user', $2, $3::jsonb, $4)`,
      [
        adminId,
        teacherId,
        JSON.stringify({ visibilityDays, dashboardDays, note, credited }),
        now,
      ],
    );
    return { ok: true, credited } as const;
  });
}

// ------------------------------------------------------------------------ admin reading

export type PaymentListItem = PaymentRequest & {
  teacherName: string | null;
  teacherPhone: string;
  planNameFr: string;
};

export async function listPaymentRequests(
  db: Queryable,
  filter: 'open' | 'all' = 'open',
): Promise<PaymentListItem[]> {
  const { rows } = await db.query(
    `SELECT r.*, u.phone_e164, p.full_name, pl.name_fr AS plan_name
     FROM payment_requests r
     JOIN users u ON u.id = r.teacher_id
     LEFT JOIN teacher_profiles p ON p.user_id = r.teacher_id
     JOIN plans pl ON pl.id = r.plan_id
     WHERE ($1 = 'all' OR r.status IN ('pending', 'proof_received'))
     ORDER BY r.created_at ASC LIMIT 200`,
    [filter],
  );
  return rows.map((r) => ({
    ...toRequest(r),
    teacherName: r.full_name,
    teacherPhone: r.phone_e164,
    planNameFr: r.plan_name,
  }));
}

export type PaymentDetail = PaymentListItem & {
  codeStatus: 'issued' | 'redeemed' | 'revoked' | 'expired' | null;
  codeId: string | null;
  profileStatus: string | null;
};

export async function getPaymentDetail(
  db: Queryable,
  requestId: string,
): Promise<PaymentDetail | null> {
  const { rows } = await db.query(
    `SELECT r.*, u.phone_e164, p.full_name, p.status AS profile_status, pl.name_fr AS plan_name,
            c.status AS code_status, c.id AS code_id
     FROM payment_requests r
     JOIN users u ON u.id = r.teacher_id
     LEFT JOIN teacher_profiles p ON p.user_id = r.teacher_id
     JOIN plans pl ON pl.id = r.plan_id
     LEFT JOIN activation_codes c ON c.payment_request_id = r.id
     WHERE r.id = $1`,
    [requestId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...toRequest(r),
    teacherName: r.full_name,
    teacherPhone: r.phone_e164,
    planNameFr: r.plan_name,
    codeStatus: r.code_status,
    codeId: r.code_id,
    profileStatus: r.profile_status,
  };
}
