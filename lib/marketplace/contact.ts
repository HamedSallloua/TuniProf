import { getSettings } from '@/lib/billing/settings';
import type { Queryable } from '@/lib/db/transaction';

// The contact details of the platform, from the settings. Like the payment details, the
// value is a placeholder until the owner sends the real address; in production it stays
// hidden while `contact.configured` is false.

export type ContactSettings = {
  configured: boolean;
  email: string;
  workingHours: string;
};

export async function getContactSettings(
  db: Queryable,
): Promise<ContactSettings> {
  const s = await getSettings(db, [
    'contact.configured',
    'contact.email',
    'payment.working_hours',
  ]);
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    configured: s.get('contact.configured') === true,
    email: text(s.get('contact.email')),
    workingHours: text(s.get('payment.working_hours')),
  };
}

export function contactAvailable(
  settings: Pick<ContactSettings, 'configured' | 'email'>,
): boolean {
  return (
    settings.email !== '' &&
    (settings.configured || process.env.NODE_ENV !== 'production')
  );
}
