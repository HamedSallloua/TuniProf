import { z } from 'zod';

const databaseUrlSchema = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must start with postgresql://');

// Read lazily (not at import time) so `npm run build` works without a database.
export function getDatabaseUrl(): string {
  const parsed = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
  if (!parsed.success) {
    throw new Error(
      'DATABASE_URL is missing or invalid. Copy .env.example to .env.local and fill it in.',
    );
  }
  return parsed.data;
}
