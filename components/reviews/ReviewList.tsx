import { getFormatter, getTranslations } from 'next-intl/server';
import { RatingStars } from '@/components/marketplace/RatingStars';
import type { PublicReview } from '@/lib/reviews/repo';

/** Published reviews (spec 3.5). The author is never shown: only "verified by WhatsApp". */
export async function ReviewList({ reviews }: { reviews: PublicReview[] }) {
  const t = await getTranslations('reviews');
  const format = await getFormatter();
  const date = (value: Date) => format.dateTime(value, { dateStyle: 'long' });

  return (
    <ul className="space-y-4">
      {reviews.map((review) => (
        <li
          key={review.id}
          className="rounded-card border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <RatingStars average={review.rating} label={`${review.rating}/5`} />
            <span className="text-sm text-muted">
              {t('author')} · {date(review.createdAt)}
            </span>
          </div>
          {/* React escapes the text: a comment can never inject markup. */}
          <p className="mt-2 whitespace-pre-line">
            {review.comment ?? (
              <span className="text-muted">{t('noComment')}</span>
            )}
          </p>
          {review.reply && review.repliedAt && (
            <div className="mt-3 rounded-md bg-secondary p-3 text-secondary-foreground">
              <p className="text-sm font-semibold">
                {t('replyTitle')} · {date(review.repliedAt)}
              </p>
              <p className="mt-1 whitespace-pre-line">{review.reply}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
