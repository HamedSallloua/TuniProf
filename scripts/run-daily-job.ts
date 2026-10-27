import { Pool } from 'pg';
import { runDailyJob } from '../lib/billing/jobs';
import { resolveDatabaseUrl } from './db-target';

// Local stand-in for the host's cron: npm run job:daily [-- --test]
async function main() {
  const { url, label } = resolveDatabaseUrl(process.argv.slice(2));
  const pool = new Pool({ connectionString: url });
  try {
    console.log(`${label}:`, JSON.stringify(await runDailyJob(pool)));
  } finally {
    await pool.end();
  }
}

main().catch((error: Error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
