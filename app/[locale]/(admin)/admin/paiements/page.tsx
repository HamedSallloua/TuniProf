import type { Metadata } from 'next';
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { listPaymentRequests } from '@/lib/billing/payments';
import { getPool } from '@/lib/db/client';
import { formatMillimes } from '@/lib/money';
import { formatNationalPhone } from '@/lib/phone';

export const metadata: Metadata = { robots: { index: false } };

export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  await requirePermission('admin:panel', locale as Locale);
  const { all } = await searchParams;

  const t = await getTranslations('adminPayments');
  const ts = await getTranslations('subscription');
  const ta = await getTranslations('admin');
  const format = await getFormatter();
  const showAll = all === '1';
  const requests = await listPaymentRequests(
    getPool(),
    showAll ? 'all' : 'open',
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/admin"
            className="text-primary underline underline-offset-2"
          >
            {ta('title')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
        <p className="text-sm">
          <Link
            href={
              showAll
                ? '/admin/paiements'
                : { pathname: '/admin/paiements', query: { all: '1' } }
            }
            className="text-primary underline underline-offset-2"
          >
            {showAll ? t('showOpen') : t('showAll')}
          </Link>
        </p>
      </header>

      {requests.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-5 text-muted">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4"
            >
              <div className="space-y-1">
                <p className="font-semibold">
                  <bdi dir="ltr">{r.reference}</bdi> -{' '}
                  {r.teacherName ?? t('unnamed')}{' '}
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-primary">
                    {ts(`requestStatus.${r.status}`)}
                  </span>
                </p>
                <p className="text-sm text-muted">
                  <bdi dir="ltr">
                    +216 {formatNationalPhone(r.teacherPhone)}
                  </bdi>{' '}
                  - {r.planNameFr}
                  {r.withDashboard
                    ? ` (${ts('request.withDashboard')})`
                    : ''} - {t(`kind.${r.kind}`)} - {ts(`methods.${r.method}`)}
                </p>
                <p className="text-sm text-muted">
                  <bdi dir="ltr">
                    {formatMillimes(r.amountMillimes, locale)}
                  </bdi>{' '}
                  -{' '}
                  {format.dateTime(r.createdAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
              <Link
                href={`/admin/paiements/${r.id}`}
                className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-accent"
              >
                {ta('open')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
