import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AuthCard } from '@/components/auth/AuthCard';
import { LoginForm } from '@/components/auth/forms';
import { linkClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = { robots: { index: false } };

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reset?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const { reset } = await searchParams;
  const t = await getTranslations('auth.login');

  return (
    <AuthCard title={t('title')}>
      {reset === '1' && (
        <p
          role="status"
          className="mb-5 rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
        >
          {t('resetDone')}
        </p>
      )}
      <LoginForm />
      <ul className="mt-6 space-y-2 text-sm">
        <li>
          <Link href="/mot-de-passe-oublie" className={linkClass}>
            {t('forgot')}
          </Link>
        </li>
        <li className="text-muted">
          {t('noAccount')}{' '}
          <Link href="/inscription" className={linkClass}>
            {t('signupLink')}
          </Link>
        </li>
        <li>
          <Link href="/connexion-avis" className={linkClass}>
            {t('reviewerLink')}
          </Link>
        </li>
      </ul>
    </AuthCard>
  );
}
