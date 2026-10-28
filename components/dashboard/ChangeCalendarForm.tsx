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
import { monthsBetween } from '@/lib/dashboard/dates';
import { formatDay } from '@/lib/dashboard/format';
import {
  validatePeriod,
  validateRules,
  type Conflict,
  type Rule,
  type SessionDraft,
} from '@/lib/dashboard/schedule';
import { ConflictList } from './ConflictList';
import { GroupCalendarPreview } from './GroupCalendarPreview';
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
 * date. Past sessions are never touched; sessions moved one by one are kept unless the box is
 * ticked. "Voir ce qui va changer" runs the same change without saving it, and the calendar
 * preview of the group then shows the days that would be added and removed.
 */
export function ChangeCalendarForm({
  group,
  sessions,
  today,
}: {
  group: {
    id: string;
    name: string;
    color: string;
    startDate: string;
    endDate: string;
    rules: Rule[];
  };
  /** The group's sessions as they are now. */
  sessions: SessionDraft[];
  today: string;
}) {
  const t = useTranslations('groups.change');
  const tw = useTranslations('groups.wizard');
  const tp = useTranslations('groups.preview');
  const tcal = useTranslations('calendar');
  const locale = useLocale();
  const router = useRouter();

  const [days, setDays] = useState<Days>(() => daysFromRules(group.rules));
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [endDate, setEndDate] = useState(group.endDate);
  const [resetModified, setResetModified] = useState(false);
  const [preview, setPreview] = useState<{
    removed: SessionDraft[];
    created: SessionDraft[];
    removedCount: number;
    createdCount: number;
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

  // The calendar below: the group's sessions now, or what they would be after "Voir ce qui va
  // changer".
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const session of sessions)
      result[session.date] = (result[session.date] ?? 0) + 1;
    for (const session of preview?.removed ?? [])
      result[session.date] = (result[session.date] ?? 0) - 1;
    for (const session of preview?.created ?? [])
      result[session.date] = (result[session.date] ?? 0) + 1;
    return result;
  }, [sessions, preview]);
  const previewMonths = monthsBetween(
    [group.startDate, ...sessions.map((s) => s.date)].sort()[0],
    [
      group.endDate,
      periodError ? group.endDate : endDate,
      ...sessions.map((s) => s.date),
    ]
      .sort()
      .at(-1) as string,
  );

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
        if (dryRun) {
          // A session removed and created again identically is not a change: only the real
          // differences are drawn on the calendar.
          const key = (s: SessionDraft) =>
            `${s.date}|${s.startTime}|${s.endTime}`;
          const removedKeys = new Set(result.removedSessions.map(key));
          const createdKeys = new Set(result.createdSessions.map(key));
          setPreview({
            removed: result.removedSessions.filter(
              (s) => !createdKeys.has(key(s)),
            ),
            created: result.createdSessions.filter(
              (s) => !removedKeys.has(key(s)),
            ),
            removedCount: result.removed,
            createdCount: result.created,
          });
        } else {
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

      {group.rules.length === 0 && (
        <p
          role="note"
          className="rounded-md border border-border bg-secondary p-3 text-sm"
        >
          {t('manualNote')}
        </p>
      )}

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
      <p className="text-sm text-muted">{t('deletedNote')}</p>

      {conflicts.length > 0 && (
        <ConflictList lines={toConflictLines(conflicts)} />
      )}
      {preview && (
        <p
          role="status"
          className="rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
        >
          {t('previewResult', {
            removed: preview.removedCount,
            created: preview.createdCount,
          })}
        </p>
      )}

      <section aria-labelledby="change-preview" className="space-y-3">
        <div>
          <h2
            id="change-preview"
            className="text-lg font-semibold text-primary"
          >
            {tp('title')}
          </h2>
          <p className="text-sm text-muted">{t('previewHint')}</p>
        </div>
        <GroupCalendarPreview
          months={previewMonths}
          counts={counts}
          color={group.color}
          locale={locale}
          today={today}
          added={preview?.created.map((s) => s.date)}
          removed={preview?.removed.map((s) => s.date)}
          labels={{
            sessions: (count) => tcal('sessionsCount', { count }),
            legendSessions: tp('legend'),
            legendAdded: tp('legendAdded'),
            legendRemoved: tp('legendRemoved'),
          }}
        />
      </section>

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
