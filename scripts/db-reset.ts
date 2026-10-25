import { Pool } from 'pg';
import { runMigrations } from '../db/migrate';
import { databaseName, resolveDatabaseUrl } from './db-target';

// Erases everything in the chosen database and rebuilds it from the migrations.
// Safety: refuses to run unless the database name ends with _dev or _test.
async function main() {
  const { url, label } = resolveDatabaseUrl(process.argv.slice(2));
  const name = databaseName(url);

  if (process.env.NODE_ENV === 'production' || !/_(dev|test)$/.test(name)) {
    throw new Error(
      `Refusing to reset "${name}": only databases whose name ends with _dev or _test can be reset.`,
    );
  }

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    const applied = await runMigrations(pool);
    console.log(
      `${label} "${name}" rebuilt. Applied ${applied.length} migration(s).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: Error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
