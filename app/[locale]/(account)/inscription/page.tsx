import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AuthCard } from '@/components/auth/AuthCard';
import { SignUpForm } from '@/components/auth/forms';
import { linkClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import { getFoundingSlots } from '@/lib/billing/founding';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

// The number of founding places left changes with every approval: never cached.
export const dynamic = 'force-dynamic';

export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('auth.signup');
  const founding = await getFoundingSlots(getPool());

  return (
    <AuthCard title={t('title')} intro={t('intro')}>
      {founding.left > 0 && (
        <p
          role="note"
          className="mb-5 rounded-md border border-primary bg-secondary p-3 text-sm font-medium text-primary"
        >
          {t('founding', { count: founding.left })}
        </p>
      )}
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
