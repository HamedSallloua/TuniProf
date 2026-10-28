'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useTransition, type FormEvent } from 'react';
import { reportReviewAction } from '@/app/[locale]/(teacher)/review-actions';
import { buttonClass, inputClass } from '@/components/auth/styles';
import type { TeacherReviewState } from '@/lib/reviews/action-state';
import { REVIEW_REPORT_REASONS } from '@/lib/reviews/rules';

/** "Signaler cet avis": the teacher asks an admin to look at a review (spec 3.5). */
export function ReviewReportForm({
  reviewId,
  alreadyReported,
}: {
  reviewId: string;
  alreadyReported: boolean;
}) {
  const t = useTranslations('teacherReviews');
  const [state, action] = useActionState<TeacherReviewState, FormData>(
    reportReviewAction,
    null,
  );
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  if (alreadyReported || (state && 'done' in state)) {
    return (
      <p role="status" className="text-sm text-muted">
        {t('reported')}
      </p>
    );
  }

  const id = `report-${reviewId}`;
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary underline underline-offset-2">
        {t('reportLink')}
      </summary>
      <form onSubmit={onSubmit} className="mt-2 space-y-3">
        <input type="hidden" name="reviewId" value={reviewId} />
        <p className="text-sm text-muted">{t('reportIntro')}</p>
        <fieldset className="space-y-1">
          <legend className="font-medium">{t('reasonLabel')}</legend>
          {REVIEW_REPORT_REASONS.map((reason, index) => (
            <label key={reason} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="reason"
                value={reason}
                defaultChecked={index === 0}
                className="size-5 accent-primary"
              />
              {t(`reasons.${reason}`)}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1">
          <label htmlFor={id} className="block font-medium">
            {t('noteLabel')}
          </label>
          <textarea
            id={id}
            name="note"
            rows={2}
            maxLength={500}
            className={inputClass}
            aria-describedby={`${id}-hint`}
          />
          <p id={`${id}-hint`} className="text-sm text-muted">
            {t('noteHint')}
          </p>
        </div>
        {state && 'error' in state && (
          <p role="alert" className="text-sm text-accent">
            {t(`reportErrors.${state.error}` as 'reportErrors.generic')}
          </p>
        )}
        <button type="submit" disabled={pending} className={buttonClass}>
          {t('reportSubmit')}
        </button>
      </form>
    </details>
  );
}
