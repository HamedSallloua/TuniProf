'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonClass, inputClass } from '@/components/auth/styles';
import { reportAction } from '@/app/[locale]/(public)/contact-actions';
import type { ReportState } from '@/lib/marketplace/action-state';
import { REPORT_REASONS } from '@/lib/marketplace/report-reasons';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass}>
      {label}
    </button>
  );
}

/** "Signaler ce profil" (spec 3.4): a short form that opens under the link. */
export function ReportForm({ slug }: { slug: string }) {
  const t = useTranslations('publicProfile.report');
  const [state, action] = useActionState<ReportState, FormData>(
    reportAction,
    null,
  );

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
        <form action={action} className="mt-3 space-y-4">
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
          <Submit label={t('submit')} />
        </form>
      )}
    </details>
  );
}
