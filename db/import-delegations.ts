import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { parseCsv } from '@/lib/csv';
import { slugify } from '@/lib/slug';

export const DEFAULT_DELEGATIONS_CSV = path.join(
  process.cwd(),
  'db',
  'data',
  'delegations.csv',
);

export type GovernorateRef = { slug: string; name_ar: string };

export type DelegationRow = {
  governorateSlug: string;
  slug: string;
  nameFr: string;
  nameAr: string | null;
};

/**
 * Reads the owner's CSV. Expected header (any order, extra columns ignored):
 *   governorate;name_fr;name_ar
 * - governorate: the governorate name in French (or Arabic) or its slug, e.g. "Ben Arous".
 * - name_fr: the délégation name in French (required).
 * - name_ar: the délégation name in Arabic (optional).
 * Every problem is collected and reported at once, with its line number.
 */
export function parseDelegationsCsv(
  text: string,
  governorates: GovernorateRef[],
): DelegationRow[] {
  const table = parseCsv(text);
  if (table.length === 0) throw new Error('The CSV file is empty.');

  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const column = (name: string) => header.indexOf(name);
  const govCol = column('governorate');
  const frCol = column('name_fr');
  const arCol = column('name_ar');
  if (govCol === -1 || frCol === -1) {
    throw new Error(
      `The CSV header must contain "governorate" and "name_fr" (and optionally "name_ar"). Found: ${table[0].join(' | ')}`,
    );
  }

  const bySlug = new Set(governorates.map((g) => g.slug));
  const byArabicName = new Map(governorates.map((g) => [g.name_ar, g.slug]));

  const errors: string[] = [];
  const rows: DelegationRow[] = [];
  const seen = new Map<string, number>();

  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const govText = (cells[govCol] ?? '').trim();
    const nameFr = (cells[frCol] ?? '').trim();
    const nameAr = arCol === -1 ? '' : (cells[arCol] ?? '').trim();

    const governorateSlug = bySlug.has(slugify(govText))
      ? slugify(govText)
      : byArabicName.get(govText);
    if (!governorateSlug) {
      errors.push(`Line ${line}: unknown governorate "${govText}".`);
      return;
    }
    if (nameFr === '') {
      errors.push(`Line ${line}: name_fr is empty.`);
      return;
    }
    const slug = slugify(nameFr);
    if (slug === '') {
      errors.push(`Line ${line}: "${nameFr}" cannot be turned into a slug.`);
      return;
    }
    const key = `${governorateSlug}/${slug}`;
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      errors.push(
        `Line ${line}: "${nameFr}" duplicates line ${firstLine} (same governorate, same slug "${slug}").`,
      );
      return;
    }
    seen.set(key, line);
    rows.push({
      governorateSlug,
      slug,
      nameFr,
      nameAr: nameAr === '' ? null : nameAr,
    });
  });

  if (errors.length > 0) {
    throw new Error(
      `The CSV has ${errors.length} problem(s), nothing was imported:\n  ${errors.join('\n  ')}`,
    );
  }
  if (rows.length === 0) throw new Error('The CSV has a header but no data.');
  return rows;
}

/**
 * Inserts the rows, or updates names of rows that already exist (same governorate and slug).
 * Safe to run twice. The caller owns the transaction (BEGIN / COMMIT).
 * It is meant for the first load: running it again overwrites names edited in the admin panel.
 */
export async function importDelegations(
  client: PoolClient,
  rows: DelegationRow[],
): Promise<void> {
  await client.query(
    `INSERT INTO delegations (governorate_id, slug, name_fr, name_ar)
     SELECT g.id, d.slug, d.name_fr, d.name_ar
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
          AS d(governorate_slug, slug, name_fr, name_ar)
     JOIN governorates g ON g.slug = d.governorate_slug
     ON CONFLICT (governorate_id, slug)
     DO UPDATE SET name_fr = EXCLUDED.name_fr, name_ar = EXCLUDED.name_ar`,
    [
      rows.map((r) => r.governorateSlug),
      rows.map((r) => r.slug),
      rows.map((r) => r.nameFr),
      rows.map((r) => r.nameAr),
    ],
  );
}

/** Reads a CSV file and imports it. Returns the number of rows per governorate. */
export async function importDelegationsFile(
  client: PoolClient,
  filePath: string = DEFAULT_DELEGATIONS_CSV,
): Promise<Map<string, number>> {
  const text = await readFile(filePath, 'utf8');
  const { rows: governorates } = await client.query<GovernorateRef>(
    'SELECT slug, name_ar FROM governorates',
  );
  const rows = parseDelegationsCsv(text, governorates);
  await importDelegations(client, rows);

  const perGovernorate = new Map<string, number>();
  for (const row of rows) {
    perGovernorate.set(
      row.governorateSlug,
      (perGovernorate.get(row.governorateSlug) ?? 0) + 1,
    );
  }
  return perGovernorate;
}
