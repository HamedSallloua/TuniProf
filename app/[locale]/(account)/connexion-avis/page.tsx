import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AuthCard } from '@/components/auth/AuthCard';
import { PhoneOnlyForm } from '@/components/auth/forms';
import { linkClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = { robots: { index: false } };

export default async function ReviewerLoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('auth.reviewer');

  return (
    <AuthCard title={t('title')} intro={t('intro')}>
      <PhoneOnlyForm kind="reviewer" />
      <p className="mt-6 text-sm">
        <Link href="/connexion" className={linkClass}>
          {t('back')}
        </Link>
      </p>
    </AuthCard>
  );
}
