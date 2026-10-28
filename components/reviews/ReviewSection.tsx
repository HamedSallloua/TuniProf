import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import { getPool } from '@/lib/db/client';
import { getOwnReview, listPublishedReviews } from '@/lib/reviews/repo';
import { ReviewForm } from './ReviewForm';
import { ReviewList } from './ReviewList';

/**
 * The "Avis" part of a profile page (spec 3.5): the published reviews, and what the visitor
 * can do: sign in with WhatsApp, write a review, or see the status of the one already sent.
 * Teacher accounts cannot review.
 */
export async function ReviewSection({
  teacherId,
  slug,
  noReviewsLabel,
}: {
  teacherId: string;
  slug: string;
  noReviewsLabel: string;
}) {
  const t = await getTranslations('reviews');
  const pool = getPool();
  const [reviews, user] = await Promise.all([
    listPublishedReviews(pool, teacherId),
    getCurrentUser(),
  ]);
  const canReview = user ? can(user.role, 'review:create') : false;
  const own =
    canReview && user ? await getOwnReview(pool, user.id, teacherId) : null;

  return (
    <div className="mt-2 space-y-6">
      {reviews.length > 0 ? (
        <ReviewList reviews={reviews} />
      ) : (
        <p className="text-muted">{noReviewsLabel}</p>
      )}

      <div className="rounded-card border border-border bg-surface p-4">
        <h3 className="font-semibold text-primary">{t('writeTitle')}</h3>
        <div className="mt-3">
          {!user && (
            <div className="space-y-3">
              <p className="text-sm text-muted">{t('signInPrompt')}</p>
              <Link
                href={{
                  pathname: '/connexion-avis',
                  query: { retour: `/prof/${slug}` },
                }}
                className={buttonClass}
              >
                {t('signInCta')}
              </Link>
            </div>
          )}
          {user && !canReview && user.role === 'teacher' && (
            <p className="text-sm text-muted">{t('teacherNote')}</p>
          )}
          {canReview && own && (
            <p role="status" className="font-medium text-primary">
              {t(`status.${own.status}`)}
            </p>
          )}
          {canReview && !own && <ReviewForm slug={slug} />}
        </div>
      </div>
    </div>
  );
}
