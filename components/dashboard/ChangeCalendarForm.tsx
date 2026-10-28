'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { changeCalendarAction } from '@/app/[locale]/(dashboard)/dashboard-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { useRouter } from '@/i18n/navigation';
import { formatDay } from '@/lib/dashboard/format';
import {
  validatePeriod,
  validateRules,
  type Conflict,
  type Rule,
} from '@/lib/dashboard/schedule';
import { ConflictList } from './ConflictList';
import { toConflictLines } from './GroupWizard';
import {
  dayErrorsOf,
  daysFromRules,
  rulesFromDays,
  WeekPatternEditor,
  type Days,
} from './WeekPatternEditor';

/**
 * "Modifier calendrier" (spec 5.3): the weekly pattern and the end date change FROM an effective
 * date. Past sessions are never touched; sessions moved or cancelled one by one are kept unless
 * the box is ticked. "Voir ce qui va changer" runs the same change without saving it.
 */
export function ChangeCalendarForm({
  group,
  today,
}: {
  group: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    rules: Rule[];
  };
  today: string;
}) {
  const t = useTranslations('groups.change');
  const tw = useTranslations('groups.wizard');
  const locale = useLocale();
  const router = useRouter();

  const [days, setDays] = useState<Days>(() => daysFromRules(group.rules));
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [endDate, setEndDate] = useState(group.endDate);
  const [resetModified, setResetModified] = useState(false);
  const [preview, setPreview] = useState<{
    removed: number;
    created: number;
  } | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rules = useMemo(() => rulesFromDays(days), [days]);
  const check = useMemo(() => validateRules(rules), [rules]);
  const dayErrors = useMemo(() => dayErrorsOf(rules, check), [rules, check]);
  const periodError = validatePeriod(group.startDate, endDate);
  const dateError = effectiveDate < today || effectiveDate === '';
  const ready = check.ok && !periodError && !dateError;

  function run(dryRun: boolean) {
    setError(null);
    setConflicts([]);
    if (dryRun) setPreview(null);
    startTransition(async () => {
      const result = await changeCalendarAction(
        group.id,
        { effectiveDate, endDate, rules, resetModified },
        dryRun,
      );
      if (result.ok && 'removed' in result) {
        if (dryRun)
          setPreview({ removed: result.removed, created: result.created });
        else {
          router.push(`/groupes/${group.id}`);
          router.refresh();
        }
        return;
      }
      if (
        !result.ok &&
        result.reason === 'conflicts' &&
        'conflicts' in result
      ) {
        setConflicts(result.conflicts ?? []);
        setPreview(null);
        return;
      }
      setError(result.ok ? 'generic' : result.reason);
    });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-primary">
          {t('title', { name: group.name })}
        </h1>
        <p className="text-muted">{t('intro')}</p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
        >
          {t(`errors.${error}` as 'errors.generic')}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="effective" className="block font-medium">
            {t('effective')}
          </label>
          <input
            id="effective"
            type="date"
            min={today}
            value={effectiveDate}
            onChange={(e) => {
              setEffectiveDate(e.target.value);
              setPreview(null);
            }}
            className={inputClass}
            aria-describedby="effective-hint"
          />
          <p
            id="effective-hint"
            className={'text-sm ' + (dateError ? 'text-accent' : 'text-muted')}
          >
            {dateError ? t('errors.invalid_date') : t('effectiveHint')}
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="end-date" className="block font-medium">
            {t('endDate')}
          </label>
          <input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPreview(null);
            }}
            className={inputClass}
            aria-describedby="end-hint"
          />
          <p
            id="end-hint"
            className={
              'text-sm ' + (periodError ? 'text-accent' : 'text-muted')
            }
          >
            {periodError
              ? tw(`periodErrors.${periodError}`)
              : t('startFixed', {
                  date: formatDay(group.startDate, locale, {
                    dateStyle: 'medium',
                  }),
                })}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-primary">
          {tw('patternTitle')}
        </h2>
        <WeekPatternEditor
          days={days}
          onChange={(next) => {
            setDays(next);
            setPreview(null);
          }}
          dayErrors={dayErrors}
        />
        {rules.length === 0 && (
          <p className="text-sm text-accent">{tw('ruleErrors.none')}</p>
        )}
      </section>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={resetModified}
          onChange={(e) => {
            setResetModified(e.target.checked);
            setPreview(null);
          }}
          className="mt-1 size-5 accent-primary"
        />
        <span>
          <span className="font-medium">{t('reset')}</span>
          <span className="block text-sm text-muted">{t('resetHint')}</span>
        </span>
      </label>

      {conflicts.length > 0 && (
        <ConflictList lines={toConflictLines(conflicts)} />
      )}
      {preview && (
        <p
          role="status"
          className="rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
        >
          {t('previewResult', {
            removed: preview.removed,
            created: preview.created,
          })}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={!ready || pending}
          onClick={() => run(true)}
        >
          {t('preview')}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!ready || pending}
          onClick={() => run(false)}
        >
          {pending ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}
