import type { Queryable } from '@/lib/db/transaction';

// Reads of the `settings` table used by the billing module. Values are JSON; a missing or
// wrongly typed value falls back to a safe default instead of breaking a page.

export async function getSettings(
  db: Queryable,
  keys: string[],
): Promise<Map<string, unknown>> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    'SELECT key, value FROM settings WHERE key = ANY($1)',
    [keys],
  );
  return new Map(rows.map((row) => [row.key, row.value]));
}

const str = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

export type PaymentSettings = {
  /** The owner has replaced the placeholders with real account details. */
  configured: boolean;
  beneficiaryName: string;
  flouciNumber: string;
  d17Info: string;
  ccpNumber: string;
  workingHours: string;
  /** Digits with country code, for wa.me links. */
  whatsappNumber: string;
  messengerPage: string;
  /** Arabic helper lines, word for word from the owner's brief. Empty until provided. */
  helperLinesAr: string[];
};

export async function getPaymentSettings(
  db: Queryable,
): Promise<PaymentSettings> {
  const s = await getSettings(db, [
    'payment.configured',
    'payment.beneficiary_name',
    'payment.flouci_number',
    'payment.d17_info',
    'payment.ccp_number',
    'payment.working_hours',
    'payment.whatsapp_number',
    'payment.messenger_page',
    'payment.helper_lines_ar',
  ]);
  const lines = s.get('payment.helper_lines_ar');
  return {
    configured: s.get('payment.configured') === true,
    beneficiaryName: str(s.get('payment.beneficiary_name')),
    flouciNumber: str(s.get('payment.flouci_number')),
    d17Info: str(s.get('payment.d17_info')),
    ccpNumber: str(s.get('payment.ccp_number')),
    workingHours: str(s.get('payment.working_hours')),
    whatsappNumber: str(s.get('payment.whatsapp_number')).replace(/\D/g, ''),
    messengerPage: str(s.get('payment.messenger_page')),
    helperLinesAr: Array.isArray(lines)
      ? lines.filter((l): l is string => typeof l === 'string')
      : [],
  };
}

/**
 * Payment instructions are shown when the owner has configured real details. In
 * development the fake placeholders are shown too, so the screens can be tried.
 */
export function paymentsAvailable(
  settings: Pick<PaymentSettings, 'configured'>,
): boolean {
  return settings.configured || process.env.NODE_ENV !== 'production';
}

export async function getNumberSetting(
  db: Queryable,
  key: string,
  fallback: number,
): Promise<number> {
  const value = (await getSettings(db, [key])).get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
