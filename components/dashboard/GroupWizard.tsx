'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import {
  createGroupAction,
  loadScheduledAction,
} from '@/app/[locale]/(dashboard)/dashboard-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { useRouter } from '@/i18n/navigation';
import { monthsBetween } from '@/lib/dashboard/dates';
import {
  formatDay,
  monthTitle,
  weekdayName,
  weekdayNames,
} from '@/lib/dashboard/format';
import {
  countByDate,
  endDateAfterWeeks,
  findConflicts,
  generateSessions,
  MAX_PERIOD_WEEKS,
  periodDays,
  summarizeRules,
  validateCustomSessions,
  validateName,
  validatePeriod,
  validateRules,
  withoutEnded,
  type Conflict,
  type ExistingSession,
  type Rule,
} from '@/lib/dashboard/schedule';
import { parseDinarsToMillimes } from '@/lib/marketplace/search-params';
import { ConflictList, type ConflictLine } from './ConflictList';
import {
  dayErrorsOf,
  rulesFromDays,
  WeekPatternEditor,
  type Days,
} from './WeekPatternEditor';
import {
  CustomSessionsEditor,
  customDayErrors,
  customSessionsOf,
  DEFAULT_CUSTOM_SLOT,
  type CustomDays,
} from './CustomSessionsEditor';
import { DayTimeline, type TimelineItem } from './DayTimeline';
import { MonthGrid } from './MonthGrid';

// The group wizard (spec 5.2): name, period, weekly pattern (or days picked in a calendar)
// with a live preview, price.
// Everything shown here is also checked by the server when the group is created.

const STEPS = ['name', 'period', 'pattern', 'price'] as const;

export function toConflictLines(conflicts: Conflict[]): ConflictLine[] {
  return conflicts.map((c) => ({
    date: c.draft.date,
    startTime: c.draft.startTime,
    endTime: c.draft.endTime,
    groupName: c.with.groupName,
    otherStart: c.with.startTime,
    otherEnd: c.with.endTime,
  }));
}

