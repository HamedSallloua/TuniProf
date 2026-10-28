import type { Metadata } from 'next';
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import { numTag } from '@/components/auth/num-tag';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';
import { RatingStars } from '@/components/marketplace/RatingStars';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db/client';
import { formatNationalPhone } from '@/lib/phone';
import {
  listModerationQueue,
  type ModerationAction,
  type ModerationItem,
} from '@/lib/reviews/moderation';
import { moderateReviewAction } from '../../moderation-actions';

export const metadata: Metadata = { robots: { index: false } };

// Moderation of reviews (spec 3.5, 6): what is new, what teachers reported, what is hidden.
export default async function ReviewModerationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  await requirePermission('admin:panel', locale as Locale);
  const { done, error } = await searchParams;

  const t = await getTranslations('adminReviews');
  const tr = await getTranslations('teacherReviews');
  const format = await getFormatter();
  const date = (value: Date) => format.dateTime(value, { dateStyle: 'long' });
  const queue = await listModerationQueue(getPool());

  const flashKey = done ?? error;
  const flash = flashKey ? t(`flash.${flashKey}` as 'flash.publish') : null;

  const sections: {
    key: string;
    title: string;
    items: ModerationItem[];
    actions: ModerationAction[];
  }[] = [
    {
      key: 'pending',
      title: t('pendingTitle'),
      items: queue.pending,
      actions: ['publish', 'reject'],
    },
    {
      key: 'reported',
      title: t('reportedTitle'),
      items: queue.reported,
      actions: ['hide', 'keep'],
    },
    {
      key: 'hidden',
      title: t('hiddenTitle'),
      items: queue.hidden,
      actions: ['restore'],
    },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/admin"
            className="text-primary underline underline-offset-2"
          >
            {t('back')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
      </header>

      {flash && (
        <p
          role={error ? 'alert' : 'status'}
          className={
            'rounded-md border p-3 text-sm ' +
            (error
              ? 'border-accent bg-secondary text-accent'
              : 'border-primary bg-secondary text-primary')
          }
        >
          {flash}
        </p>
      )}

      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`s-${section.key}`}>
          <h2
            id={`s-${section.key}`}
            className="text-lg font-semibold text-primary"
          >
            {section.title} ({section.items.length})
          </h2>

          {section.items.length === 0 ? (
            <p className="mt-2 text-muted">{t('empty')}</p>
          ) : (
            <ul className="mt-3 space-y-4">
              {section.items.map((item) => (
                <li
                  key={item.id}
                  className="space-y-3 rounded-card border border-border bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <RatingStars
                      average={item.rating}
                      label={`${item.rating}/5`}
                    />
                    <span className="text-sm text-muted">
                      {t('sentOn', { date: date(item.createdAt) })}
                    </span>
                  </div>

                  <p className="whitespace-pre-line">
                    {item.comment ?? (
                      <span className="text-muted">{t('noComment')}</span>
                    )}
                  </p>

                  <dl className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
                    <dt className="font-medium">{t('teacher')}</dt>
                    <dd>
                      {item.teacherSlug ? (
                        <Link
                          href={`/prof/${item.teacherSlug}`}
                          className="text-primary underline underline-offset-2"
                        >
                          {item.teacherName}
                        </Link>
                      ) : (
                        item.teacherName
                      )}
                    </dd>
                    <dt className="font-medium">{t('author')}</dt>
                    <dd>
                      {numTag(`+216 ${formatNationalPhone(item.authorPhone)}`)}
                    </dd>
                    {item.reply && (
                      <>
                        <dt className="font-medium">{t('reply')}</dt>
                        <dd className="whitespace-pre-line">{item.reply}</dd>
                      </>
                    )}
                  </dl>

                  {item.openReports.length > 0 && (
                    <div className="rounded-md border border-accent bg-secondary p-3 text-sm">
                      <p className="font-semibold">{t('reports')}</p>
                      <ul className="mt-1 list-disc ps-5">
                        {item.openReports.map((report, index) => (
                          <li key={index}>
                            {tr(`reasons.${report.reason}` as 'reasons.other')}
                            {report.note ? `: ${report.note}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {section.actions.map((action, index) => (
                      <form key={action} action={moderateReviewAction}>
                        <input type="hidden" name="reviewId" value={item.id} />
                        <input type="hidden" name="action" value={action} />
                        <button
                          type="submit"
                          className={
                            index === 0 ? buttonClass : secondaryButtonClass
                          }
                        >
                          {t(`actions.${action}`)}
                        </button>
                      </form>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
