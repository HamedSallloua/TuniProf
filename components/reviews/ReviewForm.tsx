'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition, type FormEvent } from 'react';
import { submitReviewAction } from '@/app/[locale]/(public)/review-actions';
import { buttonClass, inputClass } from '@/components/auth/styles';
import { StarIcon } from '@/components/ui/icons';
import type { ReviewFormState } from '@/lib/reviews/action-state';
import { COMMENT_MAX } from '@/lib/reviews/rules';

/** The review form of a profile page (spec 3.5): 1 to 5 stars and an optional comment. */
export function ReviewForm({ slug }: { slug: string }) {
  const t = useTranslations('reviews');
  const [state, action] = useActionState<ReviewFormState, FormData>(
    submitReviewAction,
    null,
  );
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState(0);

  // Sent by hand so that a refusal does not empty the form (see the profile form, M3).
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  if (state && 'sent' in state) {
    return (
      <p role="status" className="font-medium text-primary">
        {t('form.sent')}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />

      <fieldset>
        <legend className="font-medium">{t('form.rating')}</legend>
        <div className="mt-1 flex gap-1 text-accent">
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="sr-only"
              />
              <span className="sr-only">
                {t('form.ratingOption', { value })}
              </span>
              <StarIcon className="size-8" filled={value <= rating} />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="review-comment" className="block font-medium">
          {t('form.comment')}
        </label>
        <textarea
          id="review-comment"
          name="comment"
          rows={4}
          maxLength={COMMENT_MAX}
          className={inputClass}
          aria-describedby="review-comment-hint"
        />
        <p id="review-comment-hint" className="text-sm text-muted">
          {t('form.commentHint', { max: COMMENT_MAX })}
        </p>
      </div>

      {state && 'error' in state && (
        <p role="alert" className="text-sm text-accent">
          {t(`errors.${state.error}` as 'errors.generic')}
        </p>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {t('form.submit')}
      </button>
    </form>
  );
}
