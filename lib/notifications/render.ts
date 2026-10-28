import { createTranslator } from 'next-intl';
import ar from '@/messages/ar.json';
import fr from '@/messages/fr.json';
import { BRAND_NAME } from '@/lib/brand';
import type { NotificationKind, NotificationParams } from './kinds';

// The text of a message, written when it is shown or sent (not stored), from the same
// message files as the rest of the site. Works outside a page too: the daily job uses it for
// e-mails, and the admin screen for the WhatsApp copy-paste text.

type Locale = 'fr' | 'ar';
const MESSAGES = { fr, ar } as const;

function translator(locale: Locale) {
  // The key names are checked by the tests (every kind, both languages), not by the types.
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
  }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

function formatDate(value: unknown, locale: Locale): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'Africa/Tunis',
  }).format(date);
}

export type RenderedNotification = { title: string; body: string };

export function renderNotification(
  kind: NotificationKind,
  params: NotificationParams,
  locale: Locale,
): RenderedNotification {
  const t = translator(locale);

  // Everything that is a code or a date in the stored values becomes readable text here.
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) values[key] = value;
  }
  if (params.date) values.date = formatDate(params.date, locale);
  if (params.reason) {
    const label = t(`profile.reasons.${params.reason}`);
    values.detail = params.note ? `${label} (${params.note})` : label;
  }
  values.brand = BRAND_NAME;

  return {
    title: t(`notifications.kinds.${kind}.title`, values),
    body: t(`notifications.kinds.${kind}.body`, values),
  };
}

/** A complete message for WhatsApp or e-mail: greeting, text, signature. */
export function renderMessage(
  kind: NotificationKind,
  params: NotificationParams,
  locale: Locale,
): { subject: string; text: string } {
  const t = translator(locale);
  const { title, body } = renderNotification(kind, params, locale);
  const greeting = params.name
    ? t('notifications.greeting', { name: String(params.name) })
    : t('notifications.greetingNoName');
  const signoff = t('notifications.signoff', { brand: BRAND_NAME });
  return { subject: title, text: `${greeting}\n\n${body}\n\n${signoff}` };
}
