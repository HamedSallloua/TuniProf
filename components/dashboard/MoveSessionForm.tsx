'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { moveSessionAction } from '@/app/[locale]/(dashboard)/dashboard-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { useRouter } from '@/i18n/navigation';
import { isValidDate, isValidTime, timeToMinutes } from '@/lib/dashboard/dates';
import { formatDay } from '@/lib/dashboard/format';
import { hasSlotChanged, type ExistingSession } from '@/lib/dashboard/schedule';
import { ConflictList, type ConflictLine } from './ConflictList';

export function conflictLinesFor(
  slot: { date: string; startTime: string; endTime: string },
  others: ExistingSession[],
): ConflictLine[] {
  return others.map((other) => ({
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    groupName: other.groupName,
    otherStart: other.startTime,
    otherEnd: other.endTime,
  }));
}

/**
 * "Modifier date" (spec 5.3): one occurrence moves to a new date and time. "Confirmer" stays
 * disabled until something changed (acceptance test 4), and "Retour" with unsaved changes asks
 * what to do: Enregistrer / Quitter sans enregistrer / Annuler.
 */
export function MoveSessionForm({
  session,
  returnTo,
  today,
}: {
  session: {
    id: string;
    groupName: string;
    date: string;
    startTime: string;
    endTime: string;
  };
  returnTo: string;
  today: string;
}) {
  const t = useTranslations('calendar.move');
  const td = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();

  const original = {
    date: session.date,
    startTime: session.startTime,
    endTime: session.endTime,
  };
  const [slot, setSlot] = useState(original);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ConflictLine[]>([]);
  const [pending, startTransition] = useTransition();

  const changed = hasSlotChanged(original, slot);
  const valid =
    isValidDate(slot.date) &&
    isValidTime(slot.startTime) &&
    isValidTime(slot.endTime) &&
    timeToMinutes(slot.endTime) > timeToMinutes(slot.startTime);

  // The browser's own warning when the tab is closed with unsaved changes.
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!changed || saved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed, saved]);

  function save() {
    setError(null);
    setLines([]);
    setConfirmLeave(false);
    startTransition(async () => {
      const result = await moveSessionAction(session.id, slot);
      if (result.ok) {
        setSaved(true);
        const url = new URL(returnTo, 'http://local');
        url.searchParams.set('done', 'moved');
        router.push(`${url.pathname}${url.search}`);
        router.refresh();
        return;
      }
      if (
        result.reason === 'conflict' &&
        'conflicts' in result &&
        result.conflicts?.length
      )
        setLines(conflictLinesFor(slot, result.conflicts));
      setError(result.reason);
    });
  }

  function leave() {
    setSaved(true);
    router.push(returnTo);
  }

  const dateId = 'move-date';
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
        <p className="text-muted">
          {t('current', {
            group: session.groupName,
            day: formatDay(session.date, locale, { dateStyle: 'full' }),
            time: `${session.startTime}-${session.endTime}`,
          })}
        </p>
      </header>

      {error && error !== 'conflict' && (
        <p
          role="alert"
          className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
        >
          {td(`sessionErrors.${error}` as 'sessionErrors.invalid')}
        </p>
      )}
      <ConflictList lines={lines} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor={dateId} className="block font-medium">
            {t('newDate')}
          </label>
          <input
            id={dateId}
            type="date"
            min={today}
            value={slot.date}
            onChange={(e) =>
              setSlot((current) => ({ ...current, date: e.target.value }))
            }
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="move-start" className="block font-medium">
            {t('start')}
          </label>
          <input
            id="move-start"
            type="time"
            dir="ltr"
            value={slot.startTime}
            onChange={(e) =>
              setSlot((current) => ({ ...current, startTime: e.target.value }))
            }
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="move-end" className="block font-medium">
            {t('end')}
          </label>
          <input
            id="move-end"
            type="time"
            dir="ltr"
            value={slot.endTime}
            onChange={(e) =>
              setSlot((current) => ({ ...current, endTime: e.target.value }))
            }
            className={inputClass}
          />
        </div>
      </div>
      {!valid && changed && (
        <p role="alert" className="text-sm text-accent">
          {td('sessionErrors.invalid')}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={!changed || !valid || pending}
          onClick={save}
        >
          {t('confirm')}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={pending}
          onClick={() => (changed ? setConfirmLeave(true) : leave())}
        >
          {t('back')}
        </button>
      </div>

      {confirmLeave && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-title"
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
          onKeyDown={(event) =>
            event.key === 'Escape' && setConfirmLeave(false)
          }
        >
          <div className="w-full max-w-md space-y-4 rounded-t-card bg-surface p-5 sm:rounded-card">
            <h2 id="leave-title" className="text-lg font-semibold text-primary">
              {t('unsaved.title')}
            </h2>
            <p className="text-sm">{t('unsaved.body')}</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                autoFocus
                className={buttonClass}
                disabled={!valid || pending}
                onClick={save}
              >
                {t('unsaved.save')}
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={leave}
              >
                {t('unsaved.leave')}
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setConfirmLeave(false)}
              >
                {t('unsaved.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
