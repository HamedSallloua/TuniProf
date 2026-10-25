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

// Placeholder: the teacher space itself (profile, banner, subscription) comes in M3 and M4.
export default async function TeacherSpacePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requirePermission('teacher:space', locale as Locale);
  const t = await getTranslations('auth.space');

  return (
    <AuthCard title={t('teacherTitle')}>
      <p>
        {t.rich('hello', {
          phone: `+216 ${formatNationalPhone(user.phone)}`,
          num: numTag,
        })}
      </p>
      <p className="mt-3 text-muted">{t('soon')}</p>
      <form action={logoutAction} className="mt-6">
        <button type="submit" className={secondaryButtonClass}>
          {t('logout')}
        </button>
      </form>
    </AuthCard>
  );
}
