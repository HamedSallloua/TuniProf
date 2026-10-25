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
    // Database tests share one test database and some empty the auth tables.
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
    // Fixed values so tests never depend on the owner's private settings.
    env: {
      AUTH_SECRET: 'test-only-secret-not-used-anywhere-else-0123456789',
      VERIFICATION_PROVIDER: 'dev-stub',
      WHATSAPP_PLATFORM_NUMBER: '21600000001',
      WHATSAPP_APP_SECRET: 'test-app-secret',
      WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    },
  },
});
