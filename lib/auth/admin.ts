import type { Pool } from 'pg';
import { hashPassword } from './password';

export type AdminRole = 'admin_super' | 'admin_support';

/**
 * Creates an admin account, already active and verified: admins are created by the owner
 * from the command line (npm run admin:create), never through the public sign-up.
 * Never overwrites an existing account.
 */
export async function createAdmin(
  pool: Pool,
  input: {
    phone: string;
    role: AdminRole;
    password: string;
    email?: string | null;
  },
  now: Date = new Date(),
): Promise<
  { ok: true; userId: string } | { ok: false; reason: 'phone_taken' }
> {
  const passwordHash = await hashPassword(input.password);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (role, phone_e164, email, password_hash, status, phone_verified_at)
     VALUES ($1, $2, $3, $4, 'active', $5)
     ON CONFLICT (phone_e164) DO NOTHING
     RETURNING id`,
    [input.role, input.phone, input.email ?? null, passwordHash, now],
  );
  return rows[0]
    ? { ok: true, userId: rows[0].id }
    : { ok: false, reason: 'phone_taken' };
}
