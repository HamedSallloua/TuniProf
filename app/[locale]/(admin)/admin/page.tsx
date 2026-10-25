import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard } from '@/components/auth/AuthCard';
import { numTag } from '@/components/auth/num-tag';
import { secondaryButtonClass } from '@/components/auth/ui';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { formatNationalPhone } from '@/lib/phone';
import { logoutAction } from '../../(account)/actions';

export const metadata: Metadata = { robots: { index: false } };

// Placeholder: the review queue comes in M3, payments in M4, the rest in M11.
export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requirePermission('admin:panel', locale as Locale);
  const t = await getTranslations('auth.space');

  return (
    <AuthCard title={t('adminTitle')}>
      <p>
        {t.rich('hello', {
          phone: `+216 ${formatNationalPhone(user.phone)}`,
          num: numTag,
        })}
      </p>
      <p className="mt-2 text-muted">
        {t('role', {
          role:
            user.role === 'admin_super'
              ? t('roleAdminSuper')
              : t('roleAdminSupport'),
        })}
      </p>
      <form action={logoutAction} className="mt-6">
        <button type="submit" className={secondaryButtonClass}>
          {t('logout')}
        </button>
      </form>
    </AuthCard>
  );
}
