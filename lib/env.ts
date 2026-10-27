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

/** Secret used to hash codes, devices and addresses. At least 32 characters. */
export function getAuthSecret(): string {
  const parsed = z.string().min(32).safeParse(process.env.AUTH_SECRET);
  if (!parsed.success) {
    throw new Error(
      'AUTH_SECRET is missing or shorter than 32 characters. Copy .env.example to .env.local and set it.',
    );
  }
  return parsed.data;
}

/** Secret the host's cron sends to run the daily job. Without it the job endpoint is off. */
export function getCronSecret(): string {
  const parsed = z.string().min(16).safeParse(process.env.CRON_SECRET);
  if (!parsed.success)
    throw new Error('CRON_SECRET is missing or shorter than 16 characters.');
  return parsed.data;
}

export type VerificationProviderName = 'dev-stub' | 'whatsapp';

/**
 * Which WhatsApp provider is active. The dev stub can never run in production:
 * in production the answer is always 'whatsapp', whatever the variable says.
 */
export function getVerificationProviderName(): VerificationProviderName {
  if (process.env.NODE_ENV === 'production') return 'whatsapp';
  return process.env.VERIFICATION_PROVIDER === 'whatsapp'
    ? 'whatsapp'
    : 'dev-stub';
}

/** Values of the Meta WhatsApp Cloud API setup (spec 13.2). Only needed by the real provider. */
export function getWhatsAppConfig() {
  const parsed = z
    .object({
      WHATSAPP_PLATFORM_NUMBER: z.string().regex(/^\d{8,15}$/),
      WHATSAPP_APP_SECRET: z.string().min(8),
      WHATSAPP_VERIFY_TOKEN: z.string().min(8),
    })
    .safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      'WhatsApp is not configured: set WHATSAPP_PLATFORM_NUMBER (digits only, with country code), WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN.',
    );
  }
  return {
    platformNumber: parsed.data.WHATSAPP_PLATFORM_NUMBER,
    appSecret: parsed.data.WHATSAPP_APP_SECRET,
    verifyToken: parsed.data.WHATSAPP_VERIFY_TOKEN,
  };
}

/** Public address of the site, without a trailing slash: canonical links and the sitemap. */
export function getSiteUrl(): string {
  const fromEnv = process.env.SITE_URL?.trim().replace(/\/+$/, '');
  if (fromEnv && /^https?:\/\//.test(fromEnv)) return fromEnv;
  return process.env.NODE_ENV === 'production'
    ? 'https://tuniprof.tn'
    : 'http://localhost:3000';
}

// Cloudflare publishes keys that always pass, for development (they never run in production).
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

/**
 * Cloudflare Turnstile keys (spec 3.4). In development the always-pass test keys are used
 * when none are set. In production without keys this returns null and the check fails
 * closed: nobody can pass it, so a bot cannot get past the reveal limit.
 */
export function getTurnstileConfig(): {
  siteKey: string;
  secretKey: string;
} | null {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (siteKey && secretKey) return { siteKey, secretKey };
  if (process.env.NODE_ENV === 'production') return null;
  return {
    siteKey: TURNSTILE_TEST_SITE_KEY,
    secretKey: TURNSTILE_TEST_SECRET_KEY,
  };
}
