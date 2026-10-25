import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AuthCard } from '@/components/auth/AuthCard';
import { SignUpForm } from '@/components/auth/forms';
import { linkClass } from '@/components/auth/ui';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = { robots: { index: false } };

export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('auth.signup');

  return (
    <AuthCard title={t('title')} intro={t('intro')}>
      <SignUpForm />
      <p className="mt-6 text-sm text-muted">
        {t('haveAccount')}{' '}
        <Link href="/connexion" className={linkClass}>
          {t('loginLink')}
        </Link>
      </p>
    </AuthCard>
  );
}
