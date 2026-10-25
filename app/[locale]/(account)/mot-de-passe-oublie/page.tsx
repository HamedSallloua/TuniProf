import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AuthCard } from '@/components/auth/AuthCard';
import { PhoneOnlyForm } from '@/components/auth/forms';

export const metadata: Metadata = { robots: { index: false } };

export default async function ResetRequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('auth.reset');

  return (
    <AuthCard title={t('title')} intro={t('intro')}>
      <PhoneOnlyForm kind="reset" />
    </AuthCard>
  );
}
