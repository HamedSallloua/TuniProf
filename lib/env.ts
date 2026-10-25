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
