import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { numTag } from '@/components/auth/num-tag';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db/client';
import { formatNationalPhone } from '@/lib/phone';
import { listPaymentRequests } from '@/lib/billing/payments';
import { listReviewQueue } from '@/lib/profile/review';
import { countPendingWhatsApp } from '@/lib/notifications/deliver';
import { listModerationQueue } from '@/lib/reviews/moderation';
import { logoutAction } from '../../(account)/actions';

export const metadata: Metadata = { robots: { index: false } };

// The rest of the admin panel (payments, catalogues, moderation) comes in M4 and M11.
export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requirePermission('admin:panel', locale as Locale);
  const t = await getTranslations('auth.space');
  const ta = await getTranslations('admin');
  const tp = await getTranslations('adminPayments');
  const tr = await getTranslations('adminReviews');
  const tn = await getTranslations('adminNotifications');
  const waiting = (await listReviewQueue(getPool())).length;
  const openPayments = (await listPaymentRequests(getPool(), 'open')).length;
  const whatsAppToSend = await countPendingWhatsApp(getPool());
  const reviewQueue = await listModerationQueue(getPool());
  const reviewsToDo = reviewQueue.pending.length + reviewQueue.reported.length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-bold text-primary">{ta('title')}</h1>
        <p className="mt-1 text-sm text-muted">
          {t.rich('hello', {
            phone: `+216 ${formatNationalPhone(user.phone)}`,
            num: numTag,
          })}{' '}
          {t('role', {
            role:
              user.role === 'admin_super'
                ? t('roleAdminSuper')
                : t('roleAdminSupport'),
          })}
        </p>
      </header>

      <p className="flex flex-wrap gap-3">
        <Link href="/admin/profils" className={buttonClass}>
          {ta('queueLink')} ({waiting})
        </Link>
        <Link href="/admin/paiements" className={buttonClass}>
          {tp('link')} ({openPayments})
        </Link>
        <Link href="/admin/avis" className={buttonClass}>
          {tr('link')} ({reviewsToDo})
        </Link>
        <Link href="/admin/messages" className={buttonClass}>
          {tn('link')} ({whatsAppToSend})
        </Link>
      </p>

      <form action={logoutAction}>
        <button type="submit" className={secondaryButtonClass}>
          {t('logout')}
        </button>
      </form>
    </div>
  );
}
