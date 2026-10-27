'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useTransition, type FormEvent } from 'react';
import { buttonClass, inputClass } from '@/components/auth/styles';
import { reportAction } from '@/app/[locale]/(public)/contact-actions';
import type { ReportState } from '@/lib/marketplace/action-state';
import { REPORT_REASONS } from '@/lib/marketplace/report-reasons';

/** "Signaler ce profil" (spec 3.4): a short form that opens under the link. */
export function ReportForm({ slug }: { slug: string }) {
  const t = useTranslations('publicProfile.report');
  const [state, action] = useActionState<ReportState, FormData>(
    reportAction,
    null,
  );
  const [pending, startTransition] = useTransition();

  // Sent by hand instead of through the form's `action`: React empties a form after an
  // action, which would forget the chosen reason and the note when the server asks for a
  // correction (same lesson as the profile form, M3).
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <details className="rounded-card border border-border bg-surface p-4">
      <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary underline underline-offset-2">
        {t('link')}
      </summary>

      {state && 'sent' in state ? (
        <p role="status" className="mt-3 text-sm font-medium text-primary">
          {t('sent')}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-3 space-y-4">
          <input type="hidden" name="slug" value={slug} />
          <p className="text-sm text-muted">{t('intro')}</p>

          <fieldset className="space-y-2">
            <legend className="font-medium">{t('reason')}</legend>
            {REPORT_REASONS.map((reason, index) => (
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
            <label htmlFor="report-note" className="block font-medium">
              {t('note')}
            </label>
            <textarea
              id="report-note"
              name="note"
              rows={3}
              maxLength={500}
              className={inputClass}
              aria-describedby="report-note-hint"
            />
            <p id="report-note-hint" className="text-sm text-muted">
              {t('noteHint')}
            </p>
          </div>

          {state && 'error' in state && (
            <p role="alert" className="text-sm text-accent">
              {t(`errors.${state.error}` as 'errors.generic')}
            </p>
          )}
          <button type="submit" disabled={pending} className={buttonClass}>
            {t('submit')}
          </button>
        </form>
      )}
    </details>
  );
}
