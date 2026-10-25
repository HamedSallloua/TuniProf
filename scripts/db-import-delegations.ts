import path from 'node:path';
import { Pool } from 'pg';
import {
  DEFAULT_DELEGATIONS_CSV,
  importDelegationsFile,
} from '../db/import-delegations';
import { resolveDatabaseUrl } from './db-target';

// Usage: npm run db:import:delegations [-- path/to/file.csv] [-- --test]
async function main() {
  const args = process.argv.slice(2);
  const { url, label } = resolveDatabaseUrl(args);
  const fileArg = args.find((arg) => !arg.startsWith('--'));
  const filePath = fileArg ? path.resolve(fileArg) : DEFAULT_DELEGATIONS_CSV;

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const perGovernorate = await importDelegationsFile(client, filePath);
    await client.query('COMMIT');

    const total = [...perGovernorate.values()].reduce((a, b) => a + b, 0);
    console.log(`${label}: imported ${total} délégations from ${filePath}`);
    for (const [slug, count] of [...perGovernorate].sort()) {
      console.log(`  ${slug}: ${count}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: Error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
