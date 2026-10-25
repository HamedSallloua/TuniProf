import { Writable } from 'node:stream';
import readline from 'node:readline';
import { Pool } from 'pg';
import { createAdmin, type AdminRole } from '../lib/auth/admin';
import { passwordSchema } from '../lib/auth/password';
import { normalizePhone } from '../lib/phone';
import { resolveDatabaseUrl } from './db-target';

// Usage: npm run admin:create -- --role=admin_super [--test]
// Asks for the phone number and the password (typed hidden). Nothing is stored in a file.

let muted = false;
const output = new Writable({
  write(chunk, encoding, done) {
    if (!muted) process.stdout.write(chunk, encoding);
    done();
  },
});
const rl = readline.createInterface({
  input: process.stdin,
  output,
  terminal: true,
});

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      muted = false;
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const roleArg = args.find((a) => a.startsWith('--role='))?.slice(7);
  if (roleArg !== 'admin_super' && roleArg !== 'admin_support') {
    throw new Error(
      'Add --role=admin_super (can change prices and settings) or --role=admin_support.',
    );
  }
  const role: AdminRole = roleArg;

  const { url, label } = resolveDatabaseUrl(args);

  const phone = normalizePhone(
    await ask('Phone number (8 digits, e.g. 22 345 678): '),
  );
  if (!phone) throw new Error('That is not a valid Tunisian mobile number.');

  const password = await ask(
    'Password (at least 8 characters, hidden): ',
    true,
  );
  const checked = passwordSchema(phone).safeParse(password);
  if (!checked.success)
    throw new Error(`Password refused: ${checked.error.issues[0].message}`);
  if ((await ask('Type the password again: ', true)) !== password) {
    throw new Error('The two passwords are not the same.');
  }

  const pool = new Pool({ connectionString: url });
  try {
    const result = await createAdmin(pool, { phone, role, password });
    if (!result.ok)
      throw new Error(
        `An account already exists for ${phone}. Nothing was changed.`,
      );
    console.log(
      `${label}: ${role} account created for ${phone}. Sign in at /connexion.`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .catch((error: Error) => {
    console.error(`\nError: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
