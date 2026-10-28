'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useTransition, type FormEvent } from 'react';
import { replyAction } from '@/app/[locale]/(teacher)/review-actions';
import { buttonClass, inputClass } from '@/components/auth/styles';
import type { TeacherReviewState } from '@/lib/reviews/action-state';
import { REPLY_MAX } from '@/lib/reviews/rules';

/** The teacher's one public reply to a review (spec 3.5). */
export function ReplyForm({ reviewId }: { reviewId: string }) {
  const t = useTranslations('teacherReviews');
  const [state, action] = useActionState<TeacherReviewState, FormData>(
    replyAction,
    null,
  );
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  if (state && 'done' in state) {
    return (
      <p role="status" className="text-sm font-medium text-primary">
        {t('replied')}
      </p>
    );
  }

  const id = `reply-${reviewId}`;
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <label htmlFor={id} className="block font-medium">
        {t('replyLabel')}
      </label>
      <textarea
        id={id}
        name="reply"
        rows={3}
        maxLength={REPLY_MAX}
        className={inputClass}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="text-sm text-muted">
        {t('replyHint')}
      </p>
      {state && 'error' in state && (
        <p role="alert" className="text-sm text-accent">
          {t(`replyErrors.${state.error}` as 'replyErrors.generic')}
        </p>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {t('replySubmit')}
      </button>
    </form>
  );
}
