'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  changeCalendarAction,
  loadScheduledAction,
} from '@/app/[locale]/(dashboard)/dashboard-actions';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';
import { useRouter } from '@/i18n/navigation';
import {
  addMonths,
  endOfMonth,
  isPast,
  monthOf,
  monthsBetween,
  startOfMonth,
} from '@/lib/dashboard/dates';
import { formatDay } from '@/lib/dashboard/format';
import {
  findConflicts,
  sameSlot,
  validatePeriod,
  validateRules,
  type Conflict,
  type ExistingSession,
  type Rule,
  type SessionDraft,
} from '@/lib/dashboard/schedule';
import { ConflictList } from './ConflictList';
import { DayPicker } from './DayPicker';
import type { TimelineItem } from './DayTimeline';
import { GroupCalendarPreview } from './GroupCalendarPreview';
import { toConflictLines } from './GroupWizard';
import {
  dayErrorsOf,
  daysFromRules,
  rulesFromDays,
  WeekPatternEditor,
  type Days,
} from './WeekPatternEditor';
import { WizardDayOverlay, type OverlaySession } from './WizardDayOverlay';

type SavedSession = SessionDraft & {
  id: string;
  origin: 'rule' | 'moved' | 'extra' | 'manual';
  originalDate: string | null;
};