export function GroupWizard({ today }: { today: string }) {
  const t = useTranslations('groups.wizard');
  const tc = useTranslations('dashboard.conflict');
  const locale = useLocale();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [start, setStart] = useState(today);
  // The end of the period is either picked as a date or given as a number of weeks from the
  // first day (the teacher chooses which); `end` is whatever the chosen way gives.
  const [endMode, setEndMode] = useState<'date' | 'weeks'>('date');
  const [endPicked, setEndPicked] = useState('');
  const [weeks, setWeeks] = useState('');
  const weeksCount = /^\d{1,3}$/.test(weeks.trim())
    ? Number(weeks.trim())
    : NaN;
  const weeksEnd = endDateAfterWeeks(start, weeksCount);
  const end = endMode === 'date' ? endPicked : (weeksEnd ?? '');
  // How the days of the group are chosen: by weekday (the weekly pattern of step 3) or by
  // picking each day in a calendar (then step 3 is the list of those sessions).
  const [dayMode, setDayMode] = useState<'weekly' | 'calendar'>('weekly');
  const [days, setDays] = useState<Days>({});
  const [custom, setCustom] = useState<CustomDays>({});
  const [pricing, setPricing] = useState<'per_session' | 'per_month'>(
    'per_session',
  );
  const [price, setPrice] = useState('');
  // The teacher's sessions of the chosen period, tagged with the period they were loaded for:
  // when the period changes they count as "not loaded yet" until the new ones arrive.
  const [loaded, setLoaded] = useState<{
    key: string;
    sessions: ExistingSession[];
  } | null>(null);
  const periodKey = `${start}|${end}`;
  const existing = loaded?.key === periodKey ? loaded.sessions : null;
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverConflicts, setServerConflicts] = useState<Conflict[] | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  // ---------------------------------------------------------------- what the form means
  const periodError = validatePeriod(start, end);
  const rules: Rule[] = useMemo(
    () => (dayMode === 'weekly' ? rulesFromDays(days) : []),
    [dayMode, days],
  );
  const rulesCheck = useMemo(() => validateRules(rules), [rules]);
  const customList = useMemo(
    () => customSessionsOf(custom, start, end),
    [custom, start, end],
  );
  const customDates = useMemo(
    () => [...new Set(customList.map((s) => s.date))],
    [customList],
  );
  const customError = useMemo(
    () =>
      periodError ? 'none' : validateCustomSessions(customList, start, end),
    [periodError, customList, start, end],
  );
  const customErrors = useMemo(() => customDayErrors(custom), [custom]);
  // The sessions the form means, whichever way the days were chosen.
  const patternOk = dayMode === 'weekly' ? rulesCheck.ok : customError === null;
  // A session of today that is already over is not created (the server does the same).
  const [now] = useState(() => new Date());
  const allDrafts = useMemo(
    () =>
      periodError || !patternOk
        ? []
        : dayMode === 'weekly'
          ? generateSessions(rules, start, end)
          : customList,
    [periodError, patternOk, dayMode, rules, customList, start, end],
  );
  const drafts = useMemo(() => withoutEnded(allDrafts, now), [allDrafts, now]);
  const skippedCount = allDrafts.length - drafts.length;
  const conflicts = useMemo(
    () => (existing ? findConflicts(drafts, existing) : []),
    [drafts, existing],
  );
  const priceMillimes =
    price.trim() === '' ? null : parseDinarsToMillimes(price);
  const priceInvalid = price.trim() !== '' && priceMillimes === null;

  // ------------------------------------------------- the teacher's sessions in the period
  useEffect(() => {
    if (step !== 2 || periodError) return;
    let cancelled = false;
    loadScheduledAction(start, end).then((result) => {
      if (!cancelled)
        setLoaded({
          key: `${start}|${end}`,
          sessions: result.ok ? result.sessions : [],
        });
    });
    return () => {
      cancelled = true;
    };
  }, [step, start, end, periodError]);

  const dayErrors = useMemo(
    () => dayErrorsOf(rules, rulesCheck),
    [rules, rulesCheck],
  );

  // --------------------------------------------------------------------- preview data
  const counts = useMemo(
    () => countByDate([...(existing ?? []), ...drafts]),
    [existing, drafts],
  );
  const draftDates = useMemo(
    () => new Set(drafts.map((d) => d.date)),
    [drafts],
  );
  const conflictDates = useMemo(
    () => new Set(conflicts.map((c) => c.draft.date)),
    [conflicts],
  );
  const months = useMemo(
    () => (periodError ? [] : monthsBetween(start, end)),
    [periodError, start, end],
  );

  const dayItems = useCallback(
    (date: string): TimelineItem[] => [
      ...(existing ?? [])
        .filter((s) => s.date === date)
        .map((s) => ({
          id: s.id,
          label: s.groupName,
          startTime: s.startTime,
          endTime: s.endTime,
          color: '#64748b',
        })),
      ...drafts
        .filter((d) => d.date === date)
        .map((d, index) => ({
          id: `new-${index}`,
          label: name.trim() || t('dayOverlay.newGroup'),
          startTime: d.startTime,
          endTime: d.endTime,
          color: conflictDates.has(date) ? '#b91c1c' : '#003801',
          highlight: true,
        })),
    ],
    [existing, drafts, name, conflictDates, t],
  );

  // ---------------------------------------------------------------------- navigation
  const canNext =
    (step === 0 && validateName(name)) ||
    (step === 1 &&
      !periodError &&
      (dayMode === 'weekly' || customDates.length > 0)) ||
    (step === 2 && patternOk && existing !== null && conflicts.length === 0);

  function create() {
    setError(null);
    setServerConflicts(null);
    startTransition(async () => {
      const result = await createGroupAction({
        name,
        startDate: start,
        endDate: end,
        rules,
        customSessions: dayMode === 'calendar' ? customList : undefined,
        pricingModel: pricing,
        referencePriceMillimes: priceMillimes,
      });
      if (result.ok && 'groupId' in result) {
        router.push(`/groupes/${result.groupId}`);
        return;
      }
      if (!result.ok && result.reason === 'conflicts') {
        // Something changed meanwhile: back to the pattern with the real conflicts.
        setServerConflicts(
          'conflicts' in result && result.conflicts ? result.conflicts : [],
        );
        setStep(2);
        return;
      }
      if (!result.ok && result.reason === 'name_taken') setStep(0);
      setError(!result.ok ? result.reason : 'generic');
    });
  }

  const weekLabels = weekdayNames(locale, 'narrow');
  const toggleCustomDay = (date: string) =>
    setCustom((current) => {
      const next = { ...current };
      if (next[date]) delete next[date];
      else next[date] = [DEFAULT_CUSTOM_SLOT];
      return next;
    });
  const shownConflicts =
    serverConflicts && serverConflicts.length > 0 ? serverConflicts : conflicts;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
        <ol
          className="flex flex-wrap gap-2 text-sm"
          aria-label={t('stepOf', { current: step + 1, total: STEPS.length })}
        >
          {STEPS.map((key, index) => (
            <li
              key={key}
              aria-current={index === step ? 'step' : undefined}
              className={
                'rounded-full border px-3 py-1 ' +
                (index === step
                  ? 'border-primary bg-primary text-primary-foreground'
                  : index < step
                    ? 'border-primary text-primary'
                    : 'border-border text-muted')
              }
            >
              {index + 1}. {t(`steps.${key}`)}
            </li>
          ))}
        </ol>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
        >
          {t(`errors.${error}` as 'errors.generic')}
        </p>
      )}

      {/* ----------------------------------------------------------------- 1. name */}
      {step === 0 && (
        <section className="space-y-2">
          <label htmlFor="group-name" className="block font-medium">
            {t('nameLabel')}
          </label>
          <input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            className={inputClass}
            aria-describedby="group-name-hint"
            autoFocus
          />
          <p
            id="group-name-hint"
            className={
              'text-sm ' +
              (name !== '' && !validateName(name)
                ? 'text-accent'
                : 'text-muted')
            }
          >
            {name !== '' && !validateName(name)
              ? t('nameError')
              : t('nameHint')}
          </p>
        </section>
      )}

      {/* --------------------------------------------------------------- 2. period */}
      {step === 1 && (
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="group-start" className="block font-medium">
                {t('startLabel')}
              </label>
              <input
                id="group-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="font-medium">{t('endMode.label')}</legend>
            {(['date', 'weeks'] as const).map((mode) => (
              <label key={mode} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="end-mode"
                  checked={endMode === mode}
                  onChange={() => setEndMode(mode)}
                  className="size-5 accent-primary"
                />
                {t(`endMode.${mode}`)}
              </label>
            ))}
          </fieldset>
          {endMode === 'date' ? (
            <div className="space-y-1">
              <label htmlFor="group-end" className="block font-medium">
                {t('endLabel')}
              </label>
              <input
                id="group-end"
                type="date"
                value={endPicked}
                onChange={(e) => setEndPicked(e.target.value)}
                className={inputClass + ' sm:!w-56'}
              />
            </div>
          ) : (
            <div className="space-y-1">
              <label htmlFor="group-weeks" className="block font-medium">
                {t('weeksLabel')}
              </label>
              <input
                id="group-weeks"
                inputMode="numeric"
                dir="ltr"
                value={weeks}
                onChange={(e) => setWeeks(e.target.value)}
                className={inputClass + ' text-start sm:!w-32'}
                aria-describedby="group-weeks-hint"
              />
              <p
                id="group-weeks-hint"
                className={
                  'text-sm ' +
                  (weeks.trim() !== '' && weeksEnd === null
                    ? 'text-accent'
                    : 'text-muted')
                }
              >
                {weeks.trim() !== '' && weeksEnd === null
                  ? t('weeksError', { max: MAX_PERIOD_WEEKS })
                  : t('weeksHint', { max: MAX_PERIOD_WEEKS })}
              </p>
            </div>
          )}
          {end !== '' && (
            <p
              role="status"
              className={
                'text-sm ' +
                (periodError ? 'text-accent' : 'font-medium text-primary')
              }
            >
              {periodError
                ? t(`periodErrors.${periodError}`)
                : t('periodSummary', {
                    start: formatDay(start, locale, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }),
                    end: formatDay(end, locale, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }),
                    days: periodDays(start, end),
                  })}
            </p>
          )}

          <fieldset className="space-y-2">
            <legend className="font-medium">{t('dayMode.label')}</legend>
            {(['weekly', 'calendar'] as const).map((mode) => (
              <label key={mode} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="day-mode"
                  checked={dayMode === mode}
                  onChange={() => setDayMode(mode)}
                  className="size-5 accent-primary"
                />
                {t(`dayMode.${mode}`)}
              </label>
            ))}
          </fieldset>

          {dayMode === 'calendar' && (
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-primary">
                  {t('custom.pickTitle')}
                </h2>
                <p className="text-sm text-muted">{t('custom.pickHint')}</p>
                <p role="status" className="mt-1 text-sm font-medium">
                  {t('custom.pickedCount', { count: customDates.length })}
                </p>
              </div>
              {periodError ? (
                <p className="text-sm text-muted">{t('custom.needPeriod')}</p>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {months.map((month) => (
                    <div
                      key={month}
                      className="rounded-card border border-border bg-surface p-3"
                    >
                      <h3 className="mb-2 text-center font-medium first-letter:uppercase">
                        {monthTitle(month, locale)}
                      </h3>
                      <MonthGrid
                        month={month}
                        weekdayLabels={weekLabels}
                        renderDay={(date) => {
                          const selectable =
                            date >= start && date <= end && date >= today;
                          const picked = Boolean(custom[date]);
                          return (
                            <button
                              type="button"
                              onClick={() => toggleCustomDay(date)}
                              disabled={!selectable}
                              aria-pressed={picked}
                              aria-label={formatDay(date, locale, {
                                dateStyle: 'full',
                              })}
                              className="flex min-h-11 w-9 items-center justify-center rounded-md disabled:opacity-40"
                            >
                              <span
                                className={
                                  'flex size-8 items-center justify-center rounded-full text-sm ' +
                                  (picked
                                    ? 'bg-primary font-semibold text-primary-foreground'
                                    : selectable
                                      ? 'hover:bg-secondary'
                                      : '')
                                }
                              >
                                {Number(date.slice(8))}
                              </span>
                            </button>
                          );
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------ 3. pattern */}
      {step === 2 && (
        <section className="space-y-6">
          {dayMode === 'weekly' ? (
            <>
              <div>
                <h2 className="text-lg font-semibold text-primary">
                  {t('patternTitle')}
                </h2>
                <p className="text-sm text-muted">{t('patternHint')}</p>
              </div>

              <WeekPatternEditor
                days={days}
                onChange={setDays}
                dayErrors={dayErrors}
              />

              {rules.length === 0 && (
                <p className="text-sm text-muted">{t('ruleErrors.none')}</p>
              )}
            </>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold text-primary">
                  {t('custom.listTitle')}
                </h2>
                <p className="text-sm text-muted">{t('custom.listHint')}</p>
              </div>

              <CustomSessionsEditor
                days={Object.fromEntries(
                  customDates.map((date) => [date, custom[date]]),
                )}
                onChange={setCustom}
                dayErrors={customErrors}
              />

              {customDates.length === 0 && (
                <p className="text-sm text-accent">{t('custom.errors.none')}</p>
              )}
            </>
          )}

          {/* Live preview calendar */}
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t('previewTitle')}
              </h2>
              <p className="text-sm text-muted">{t('previewHint')}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 text-xs">
                <span className="inline-flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-full bg-primary"
                  />
                  {t('legend.newDay')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-full bg-red-700"
                  />
                  {t('legend.conflictDay')}
                </span>
              </p>
            </div>

            {skippedCount > 0 && (
              <p role="status" className="text-sm text-muted">
                {t('previewSkipped', { count: skippedCount })}
              </p>
            )}

            {existing === null && !periodError && (
              <p role="status" className="text-sm text-muted">
                {t('loadingExisting')}
              </p>
            )}

            {shownConflicts.length > 0 && (
              <ConflictList lines={toConflictLines(shownConflicts)} />
            )}
            {shownConflicts.length > 0 && (
              <p className="text-sm text-accent">{t('conflictsBlock')}</p>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              {months.map((month) => (
                <div
                  key={month}
                  className="rounded-card border border-border bg-surface p-3"
                >
                  <h3 className="mb-2 text-center font-medium first-letter:uppercase">
                    {monthTitle(month, locale)}
                  </h3>
                  <MonthGrid
                    month={month}
                    weekdayLabels={weekLabels}
                    renderDay={(date) => {
                      const inPeriod = date >= start && date <= end;
                      const isNew = draftDates.has(date);
                      const isConflict = conflictDates.has(date);
                      const count = counts.get(date) ?? 0;
                      return (
                        <button
                          type="button"
                          onClick={() => setOpenDay(date)}
                          disabled={!inPeriod}
                          aria-label={`${formatDay(date, locale, { dateStyle: 'full' })}, ${t('dayOverlay.count', { count })}`}
                          className="flex min-h-11 w-9 flex-col items-center justify-start gap-0.5 rounded-md py-0.5 disabled:opacity-40"
                        >
                          <span
                            className={
                              'flex size-8 items-center justify-center rounded-full text-sm ' +
                              (isConflict
                                ? 'bg-red-700 font-semibold text-white'
                                : isNew
                                  ? 'bg-primary font-semibold text-primary-foreground'
                                  : '')
                            }
                          >
                            {Number(date.slice(8))}
                          </span>
                          <span className="h-3 text-[10px] leading-3 text-muted">
                            {count > 0 ? count : ''}
                          </span>
                        </button>
                      );
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------------- 4. price */}
      {step === 3 && (
        <section className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="font-medium">{t('pricingLabel')}</legend>
            {(['per_session', 'per_month'] as const).map((model) => (
              <label key={model} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="pricing"
                  checked={pricing === model}
                  onChange={() => setPricing(model)}
                  className="size-5 accent-primary"
                />
                {t(model === 'per_session' ? 'perSession' : 'perMonth')}
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            <label htmlFor="group-price" className="block font-medium">
              {t('priceLabel')}
            </label>
            <input
              id="group-price"
              inputMode="decimal"
              dir="ltr"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputClass + ' text-start sm:!w-48'}
              aria-describedby="group-price-hint"
            />
            <p
              id="group-price-hint"
              className={
                'text-sm ' + (priceInvalid ? 'text-accent' : 'text-muted')
              }
            >
              {priceInvalid ? t('priceError') : t('priceHint')}
            </p>
          </div>

          <div className="rounded-card border border-border bg-surface p-4 text-sm">
            <h2 className="font-semibold text-primary">{t('summary.title')}</h2>
            <dl className="mt-2 grid gap-1 sm:grid-cols-[9rem_1fr]">
              <dt className="font-medium">{t('summary.name')}</dt>
              <dd>{name.trim()}</dd>
              <dt className="font-medium">{t('summary.period')}</dt>
              <dd>
                {formatDay(start, locale, { dateStyle: 'medium' })} →{' '}
                {formatDay(end, locale, { dateStyle: 'medium' })}
              </dd>
              <dt className="font-medium">{t('summary.pattern')}</dt>
              <dd>
                {dayMode === 'calendar'
                  ? t('summary.pickedDays', { count: customDates.length })
                  : summarizeRules(rules)
                      .map(
                        (d) =>
                          `${weekdayName(d.weekday, locale)} ${d.slots.map((s) => `${s.startTime}-${s.endTime}`).join(', ')}`,
                      )
                      .join(' · ')}
              </dd>
              <dt className="font-medium">{t('summary.sessions')}</dt>
              <dd>{t('summary.sessionCount', { count: drafts.length })}</dd>
            </dl>
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- navigation bar */}
      <div className="flex flex-wrap items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setStep(step - 1)}
            disabled={pending}
          >
            {t('back')}
          </button>
        )}
        {step < 3 ? (
          <button
            type="button"
            className={buttonClass}
            disabled={!canNext}
            onClick={() => {
              setError(null);
              setServerConflicts(null);
              setStep(step + 1);
            }}
          >
            {t('next')}
          </button>
        ) : (
          <button
            type="button"
            className={buttonClass}
            disabled={pending || priceInvalid}
            onClick={create}
          >
            {pending ? t('creating') : t('create')}
          </button>
        )}
        {step === 2 && !canNext && (
          <span className="text-sm text-muted" role="status">
            {conflicts.length > 0
              ? tc('title', { count: conflicts.length })
              : ''}
          </span>
        )}
      </div>

      {/* ------------------------------------------- read-only day overlay (preview) */}
      {openDay && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={formatDay(openDay, locale, { dateStyle: 'full' })}
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
          onKeyDown={(event) => event.key === 'Escape' && setOpenDay(null)}
        >
          <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-card bg-surface p-4 sm:rounded-card">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-primary">
                {formatDay(openDay, locale, { dateStyle: 'full' })}
              </h2>
              <button
                type="button"
                autoFocus
                className={secondaryButtonClass}
                onClick={() => setOpenDay(null)}
              >
                {t('dayOverlay.close')}
              </button>
            </div>
            {dayItems(openDay).length === 0 ? (
              <p className="text-muted">{t('dayOverlay.empty')}</p>
            ) : (
              <DayTimeline
                items={dayItems(openDay)}
                ariaLabel={t('dayOverlay.timeline')}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
