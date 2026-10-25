// Chooses which database the db:* scripts talk to.
// Default: DATABASE_URL (development). With --test: TEST_DATABASE_URL.
export function resolveDatabaseUrl(args: string[]): {
  url: string;
  label: string;
} {
  const useTest = args.includes('--test');
  const name = useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
  const url = process.env[name];
  if (!url) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return { url, label: useTest ? 'Test database' : 'Development database' };
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}
