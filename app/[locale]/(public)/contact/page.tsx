import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { BRAND_NAME } from '@/lib/brand';
import { getPool } from '@/lib/db/client';
import {
  contactAvailable,
  getContactSettings,
} from '@/lib/marketplace/contact';
import { alternatesFor } from '@/lib/site-url';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: 'pages.contact',
  });
  return {
    title: t('metaTitle', { brand: BRAND_NAME }),
    alternates: alternatesFor(locale, '/contact'),
  };
}

export default async function ContactPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('pages.contact');
  const contact = await getContactSettings(getPool());
  const available = contactAvailable(contact);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-primary">{t('title')}</h1>
      <p className="text-lg text-muted">{t('intro', { brand: BRAND_NAME })}</p>

      {available ? (
        <div className="space-y-3 rounded-card border border-border bg-surface p-5">
          {!contact.configured && (
            <p role="note" className="text-sm text-accent">
              {t('devPlaceholder')}
            </p>
          )}
          <p className="font-medium">{t('email')}</p>
          <a
            href={`mailto:${contact.email}`}
            dir="ltr"
            className="inline-block text-start text-primary underline underline-offset-2 hover:text-accent"
          >
            {contact.email}
          </a>
          {contact.workingHours && (
            <p className="text-muted">
              {t('hours', { hours: contact.workingHours })}
            </p>
          )}
        </div>
      ) : (
        <p className="text-muted">{t('pending')}</p>
      )}
    </div>
  );
}
