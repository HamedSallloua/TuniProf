import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Load the private values (TEST_DATABASE_URL) when running on the owner's machine.
// In CI the variables come from the workflow, and the file does not exist.
try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: fine
}

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
