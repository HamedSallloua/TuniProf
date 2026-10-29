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
import {
  addMonths,
  endOfMonth,
  monthOf,
  monthsBetween,
  startOfMonth,
} from '@/lib/dashboard/dates';
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
  MAX_PERIOD_WEEKS,
  periodDays,
  periodOfDates,
  planSessions,
  sameSlot,
  summarizeRules,
  validateName,
  validatePeriod,
  validatePlan,
  validateRules,
  withoutEnded,
  type Conflict,
  type ExistingSession,
  type PlannedSession,
  type Rule,
  type SessionDraft,
  type SlotMove,
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
import { DayPicker } from './DayPicker';
import type { TimelineItem } from './DayTimeline';
import { MonthGrid } from './MonthGrid';
import { WizardDayOverlay } from './WizardDayOverlay';

// The group wizard (spec 5.2): name, period, weekly pattern (or days picked in a calendar)
// with a live preview, price.
// Everything shown here is also checked by the server when the group is created.

const STEPS = ['name', 'period', 'pattern', 'price'] as const;

/** How far ahead (in months from today) a day can be picked when there is no period. */
const PICK_MONTHS_AHEAD = 26;

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
  // How the days of the group are chosen: by weekday (the weekly pattern of step 3) or by
  // picking each day in a calendar. With the calendar there is no period to give: it is the
  // first to the last picked day.
  const [dayMode, setDayMode] = useState<'weekly' | 'calendar'>('weekly');
  const [startPicked, setStartPicked] = useState(today);
  // The end of the period is either picked as a date or given as a number of weeks from the
  // first day (the teacher chooses which); `weeklyEnd` is whatever the chosen way gives.
  const [endMode, setEndMode] = useState<'date' | 'weeks'>('date');
  const [endPicked, setEndPicked] = useState('');
  const [weeks, setWeeks] = useState('');
  const weeksCount = /^\d{1,3}$/.test(weeks.trim())
    ? Number(weeks.trim())
    : NaN;
  const weeksEnd = endDateAfterWeeks(startPicked, weeksCount);
  const weeklyEnd = endMode === 'date' ? endPicked : (weeksEnd ?? '');

  const [days, setDays] = useState<Days>({});
  // Days added by hand, date -> sessions: the whole group (calendar mode) or extra specific days
  // next to the weekly pattern.
  const [custom, setCustom] = useState<CustomDays>({});
  // Sessions of the weekly pattern that were deleted or edited one by one in the preview.
  const [removed, setRemoved] = useState<SessionDraft[]>([]);
  const [moved, setMoved] = useState<SlotMove[]>([]);
  // Calendar mode: how many months the preview shows before and after the picked days.
  const [monthsBefore, setMonthsBefore] = useState(0);
  const [monthsAfter, setMonthsAfter] = useState(0);
  const [pricing, setPricing] = useState<'per_session' | 'per_month'>(
    'per_session',
  );
  const [price, setPrice] = useState('');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverConflicts, setServerConflicts] = useState<Conflict[] | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  // ---------------------------------------------------------------- what the form means
  const pickedPeriod = periodOfDates(Object.keys(custom));
  const start =
    dayMode === 'weekly' ? startPicked : (pickedPeriod?.start ?? '');
  const end = dayMode === 'weekly' ? weeklyEnd : (pickedPeriod?.end ?? '');
  const periodError = validatePeriod(start, end);

  const rules: Rule[] = useMemo(
    () => (dayMode === 'weekly' ? rulesFromDays(days) : []),
    [dayMode, days],
  );
  const rulesCheck = useMemo(() => validateRules(rules), [rules]);
  // A pattern with a mistake makes no sessions yet, but the days added by hand stay visible.
  const activeRules = useMemo(
    () => (rulesCheck.ok ? rules : []),
    [rules, rulesCheck],
  );
  const extras = useMemo(
    () => customSessionsOf(custom, start, end),
    [custom, start, end],
  );
  const customDates = useMemo(
    () => [...new Set(extras.map((s) => s.date))],
    [extras],
  );
  const customErrors = useMemo(() => customDayErrors(custom), [custom]);

  // Every session the new group will have, and what is wrong with them.
  const planned = useMemo(
    () =>
      periodError
        ? []
        : planSessions(activeRules, start, end, {
            removed: dayMode === 'weekly' ? removed : [],
            moved: dayMode === 'weekly' ? moved : [],
            extras,
          }),
    [periodError, activeRules, start, end, dayMode, removed, moved, extras],
  );
  const planError = useMemo(
    () =>
      periodError
        ? 'none'
        : validatePlan(planned, start, end, activeRules.length > 0),
    [periodError, planned, start, end, activeRules],
  );
  const patternOk =
    !periodError &&
    planError === null &&
    (dayMode === 'calendar' || rulesCheck.ok);
  // A session of today that is already over is not created (the server does the same).
  const [now] = useState(() => new Date());
  const drafts = useMemo(() => withoutEnded(planned, now), [planned, now]);
  const skippedCount = planned.length - drafts.length;
  // The price is required: a number above zero.
  const parsedPrice = parseDinarsToMillimes(price);
  const priceMillimes =
    parsedPrice !== undefined && parsedPrice > 0 ? parsedPrice : null;
  const priceInvalid = priceMillimes === null;

  // ------------------------------------------------------ the months of the preview calendar
  const months = useMemo(() => {
    if (dayMode === 'weekly')
      return periodError ? [] : monthsBetween(start, end);
    const first = startOfMonth(pickedPeriod?.start ?? today);
    const last = startOfMonth(pickedPeriod?.end ?? today);
    return monthsBetween(
      addMonths(first, -monthsBefore),
      addMonths(last, monthsAfter),
    );
  }, [
    dayMode,
    periodError,
    start,
    end,
    pickedPeriod?.start,
    pickedPeriod?.end,
    today,
    monthsBefore,
    monthsAfter,
  ]);
  const windowStart = months.length > 0 ? `${months[0]}-01` : '';
  const windowEnd =
    months.length > 0 ? endOfMonth(`${months[months.length - 1]}-01`) : '';
  const windowKey = `${windowStart}|${windowEnd}`;

  // ------------------------------------------------- the teacher's sessions in those months
  // Tagged with the months they were loaded for: when the months change they count as "not
  // loaded yet" until the new ones arrive.
  const [loaded, setLoaded] = useState<{
    key: string;
    sessions: ExistingSession[];
  } | null>(null);
  const existing = loaded?.key === windowKey ? loaded.sessions : null;

  useEffect(() => {
    if (step !== 2 || !windowStart) return;
    let cancelled = false;
    loadScheduledAction(windowStart, windowEnd).then((result) => {
      if (!cancelled)
        setLoaded({
          key: `${windowStart}|${windowEnd}`,
          sessions: result.ok ? result.sessions : [],
        });
    });
    return () => {
      cancelled = true;
    };
  }, [step, windowStart, windowEnd]);

  const conflicts = useMemo(
    () => (existing ? findConflicts(drafts, existing) : []),
    [drafts, existing],
  );
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

  // ----------------------------------------- changing one day in the preview (day overlay)
  const withoutExtra = (
    current: CustomDays,
    slot: SessionDraft,
  ): CustomDays => {
    const left = (current[slot.date] ?? []).filter(
      (s) => s.startTime !== slot.startTime || s.endTime !== slot.endTime,
    );
    const next = { ...current };
    if (left.length > 0) next[slot.date] = left;
    else delete next[slot.date];
    return next;
  };
  const withExtra = (current: CustomDays, slot: SessionDraft): CustomDays => ({
    ...current,
    [slot.date]: [
      ...(current[slot.date] ?? []),
      { startTime: slot.startTime, endTime: slot.endTime },
    ],
  });
  const movedEntryOf = (session: PlannedSession) =>
    moved.find(
      (m) => m.from.date === session.originalDate && sameSlot(m.to, session),
    );

  const slotOf = (s: SessionDraft): SessionDraft => ({
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
  });

  function addToDay(slot: SessionDraft) {
    setCustom((current) => withExtra(current, slot));
  }
  function deleteFromDay(session: PlannedSession) {
    if (session.origin === 'manual') {
      setCustom((current) => withoutExtra(current, session));
    } else if (session.origin === 'rule') {
      setRemoved((current) => [...current, slotOf(session)]);
    } else {
      const entry = movedEntryOf(session);
      if (!entry) return;
      setMoved((current) => current.filter((m) => m !== entry));
      setRemoved((current) => [...current, entry.from]);
    }
  }
  function editInDay(session: PlannedSession, to: SessionDraft) {
    if (session.origin === 'manual') {
      setCustom((current) => withExtra(withoutExtra(current, session), to));
    } else if (session.origin === 'rule') {
      setMoved((current) => [
        ...current,
        { from: slotOf(session), to: slotOf(to) },
      ]);
    } else {
      const entry = movedEntryOf(session);
      if (!entry) return;
      // Put back on the slot it came from: it is simply a pattern session again.
      setMoved((current) =>
        current.flatMap((m) =>
          m !== entry
            ? [m]
            : sameSlot(m.from, to)
              ? []
              : [{ from: m.from, to }],
        ),
      );
    }
  }

  function chooseDayMode(mode: 'weekly' | 'calendar') {
    if (mode === dayMode) return;
    setDayMode(mode);
    setCustom({});
    setRemoved([]);
    setMoved([]);
    setMonthsBefore(0);
    setMonthsAfter(0);
  }

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
        rules: activeRules,
        customSessions:
          dayMode === 'calendar' || extras.length > 0 ? extras : undefined,
        removedSessions:
          dayMode === 'weekly' && removed.length > 0 ? removed : undefined,
        movedSessions:
          dayMode === 'weekly' && moved.length > 0 ? moved : undefined,
        pricingModel: pricing,
        referencePriceMillimes: priceMillimes as number,
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

  const periodText = (periodStart: string, periodEnd: string) =>
    t('periodSummary', {
      start: formatDay(periodStart, locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
      end: formatDay(periodEnd, locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
      days: periodDays(periodStart, periodEnd),
    });

  const adjustmentCount = removed.length + moved.length + extras.length;
  // The days the overlay may add to or move a session to.
  const minDate = dayMode === 'weekly' && start > today ? start : today;
  const maxDate = dayMode === 'weekly' ? end : null;

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
        <section className="space-y-2 rounded-card border border-border bg-surface p-4 sm:p-6">
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
        <section className="space-y-5">
          <fieldset className="space-y-2 rounded-card border border-border bg-surface p-4">
            <legend className="px-1 font-medium">{t('dayMode.label')}</legend>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-8">
              {(['weekly', 'calendar'] as const).map((mode) => (
                <label key={mode} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="day-mode"
                    checked={dayMode === mode}
                    onChange={() => chooseDayMode(mode)}
                    className="size-5 accent-primary"
                  />
                  {t(`dayMode.${mode}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {dayMode === 'weekly' ? (
            <div className="space-y-4 rounded-card border border-border bg-surface p-4">
              <fieldset className="space-y-1">
                <legend className="font-medium">{t('endMode.label')}</legend>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-8">
                  {(['date', 'weeks'] as const).map((mode) => (
                    <label
                      key={mode}
                      className="flex min-h-11 items-center gap-3"
                    >
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
                </div>
              </fieldset>

              {/* Both columns start with a title line and then the calendar (or the weeks
                  field), so the two calendars sit at the same height. */}
              <div className="grid items-start gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="min-h-6 font-medium">
                    {t('startLabel')}
                    {startPicked !== '' &&
                      ` : ${formatDay(startPicked, locale, { dateStyle: 'medium' })}`}
                  </p>
                  <div className="mx-auto max-w-sm">
                    <DayPicker
                      initialMonth={monthOf(startPicked || today)}
                      isSelected={(date) => date === startPicked}
                      isDisabled={() => false}
                      onPick={setStartPicked}
                    />
                  </div>
                </div>

                {endMode === 'date' ? (
                  <div className="space-y-2">
                    <p className="min-h-6 font-medium">
                      {t('endLabel')}
                      {endPicked !== '' &&
                        ` : ${formatDay(endPicked, locale, { dateStyle: 'medium' })}`}
                    </p>
                    <div className="mx-auto max-w-sm">
                      <DayPicker
                        initialMonth={monthOf(
                          endPicked || startPicked || today,
                        )}
                        isSelected={(date) => date === endPicked}
                        isDisabled={(date) =>
                          startPicked !== '' && date < startPicked
                        }
                        onPick={setEndPicked}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label
                      htmlFor="group-weeks"
                      className="block min-h-6 font-medium"
                    >
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
              </div>
              {end !== '' && (
                <p
                  role="status"
                  className={
                    'rounded-md bg-secondary p-3 text-sm ' +
                    (periodError ? 'text-accent' : 'font-medium text-primary')
                  }
                >
                  {periodError
                    ? t(`periodErrors.${periodError}`)
                    : periodText(start, end)}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-card border border-border bg-surface p-4">
              <div>
                <h2 className="text-lg font-semibold text-primary">
                  {t('custom.pickTitle')}
                </h2>
                <p className="text-sm text-muted">{t('custom.pickHint')}</p>
                <p role="status" className="mt-1 text-sm font-medium">
                  {t('custom.pickedCount', { count: customDates.length })}
                </p>
              </div>
              <div className="mx-auto max-w-sm">
                <DayPicker
                  initialMonth={monthOf(today)}
                  minMonth={monthOf(today)}
                  maxMonth={monthOf(addMonths(today, PICK_MONTHS_AHEAD))}
                  isSelected={(date) => Boolean(custom[date])}
                  isDisabled={(date) => date < today}
                  onPick={toggleCustomDay}
                />
              </div>
              {pickedPeriod && (
                <p
                  role="status"
                  className={
                    'rounded-md bg-secondary p-3 text-sm ' +
                    (periodError ? 'text-accent' : 'font-medium text-primary')
                  }
                >
                  {periodError
                    ? t(`periodErrors.${periodError}`)
                    : `${t('custom.computedPeriod')} ${periodText(start, end)}`}
                </p>
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
              <p className="mt-1 text-sm text-muted">{t('previewEditHint')}</p>
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

            {dayMode === 'weekly' && adjustmentCount > 0 && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <p role="status">
                  {t('adjust.summary', {
                    added: extras.length,
                    changed: moved.length,
                    removed: removed.length,
                  })}
                </p>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => {
                    setCustom({});
                    setRemoved([]);
                    setMoved([]);
                  }}
                >
                  {t('adjust.reset')}
                </button>
              </div>
            )}

            {periodError && dayMode === 'calendar' && pickedPeriod && (
              <p role="alert" className="text-sm text-accent">
                {t(`periodErrors.${periodError}`)}
              </p>
            )}
            {planError && planError !== 'none' && (
              <p role="alert" className="text-sm text-accent">
                {t(`ruleErrors.${planError}` as 'ruleErrors.none')}
              </p>
            )}

            {skippedCount > 0 && (
              <p role="status" className="text-sm text-muted">
                {t('previewSkipped', { count: skippedCount })}
              </p>
            )}

            {existing === null && months.length > 0 && (
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

            {dayMode === 'calendar' && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={months.length === 0 || months[0] <= monthOf(today)}
                  onClick={() => setMonthsBefore((n) => n + 1)}
                >
                  {t('showPreviousMonth')}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setMonthsAfter((n) => n + 1)}
                >
                  {t('showNextMonth')}
                </button>
              </div>
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
                      const usable =
                        dayMode === 'weekly'
                          ? date >= start && date <= end
                          : date >= today;
                      const isNew = draftDates.has(date);
                      const isConflict = conflictDates.has(date);
                      const count = counts.get(date) ?? 0;
                      return (
                        <button
                          type="button"
                          onClick={() => setOpenDay(date)}
                          disabled={!usable}
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
          <div className="space-y-4 rounded-card border border-border bg-surface p-4 sm:p-6">
            <fieldset className="space-y-1">
              <legend className="font-medium">{t('pricingLabel')}</legend>
              <div className="flex flex-col gap-1 sm:flex-row sm:gap-8">
                {(['per_session', 'per_month'] as const).map((model) => (
                  <label
                    key={model}
                    className="flex min-h-11 items-center gap-3"
                  >
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
              </div>
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
                aria-invalid={price.trim() !== '' && priceInvalid}
              />
              <p
                id="group-price-hint"
                className={
                  'text-sm ' +
                  (price.trim() !== '' && priceInvalid
                    ? 'text-accent'
                    : 'text-muted')
                }
              >
                {price.trim() !== '' && priceInvalid
                  ? t('priceError')
                  : t('priceHint')}
              </p>
            </div>
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
                  : summarizeRules(activeRules)
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
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
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

      {/* ------------------------------------------------------------- day overlay */}
      {openDay && (
        <WizardDayOverlay
          key={openDay}
          date={openDay}
          groupName={name.trim() || t('dayOverlay.newGroup')}
          planned={drafts.filter((d) => d.date === openDay)}
          items={dayItems(openDay)}
          minDate={minDate}
          maxDate={maxDate}
          onAdd={addToDay}
          onEdit={editInDay}
          onDelete={deleteFromDay}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}
