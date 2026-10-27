import type { Pool } from 'pg';
import { z } from 'zod';
import { checkLimits, recordEvents } from '@/lib/auth/rate-limit';
import type { DeviceContext } from '@/lib/auth/verification';
import { withTransaction } from '@/lib/db/transaction';
import { REPORT_LIMITS } from './config';
import { REPORT_REASONS } from './report-reasons';

// "Signaler ce profil" (spec 3.4). The report waits in the `reports` table for an admin
// (the screen comes at M11). Only a visible profile can be reported.

const reportSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    note: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value === '' ? null : value)),
  })
  .refine((value) => value.reason !== 'other' || value.note !== null, {
    path: ['note'],
  });

export type ReportResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid' | 'not_found' | 'already_reported' | 'rate_limited';
    };

const UNIQUE_VIOLATION = '23505';

export async function reportProfile(
  pool: Pool,
  input: {
    slug: string;
    reason: string;
    note: string;
    reporterId: string | null;
    device: DeviceContext;
  },
  now: Date = new Date(),
): Promise<ReportResult> {
  const parsed = reportSchema.safeParse({
    reason: input.reason,
    note: input.note,
  });
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  try {
    return await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `report:device:${input.device.deviceHash}`,
      ]);
      const { rows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM teacher_profiles
          WHERE slug = $1 AND teacher_is_visible(user_id, $2)`,
        [input.slug, now],
      );
      if (rows.length === 0) return { ok: false, reason: 'not_found' } as const;

      const limits = await checkLimits(
        client,
        REPORT_LIMITS.windowMs,
        [
          {
            bucket: 'report:device',
            key: input.device.deviceHash,
            limit: REPORT_LIMITS.perDevice,
          },
          ...(input.device.ipHash
            ? [
                {
                  bucket: 'report:ip',
                  key: input.device.ipHash,
                  limit: REPORT_LIMITS.perIp,
                },
              ]
            : []),
        ],
        now,
      );
      if (!limits.allowed) {
        return { ok: false, reason: 'rate_limited' } as const;
      }

      await client.query(
        `INSERT INTO reports (teacher_id, reason, note, reporter_id, session_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          rows[0].user_id,
          parsed.data.reason,
          parsed.data.note,
          input.reporterId,
          input.device.deviceHash,
          now,
        ],
      );
      await recordEvents(
        client,
        [
          { bucket: 'report:device', key: input.device.deviceHash },
          ...(input.device.ipHash
            ? [{ bucket: 'report:ip', key: input.device.ipHash }]
            : []),
        ],
        now,
      );
      return { ok: true } as const;
    });
  } catch (error) {
    // The unique index: this browser already has an open report on this profile.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return { ok: false, reason: 'already_reported' };
    }
    throw error;
  }
}
