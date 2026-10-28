import type { Metadata } from 'next';
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import { RatingStars } from '@/components/marketplace/RatingStars';
import { ReplyForm } from '@/components/reviews/ReplyForm';
import { ReviewReportForm } from '@/components/reviews/ReviewReportForm';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db/client';
import { listReviewsForTeacher } from '@/lib/reviews/repo';

export const metadata: Metadata = { robots: { index: false } };

// The published reviews of the signed-in teacher's own profile: answer once, or report.
export default async function TeacherReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requirePermission('teacher:space', locale as Locale);

  const t = await getTranslations('teacherReviews');
  const format = await getFormatter();
  const date = (value: Date) => format.dateTime(value, { dateStyle: 'long' });
  const reviews = await listReviewsForTeacher(getPool(), user.id);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/espace-professeur"
            className="text-primary underline underline-offset-2"
          >
            {t('back')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
        <p className="text-muted">{t('intro')}</p>
      </header>

      {reviews.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-muted">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-4">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="space-y-3 rounded-card border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <RatingStars
                  average={review.rating}
                  label={`${review.rating}/5`}
                />
                <span className="text-sm text-muted">
                  {t('reviewDate', { date: date(review.createdAt) })}
                </span>
              </div>
              <p className="whitespace-pre-line">
                {review.comment ?? (
                  <span className="text-muted">{t('noComment')}</span>
                )}
              </p>

              {review.reply && review.repliedAt ? (
                <div className="rounded-md bg-secondary p-3 text-secondary-foreground">
                  <p className="text-sm font-semibold">
                    {t('yourReply')} · {date(review.repliedAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-line">{review.reply}</p>
                </div>
              ) : (
                <ReplyForm reviewId={review.id} />
              )}

              <ReviewReportForm
                reviewId={review.id}
                alreadyReported={review.reported}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
