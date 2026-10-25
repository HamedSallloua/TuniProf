import { Pool } from 'pg';
import { runMigrations } from '../db/migrate';
import { resolveDatabaseUrl } from './db-target';

async function main() {
  const { url, label } = resolveDatabaseUrl(process.argv.slice(2));
  const pool = new Pool({ connectionString: url });
  try {
    const applied = await runMigrations(pool);
    if (applied.length === 0) {
      console.log(`${label}: already up to date.`);
    } else {
      console.log(`${label}: applied ${applied.length} migration(s):`);
      for (const name of applied) console.log(`  - ${name}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: Error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
