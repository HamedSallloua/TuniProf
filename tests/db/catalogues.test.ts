import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_DELEGATIONS_CSV,
  parseDelegationsCsv,
} from '@/db/import-delegations';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/lib/db/schema';
import {
  CHECK_VIOLATION,
  createTestPool,
  FOREIGN_KEY_VIOLATION,
  testDatabaseUrl,
  UNIQUE_VIOLATION,
  withRollback,
} from './helpers';

describe.skipIf(!testDatabaseUrl)('catalogues (database)', () => {
  let pool: Pool;

  const scalar = async (sql: string) =>
    (await pool.query(sql)).rows[0].value as string;

  beforeAll(async () => {
    pool = createTestPool();
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('seed data', () => {
    it('has the 24 governorates, with French and Arabic names', async () => {
      expect(
        Number(await scalar('SELECT count(*) AS value FROM governorates')),
      ).toBe(24);
      expect(
        Number(
          await scalar(
            'SELECT count(DISTINCT name_fr) AS value FROM governorates',
          ),
        ),
      ).toBe(24);
      const { rows } = await pool.query(
        "SELECT name_fr, name_ar FROM governorates WHERE slug IN ('sfax', 'tunis') ORDER BY slug",
      );
      expect(rows).toEqual([
        { name_fr: 'Sfax', name_ar: 'صفاقس' },
        { name_fr: 'Tunis', name_ar: 'تونس' },
      ]);
    });

    it('has 16 levels: Primaire 1-6, Préparatoire 7-9, Secondaire 1-4, Université L1-L3', async () => {
      const { rows } = await pool.query(
        'SELECT cycle, count(*)::int AS n, min(grade) AS first, max(grade) AS last FROM levels GROUP BY cycle',
      );
      const byCycle = Object.fromEntries(rows.map((r) => [r.cycle, r]));
      expect(byCycle.primaire).toMatchObject({ n: 6, first: 1, last: 6 });
      expect(byCycle.preparatoire).toMatchObject({ n: 3, first: 7, last: 9 });
      expect(byCycle.secondaire).toMatchObject({ n: 4, first: 1, last: 4 });
      expect(byCycle.universite).toMatchObject({ n: 3, first: 1, last: 3 });
    });

    it('has the 17 listed subjects, all approved', async () => {
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'approved')::int AS approved FROM subjects",
      );
      expect(rows[0]).toEqual({ n: 17, approved: 17 });
      const { rows: names } = await pool.query(
        'SELECT name_fr FROM subjects ORDER BY sort_order',
      );
      expect(names.map((r) => r.name_fr)).toEqual([
        'Anglais',
        'Arabe',
        'Français',
        'Histoire-Géo',
        'Informatique',
        'Mathématiques',
        'Philosophie',
        'Physique',
        'Sciences Naturelles',
        'Économie',
        'Chimie',
        'Allemand',
        'Italien',
        'Espagnol',
        'Technologie',
        'Gestion/Comptabilité',
        'Éveil scientifique',
      ]);
    });

    it('has the 4 plans with the prices of spec 2.1, in millimes', async () => {
      const { rows } = await pool.query(
        `SELECT slug, duration_days, price_visibility_millimes AS visibility,
                price_with_dashboard_millimes AS bundle
         FROM plans ORDER BY sort_order`,
      );
      expect(rows).toEqual([
        {
          slug: 'mensuel',
          duration_days: 30,
          visibility: 15000,
          bundle: 25000,
        },
        {
          slug: 'trimestriel',
          duration_days: 90,
          visibility: 40500,
          bundle: 65000,
        },
        // 72.000, not 90.000: the corrected 20% saving (spec section 0, item 2).
        {
          slug: 'semestriel',
          duration_days: 180,
          visibility: 72000,
          bundle: 111000,
        },
        {
          slug: 'annuel',
          duration_days: 365,
          visibility: 120000,
          bundle: 180000,
        },
      ]);
    });

    it.skipIf(!existsSync(DEFAULT_DELEGATIONS_CSV))(
      'has every délégation of db/data/delegations.csv (run npm run db:reset:test if this fails)',
      async () => {
        const { rows: governorates } = await pool.query(
          'SELECT slug, name_ar FROM governorates',
        );
        const expected = parseDelegationsCsv(
          await readFile(DEFAULT_DELEGATIONS_CSV, 'utf8'),
          governorates,
        );
        expect(
          Number(await scalar('SELECT count(*) AS value FROM delegations')),
        ).toBe(expected.length);
        // Every governorate has at least one délégation.
        expect(
          Number(
            await scalar(
              `SELECT count(*) AS value FROM governorates g
               WHERE NOT EXISTS (SELECT 1 FROM delegations d WHERE d.governorate_id = g.id)`,
            ),
          ),
        ).toBe(0);
      },
    );
  });

  describe('rules enforced by the database', () => {
    const insertPlan = (
      client: import('pg').PoolClient,
      overrides: Record<string, unknown> = {},
    ) => {
      const plan = {
        slug: 'zz-test',
        name_fr: 'Test',
        name_ar: 'اختبار',
        duration_days: 30,
        visibility: 1000,
        bundle: 2000,
        ...overrides,
      };
      return client.query(
        `INSERT INTO plans (slug, name_fr, name_ar, duration_days, price_visibility_millimes, price_with_dashboard_millimes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          plan.slug,
          plan.name_fr,
          plan.name_ar,
          plan.duration_days,
          plan.visibility,
          plan.bundle,
        ],
      );
    };

    it('refuses a plan whose bundle costs less than visibility only', async () => {
      await expect(
        withRollback(pool, (c) =>
          insertPlan(c, { visibility: 5000, bundle: 4000 }),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuses a negative price and a plan with no duration', async () => {
      await expect(
        withRollback(pool, (c) => insertPlan(c, { visibility: -1 })),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(
        withRollback(pool, (c) => insertPlan(c, { duration_days: 0 })),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuses a duplicate slug', async () => {
      await expect(
        withRollback(pool, (c) => insertPlan(c, { slug: 'mensuel' })),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('refuses a badly formed slug and an empty name', async () => {
      await expect(
        withRollback(pool, (c) => insertPlan(c, { slug: 'Not A Slug' })),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(
        withRollback(pool, (c) => insertPlan(c, { name_fr: '   ' })),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuses an unknown level cycle and a duplicate grade in a cycle', async () => {
      const insertLevel = (
        c: import('pg').PoolClient,
        slug: string,
        cycle: string,
        grade: number,
      ) =>
        c.query(
          `INSERT INTO levels (slug, cycle, grade, name_fr, name_ar) VALUES ($1, $2, $3, 'x', 'x')`,
          [slug, cycle, grade],
        );
      await expect(
        withRollback(pool, (c) => insertLevel(c, 'zz-level', 'maternelle', 1)),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(
        withRollback(pool, (c) => insertLevel(c, 'zz-level', 'primaire', 1)),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('refuses an unknown subject status', async () => {
      await expect(
        withRollback(pool, (c) =>
          c.query(
            `INSERT INTO subjects (slug, name_fr, name_ar, status) VALUES ('zz-subject', 'x', 'x', 'maybe')`,
          ),
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuses a délégation without a real governorate, and a duplicate in one governorate', async () => {
      await expect(
        withRollback(pool, (c) =>
          c.query(
            `INSERT INTO delegations (governorate_id, slug, name_fr)
             VALUES (gen_random_uuid(), 'zz-test', 'ZZ')`,
          ),
        ),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });

      await expect(
        withRollback(pool, async (c) => {
          const insert = () =>
            c.query(
              `INSERT INTO delegations (governorate_id, slug, name_fr)
               SELECT id, 'zz-test', 'ZZ' FROM governorates WHERE slug = 'sfax'`,
            );
          await insert();
          await insert();
        }),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('refuses to delete a governorate that still has délégations', async () => {
      await expect(
        withRollback(pool, async (c) => {
          await c.query(
            `INSERT INTO delegations (governorate_id, slug, name_fr)
             SELECT id, 'zz-test', 'ZZ' FROM governorates WHERE slug = 'sfax'`,
          );
          await c.query("DELETE FROM governorates WHERE slug = 'sfax'");
        }),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });

    it('moves updated_at forward on every update', async () => {
      await withRollback(pool, async (c) => {
        await c.query(
          `UPDATE plans SET name_fr = 'Mensuel bis' WHERE slug = 'mensuel'`,
        );
        const { rows } = await c.query(
          `SELECT updated_at > created_at AS moved FROM plans WHERE slug = 'mensuel'`,
        );
        expect(rows[0].moved).toBe(true);
      });
    });
  });

  describe('Drizzle schema matches the database', () => {
    const tables = Object.values(schema).filter((value) =>
      is(value, PgTable),
    ) as PgTable[];

    it('covers the five catalogue tables', () => {
      expect(tables.map((t) => getTableName(t)).sort()).toEqual([
        'delegations',
        'governorates',
        'levels',
        'plans',
        'subjects',
      ]);
    });

    it.each(tables.map((t) => [getTableName(t), t] as const))(
      '%s: same columns and nullability',
      async (name, table) => {
        const { rows } = await pool.query(
          `SELECT column_name, is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1`,
          [name],
        );
        const inDatabase = Object.fromEntries(
          rows.map((r) => [r.column_name, r.is_nullable === 'NO']),
        );
        const inDrizzle = Object.fromEntries(
          Object.values(getTableColumns(table)).map((c) => [c.name, c.notNull]),
        );
        expect(inDrizzle).toEqual(inDatabase);
      },
    );
  });
});