/**
 * "Modifier calendrier" (spec 5.3).
 *  - Every group: touch a day of the calendar to add a session on that exact day, or to edit
 *    (date and times) or delete one of its sessions. Nothing is saved until "Enregistrer".
 *  - A group with a weekly pattern also gets the pattern and the end date, rebuilt FROM an
 *    effective date; sessions moved one by one are kept unless the box is ticked.
 *  - A group whose days were picked in a calendar has no pattern: only the calendar.
 * Past sessions are never touched. "Voir ce qui va changer" runs the pattern change without
 * saving it, and the calendar then marks the days it would add and remove.
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
  sessions: SavedSession[];
  today: string;
}) {
  const t = useTranslations('groups.change');
  const tw = useTranslations('groups.wizard');
  const tp = useTranslations('groups.preview');
  const tcal = useTranslations('calendar');
  const locale = useLocale();
  const router = useRouter();

  const weekly = group.rules.length > 0;
  const [days, setDays] = useState<Days>(() => daysFromRules(group.rules));
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [endDate, setEndDate] = useState(group.endDate);
  const [resetModified, setResetModified] = useState(false);
  // The day-by-day changes, kept here until "Enregistrer".
  const [added, setAdded] = useState<SessionDraft[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [edited, setEdited] = useState<Record<string, SessionDraft>>({});
  const [monthsBefore, setMonthsBefore] = useState(0);
  const [monthsAfter, setMonthsAfter] = useState(0);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    removed: SessionDraft[];
    created: SessionDraft[];
    removedCount: number;
    createdCount: number;
  } | null>(null);
  const [serverConflicts, setServerConflicts] = useState<Conflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => new Date());

  const rules = useMemo(() => rulesFromDays(days), [days]);
  const check = useMemo(() => validateRules(rules), [rules]);
  const dayErrors = useMemo(() => dayErrorsOf(rules, check), [rules, check]);
  const periodError = validatePeriod(group.startDate, endDate);
  const dateError = effectiveDate < today || effectiveDate === '';
  const dirty =
    added.length > 0 || deletedIds.length > 0 || Object.keys(edited).length > 0;
  const stagedChange = () => setPreview(null);

  // ------------------------------------------- the group's sessions after the staged changes
  const view: OverlaySession[] = useMemo(() => {
    const saved = sessions
      .filter((s) => !deletedIds.includes(s.id))
      .map((s): OverlaySession => {
        const to = edited[s.id];
        const handMade = s.origin === 'extra' || s.origin === 'manual';
        if (to)
          return {
            id: s.id,
            ...to,
            origin: handMade ? 'manual' : 'moved',
            originalDate: handMade ? null : (s.originalDate ?? s.date),
          };
        return {
          id: s.id,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          origin: s.origin === 'extra' ? 'manual' : s.origin,
          originalDate: s.originalDate,
          locked: isPast(s, now),
        };
      });
    return [
      ...saved,
      ...added.map((a): OverlaySession => ({
        ...a,
        origin: 'manual',
        originalDate: null,
      })),
    ].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
    );
  }, [sessions, deletedIds, edited, added, now]);

  // ----------------------------------------------------------------- the months shown
  const months = useMemo(() => {
    const dates = [
      group.startDate,
      group.endDate,
      ...(weekly && !periodError ? [endDate] : []),
      ...view.map((s) => s.date),
    ].sort();
    return monthsBetween(
      addMonths(startOfMonth(dates[0]), -monthsBefore),
      addMonths(startOfMonth(dates[dates.length - 1]), monthsAfter),
    );
  }, [
    group.startDate,
    group.endDate,
    weekly,
    periodError,
    endDate,
    view,
    monthsBefore,
    monthsAfter,
  ]);
  const windowStart = `${months[0]}-01`;
  const windowEnd = endOfMonth(`${months[months.length - 1]}-01`);
  const windowKey = `${windowStart}|${windowEnd}`;

  // The teacher's OTHER groups in those months, to show them and to catch overlaps early.
  const [loaded, setLoaded] = useState<{
    key: string;
    sessions: ExistingSession[];
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadScheduledAction(windowStart, windowEnd).then((result) => {
      if (!cancelled)
        setLoaded({
          key: `${windowStart}|${windowEnd}`,
          sessions: result.ok
            ? result.sessions.filter((s) => s.groupId !== group.id)
            : [],
        });
    });
    return () => {
      cancelled = true;
    };
  }, [windowStart, windowEnd, group.id]);
  const others = loaded?.key === windowKey ? loaded.sessions : null;

  const clientConflicts = useMemo(
    () =>
      others
        ? findConflicts(
            view.filter((s) => !s.locked),
            others,
          )
        : [],
    [view, others],
  );
  const shownConflicts =
    serverConflicts.length > 0 ? serverConflicts : clientConflicts;

  // ------------------------------------------------------------------ the calendar below
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const session of view)
      result[session.date] = (result[session.date] ?? 0) + 1;
    for (const session of preview?.removed ?? [])
      result[session.date] = (result[session.date] ?? 0) - 1;
    for (const session of preview?.created ?? [])
      result[session.date] = (result[session.date] ?? 0) + 1;
    return result;
  }, [view, preview]);

  const dayItems = (date: string): TimelineItem[] => [
    ...(others ?? [])
      .filter((s) => s.date === date)
      .map((s) => ({
        id: s.id,
        label: s.groupName,
        startTime: s.startTime,
        endTime: s.endTime,
        color: '#64748b',
      })),
    ...view
      .filter((s) => s.date === date)
      .map((s, index) => ({
        id: `own-${index}`,
        label: group.name,
        startTime: s.startTime,
        endTime: s.endTime,
        color: clientConflicts.some((c) => c.draft.date === date)
          ? '#b91c1c'
          : group.color,
        highlight: !s.id || s.id in edited,
      })),
  ];

  // ----------------------------------------------- changing one day (the day overlay)
  function addToDay(slot: SessionDraft) {
    setAdded((current) => [...current, slot]);
    stagedChange();
  }
  function deleteFromDay(session: OverlaySession) {
    if (session.id) {
      const id = session.id;
      setDeletedIds((current) => [...current, id]);
      setEdited((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } else {
      setAdded((current) => current.filter((a) => !sameSlot(a, session)));
    }
    stagedChange();
  }
  function editInDay(session: OverlaySession, to: SessionDraft) {
    const slot = {
      date: to.date,
      startTime: to.startTime,
      endTime: to.endTime,
    };
    if (session.id) {
      const id = session.id;
      const original = sessions.find((s) => s.id === id);
      setEdited((current) => {
        const next = { ...current };
        // Put back where it was: nothing to change any more.
        if (original && sameSlot(original, slot)) delete next[id];
        else next[id] = slot;
        return next;
      });
    } else {
      setAdded((current) =>
        current.map((a) => (sameSlot(a, session) ? slot : a)),
      );
    }
    stagedChange();
  }
  function undoDayChanges() {
    setAdded([]);
    setDeletedIds([]);
    setEdited({});
    stagedChange();
  }

  function run(dryRun: boolean) {
    setError(null);
    setServerConflicts([]);
    if (dryRun) setPreview(null);
    startTransition(async () => {
      const result = await changeCalendarAction(
        group.id,
        {
          effectiveDate,
          endDate: weekly ? endDate : group.endDate,
          rules: weekly ? rules : [],
          resetModified: weekly ? resetModified : false,
          addedSessions: added,
          deletedSessionIds: deletedIds,
          editedSessions: Object.entries(edited).map(([id, to]) => ({
            id,
            to,
          })),
        },
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
        setServerConflicts(result.conflicts ?? []);
        setPreview(null);
        return;
      }
      setError(result.ok ? 'generic' : result.reason);
    });
  }

  const ready =
    (weekly ? check.ok && !periodError && !dateError : dirty) &&
    clientConflicts.length === 0;
  const dayCount = {
    added: added.length,
    changed: Object.keys(edited).length,
    removed: deletedIds.length,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-primary">
          {t('title', { name: group.name })}
        </h1>
        <p className="text-muted">{t(weekly ? 'intro' : 'introManual')}</p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
        >
          {t(`errors.${error}` as 'errors.generic')}
        </p>
      )}

      {weekly && (
        <>
          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t('patternSection')}
              </h2>
              <p className="text-sm text-muted">{t('patternSectionHint')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="font-medium">
                  {t('effective')}
                  {effectiveDate !== '' &&
                    ` : ${formatDay(effectiveDate, locale, { dateStyle: 'medium' })}`}
                </p>
                <DayPicker
                  initialMonth={monthOf(effectiveDate || today)}
                  minMonth={monthOf(today)}
                  isSelected={(date) => date === effectiveDate}
                  isDisabled={(date) => date < today}
                  onPick={(date) => {
                    setEffectiveDate(date);
                    setPreview(null);
                  }}
                />
                <p
                  className={
                    'text-sm ' + (dateError ? 'text-accent' : 'text-muted')
                  }
                >
                  {dateError ? t('errors.invalid_date') : t('effectiveHint')}
                </p>
              </div>
              <div className="space-y-2">
                <p className="font-medium">
                  {t('endDate')}
                  {endDate !== '' &&
                    ` : ${formatDay(endDate, locale, { dateStyle: 'medium' })}`}
                </p>
                <DayPicker
                  initialMonth={monthOf(endDate || group.endDate)}
                  isSelected={(date) => date === endDate}
                  isDisabled={(date) => date < group.startDate}
                  onPick={(date) => {
                    setEndDate(date);
                    setPreview(null);
                  }}
                />
                <p
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
            </div>

            <h3 className="font-semibold text-primary">{tw('patternTitle')}</h3>
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
                <span className="block text-sm text-muted">
                  {t('resetHint')}
                </span>
              </span>
            </label>
            <p className="text-sm text-muted">{t('deletedNote')}</p>
          </section>

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
        </>
      )}

      <section aria-labelledby="change-preview" className="space-y-3">
        <div>
          <h2
            id="change-preview"
            className="text-lg font-semibold text-primary"
          >
            {tp('title')}
          </h2>
          <p className="text-sm text-muted">{t('calendarHint')}</p>
        </div>

        {dirty && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p role="status">{t('adjustSummary', dayCount)}</p>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={undoDayChanges}
            >
              {t('adjustReset')}
            </button>
          </div>
        )}

        {others === null && (
          <p role="status" className="text-sm text-muted">
            {tw('loadingExisting')}
          </p>
        )}
        {shownConflicts.length > 0 && (
          <>
            <ConflictList lines={toConflictLines(shownConflicts)} />
            <p className="text-sm text-accent">{tw('conflictsBlock')}</p>
          </>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={months[0] <= monthOf(today)}
            onClick={() => setMonthsBefore((n) => n + 1)}
          >
            {tw('showPreviousMonth')}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setMonthsAfter((n) => n + 1)}
          >
            {tw('showNextMonth')}
          </button>
        </div>

        <GroupCalendarPreview
          months={months}
          counts={counts}
          color={group.color}
          locale={locale}
          today={today}
          added={[
            ...(preview?.created.map((s) => s.date) ?? []),
            ...added.map((s) => s.date),
          ]}
          removed={[
            ...(preview?.removed.map((s) => s.date) ?? []),
            ...sessions
              .filter((s) => deletedIds.includes(s.id))
              .map((s) => s.date),
          ]}
          conflictDays={clientConflicts.map((c) => c.draft.date)}
          onDayClick={setOpenDay}
          labels={{
            sessions: (count) => tcal('sessionsCount', { count }),
            legendSessions: tp('legend'),
            legendAdded: tp('legendAdded'),
            legendRemoved: tp('legendRemoved'),
          }}
        />
      </section>

      <div className="flex flex-wrap gap-3">
        {weekly && (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={!ready || pending}
            onClick={() => run(true)}
          >
            {t('preview')}
          </button>
        )}
        <button
          type="button"
          className={buttonClass}
          disabled={!ready || pending}
          onClick={() => run(false)}
        >
          {pending ? t('saving') : t('save')}
        </button>
      </div>

      {openDay && (
        <WizardDayOverlay
          key={openDay}
          date={openDay}
          groupName={group.name}
          planned={view.filter((s) => s.date === openDay)}
          items={dayItems(openDay)}
          minDate={today}
          maxDate={null}
          onAdd={addToDay}
          onEdit={editInDay}
          onDelete={deleteFromDay}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}
