import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  importDelegations,
  parseDelegationsCsv,
} from '@/db/import-delegations';
import { runMigrations } from '@/db/migrate';
import { createTestPool, testDatabaseUrl, withRollback } from './helpers';

const governorates = [
  { slug: 'tunis', name_ar: 'تونس' },
  { slug: 'ben-arous', name_ar: 'بن عروس' },
];

describe('parseDelegationsCsv', () => {
  it('reads rows, resolving the governorate by French name, slug or Arabic name', () => {
    const csv = [
      'governorate;name_fr;name_ar',
      'Tunis;Bab Souika;باب سويقة',
      'ben-arous;Radès;',
      'بن عروس;Mégrine;المقرين',
    ].join('\n');

    expect(parseDelegationsCsv(csv, governorates)).toEqual([
      {
        governorateSlug: 'tunis',
        slug: 'bab-souika',
        nameFr: 'Bab Souika',
        nameAr: 'باب سويقة',
      },
      {
        governorateSlug: 'ben-arous',
        slug: 'rades',
        nameFr: 'Radès',
        nameAr: null,
      },
      {
        governorateSlug: 'ben-arous',
        slug: 'megrine',
        nameFr: 'Mégrine',
        nameAr: 'المقرين',
      },
    ]);
  });

  it('works without a name_ar column', () => {
    const rows = parseDelegationsCsv(
      'governorate,name_fr\nTunis,Carthage',
      governorates,
    );
    expect(rows[0]).toMatchObject({ slug: 'carthage', nameAr: null });
  });

  it('reports every problem at once, with line numbers, and imports nothing', () => {
    const csv = [
      'governorate;name_fr',
      'Atlantis;Nowhere',
      'Tunis;',
      'Tunis;Carthage',
      'Tunis;carthage',
    ].join('\n');

    expect(() => parseDelegationsCsv(csv, governorates)).toThrow(
      /3 problem\(s\)[\s\S]*Line 2: unknown governorate "Atlantis"[\s\S]*Line 3: name_fr is empty[\s\S]*Line 5: "carthage" duplicates line 4/,
    );
  });

  it('allows the same délégation name in two different governorates', () => {
    const csv =
      'governorate;name_fr\nTunis;Centre Ville\nBen Arous;Centre Ville';
    expect(parseDelegationsCsv(csv, governorates)).toHaveLength(2);
  });

  it('explains a wrong header', () => {
    expect(() =>
      parseDelegationsCsv('city;name\nTunis;X', governorates),
    ).toThrow(/header must contain "governorate" and "name_fr"/);
  });

  it('refuses an empty file or a file with only a header', () => {
    expect(() => parseDelegationsCsv('', governorates)).toThrow(/empty/);
    expect(() =>
      parseDelegationsCsv('governorate;name_fr', governorates),
    ).toThrow(/no data/);
  });
});

describe.skipIf(!testDatabaseUrl)('importDelegations (database)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  const rows = [
    {
      governorateSlug: 'tunis',
      slug: 'zz-test-alpha',
      nameFr: 'ZZ Test Alpha',
      nameAr: null,
    },
    {
      governorateSlug: 'sfax',
      slug: 'zz-test-alpha',
      nameFr: 'ZZ Test Alpha',
      nameAr: 'ألفا',
    },
  ];

  it('inserts rows, is safe to run twice, and updates names', async () => {
    await withRollback(pool, async (client) => {
      const count = async () =>
        Number(
          (
            await client.query(
              "SELECT count(*) FROM delegations WHERE slug = 'zz-test-alpha'",
            )
          ).rows[0].count,
        );

      await importDelegations(client, rows);
      expect(await count()).toBe(2);

      await importDelegations(client, rows);
      expect(await count()).toBe(2);

      await importDelegations(client, [{ ...rows[0], nameFr: 'ZZ Renamed' }]);
      const { rows: names } = await client.query(
        `SELECT d.name_fr FROM delegations d JOIN governorates g ON g.id = d.governorate_id
         WHERE d.slug = 'zz-test-alpha' AND g.slug = 'tunis'`,
      );
      expect(names[0].name_fr).toBe('ZZ Renamed');
    });
  });
});
