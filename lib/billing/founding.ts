import type { PoolClient } from 'pg';
import type { Queryable } from '@/lib/db/transaction';
import { addDays } from './entitlements';
import { getSettings } from './settings';

// Founding offer (spec 2.6): the first 100 approved teachers with a verified WhatsApp number
// get 365 days free, applied automatically at approval. One slot per phone number.

export type FoundingSlots = { total: number; used: number; left: number };

export async function getFoundingSlots(db: Queryable): Promise<FoundingSlots> {
  const s = await getSettings(db, [
    'founding.slots_total',
    'founding.slots_used',
  ]);
  const total = Number(s.get('founding.slots_total') ?? 0);
  const used = Number(s.get('founding.slots_used') ?? 0);
  return { total, used, left: Math.max(0, total - used) };
}

export type FoundingResult =
  { granted: false } | { granted: true; grantId: string; days: number };

/**
 * Called inside the approval transaction. A slot is taken with ONE atomic statement, so two
 * approvals at the same moment can never share the last slot. Rejected, draft or pending
 * profiles never reach this code, so they never use a slot (acceptance test 20).
 */
export async function tryGrantFounding(
  client: PoolClient,
  teacherId: string,
  now: Date,
): Promise<FoundingResult> {
  const s = await getSettings(client, [
    'founding.days',
    'founding.grant_visibility',
    'founding.grant_dashboard',
  ]);
  const days = Number(s.get('founding.days') ?? 365);
  const visibility = s.get('founding.grant_visibility') !== false;
  const dashboard = s.get('founding.grant_dashboard') !== false;
  if (!(days > 0) || (!visibility && !dashboard)) return { granted: false };

  // One year per phone number, even if the account is deleted and created again.
  const { rows: users } = await client.query<{
    phone_e164: string;
    phone_verified_at: Date | null;
  }>('SELECT phone_e164, phone_verified_at FROM users WHERE id = $1', [
    teacherId,
  ]);
  const user = users[0];
  if (!user || !user.phone_verified_at) return { granted: false };
  const claimed = await client.query(
    'SELECT 1 FROM founding_claims WHERE phone_e164 = $1',
    [user.phone_e164],
  );
  if (claimed.rows.length > 0) return { granted: false };

  // Take a slot, atomically: the counter only moves while it is below the total.
  const slot = await client.query(
    `UPDATE settings SET value = to_jsonb((value #>> '{}')::int + 1)
     WHERE key = 'founding.slots_used'
       AND (value #>> '{}')::int < (SELECT (value #>> '{}')::int FROM settings WHERE key = 'founding.slots_total')`,
  );
  if (slot.rowCount === 0) return { granted: false };

  const { grantId } = await addDays(client, {
    teacherId,
    source: 'founding',
    visibilityDays: visibility ? days : 0,
    dashboardDays: dashboard ? days : 0,
    now,
    note: 'Offre fondateurs',
  });
  await client.query(
    'INSERT INTO founding_claims (phone_e164, user_id, grant_id, claimed_at) VALUES ($1, $2, $3, $4)',
    [user.phone_e164, teacherId, grantId, now],
  );
  return { granted: true, grantId, days };
}
