import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createAdmin, type AdminRole } from '@/lib/auth/admin';
import type { ProfileInput } from '@/lib/profile/repo';

export type CatalogueIds = {
  sfax: { id: string; delegations: string[] };
  tunis: { id: string; delegations: string[] };
  levels: string[];
  subjects: string[];
};

let counter = 0;

/** A teacher account that signed up and verified its phone (inserted directly). */
export async function createTeacher(
  pool: Pool,
  options: { verified?: boolean; phone?: string } = {},
): Promise<string> {
  counter += 1;
  const phone = options.phone ?? `+21620${String(counter).padStart(6, '0')}`;
  const verified = options.verified ?? true;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (role, phone_e164, password_hash, status, phone_verified_at,
                        phone_display_consent_at, terms_accepted_at)
     VALUES ('teacher', $1, '$argon2id$placeholder', $2, CASE WHEN $3 THEN now() END, now(), now())
     RETURNING id`,
    [phone, verified ? 'active' : 'pending', verified],
  );
  return rows[0].id;
}

export async function createAdminUser(
  pool: Pool,
  role: AdminRole = 'admin_support',
): Promise<string> {
  counter += 1;
  const result = await createAdmin(pool, {
    phone: `+21690${String(counter).padStart(6, '0')}`,
    role,
    password: 'a long admin password',
  });
  if (!result.ok) throw new Error('admin setup failed');
  return result.userId;
}

export async function loadCatalogueIds(pool: Pool): Promise<CatalogueIds> {
  const governorate = async (slug: string) => {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM governorates WHERE slug = $1',
      [slug],
    );
    const { rows: del } = await pool.query<{ id: string }>(
      'SELECT id FROM delegations WHERE governorate_id = $1 ORDER BY name_fr LIMIT 4',
      [rows[0].id],
    );
    return { id: rows[0].id, delegations: del.map((d) => d.id) };
  };
  const first = async (table: 'levels' | 'subjects', where = '') => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM ${table} ${where} ORDER BY sort_order LIMIT 4`,
    );
    return rows.map((r) => r.id);
  };
  const catalogue = {
    sfax: await governorate('sfax'),
    tunis: await governorate('tunis'),
    levels: await first('levels'),
    subjects: await first('subjects', "WHERE status = 'approved'"),
  };
  if (
    catalogue.sfax.delegations.length < 3 ||
    catalogue.tunis.delegations.length < 3
  ) {
    throw new Error(
      'The test database has no delegations: run npm run db:reset:test',
    );
  }
  return catalogue;
}

/** A complete, valid form: submit-ready. Override anything to break or change it. */
export function completeInput(
  ids: CatalogueIds,
  overrides: Partial<ProfileInput> = {},
): ProfileInput {
  return {
    fullName: 'Wassima Chaaben',
    diploma: 'high_school_teacher',
    experience: '5_10',
    bio: 'Professeure de physique depuis dix ans, je prépare les élèves au baccalauréat.',
    governorateId: ids.sfax.id,
    modes: ['at_home', 'online'],
    levelIds: [ids.levels[0], ids.levels[1]],
    zoneIds: [ids.sfax.delegations[0], ids.sfax.delegations[1]],
    subjects: [{ subjectId: ids.subjects[0], rateMillimes: 25000 }],
    photo: { action: 'keep' },
    ...overrides,
  };
}

export const photoKey = () => `photos/${randomUUID()}.jpg`;
