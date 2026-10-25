import type { Metadata } from 'next';
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db/client';
import { formatNationalPhone } from '@/lib/phone';
import { listReviewQueue } from '@/lib/profile/review';

export const metadata: Metadata = { robots: { index: false } };

export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ flash?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  await requirePermission('admin:panel', locale as Locale);
  const { flash } = await searchParams;

  const t = await getTranslations('admin');
  const format = await getFormatter();
  const queue = await listReviewQueue(getPool());

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/admin"
            className="text-primary underline underline-offset-2"
          >
            {t('title')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">{t('queueTitle')}</h1>
      </header>

      {flash &&
        ['approved', 'rejected', 'versionApproved', 'versionRejected'].includes(
          flash,
        ) && (
          <p
            role="status"
            className="rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
          >
            {t(`flash.${flash}` as 'flash.approved')}
          </p>
        )}

      {queue.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-5 text-muted">
          {t('queueEmpty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {queue.map((item) => (
            <li
              key={item.userId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4"
            >
              <div className="space-y-1">
                <p className="font-semibold">
                  {item.fullName ?? t('unnamed')}{' '}
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-primary">
                    {t(`kind.${item.kind}`)}
                  </span>
                </p>
                <p className="text-sm text-muted">
                  <bdi dir="ltr">+216 {formatNationalPhone(item.phone)}</bdi>
                  {item.governorateName ? ` - ${item.governorateName}` : ''}
                </p>
                {item.submittedAt && (
                  <p className="text-sm text-muted">
                    {t('columns.since')} :{' '}
                    {format.dateTime(item.submittedAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                )}
              </div>
              <Link
                href={`/admin/profils/${item.userId}`}
                className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-accent"
              >
                {t('open')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
