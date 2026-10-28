'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { monthOf, timeToMinutes } from '@/lib/dashboard/dates';
import { formatDay } from '@/lib/dashboard/format';
import {
  hasSlotChanged,
  MAX_SLOTS_PER_DAY,
  overlaps,
  type PlannedSession,
  type SessionDraft,
} from '@/lib/dashboard/schedule';
import { DayPicker } from './DayPicker';
import { DayTimeline, type TimelineItem } from './DayTimeline';

/** A session of the new group, or (in "Modifier calendrier") a session that already exists. */
export type OverlaySession = PlannedSession & {
  /** Set for a session already saved in the database. */
  id?: string;
  /** A session that is over: it is shown but cannot be changed. */
  locked?: boolean;
};

const keyOf = (session: OverlaySession) =>
  session.id ?? `${session.startTime}-${session.endTime}-${session.origin}`;

/**
 * The day overlay of the group wizard (owner request after M8): besides the timeline of the day,
 * the teacher can add a session on this exact day, and edit (date and times) or delete a session
 * of the new group. Nothing is saved until the group is created.
 */
export function WizardDayOverlay({
  date,
  groupName,
  planned,
  items,
  minDate,
  maxDate,
  onAdd,
  onEdit,
  onDelete,
  onClose,
}: {
  date: string;
  groupName: string;
  /** The sessions of the new group on this day (the ones that will really be created). */
  planned: OverlaySession[];
  /** Everything drawn on the timeline: other groups (grey) and the new group. */
  items: TimelineItem[];
  /** The first and last day a session of the new group may be put on. */
  minDate: string;
  maxDate: string | null;
  onAdd: (slot: SessionDraft) => void;
  onEdit: (session: OverlaySession, to: SessionDraft) => void;
  onDelete: (session: OverlaySession) => void;
  onClose: () => void;
}) {
  const t = useTranslations('groups.wizard.dayOverlay');
  const locale = useLocale();

  const [editing, setEditing] = useState<OverlaySession | null>(null);
  const [slot, setSlot] = useState<SessionDraft>({
    date,
    startTime: '08:00',
    endTime: '10:00',
  });
  const [addTimes, setAddTimes] = useState({
    startTime: '08:00',
    endTime: '10:00',
  });

  const inRange = (day: string) =>
    day >= minDate && (maxDate === null || day <= maxDate);
  const timesOk = (times: { startTime: string; endTime: string }) =>
    times.startTime !== '' &&
    times.endTime !== '' &&
    timeToMinutes(times.endTime) > timeToMinutes(times.startTime);

  // ------------------------------------------------------------------------ adding here
  const addError: 'invalid' | 'full' | 'overlap' | null = !timesOk(addTimes)
    ? 'invalid'
    : planned.length >= MAX_SLOTS_PER_DAY
      ? 'full'
      : planned.some((p) => overlaps(p, addTimes))
        ? 'overlap'
        : null;

  // ----------------------------------------------------------------------- editing one
  const original: SessionDraft | null = editing;
  const editChanged = original ? hasSlotChanged(original, slot) : false;
  const editError: 'invalid' | 'overlap' | null = !timesOk(slot)
    ? 'invalid'
    : slot.date === date
      ? planned.some(
          (p) =>
            (editing ? keyOf(p) !== keyOf(editing) : true) && overlaps(p, slot),
        )
        ? 'overlap'
        : null
      : null;

  function startEdit(session: OverlaySession) {
    setEditing(session);
    setSlot({
      date: session.date,
      startTime: session.startTime,
      endTime: session.endTime,
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={formatDay(date, locale, { dateStyle: 'full' })}
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div className="max-h-[85dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-card bg-surface p-4 sm:rounded-card">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-primary">
            {formatDay(date, locale, { dateStyle: 'full' })}
          </h2>
          <button
            type="button"
            autoFocus
            className={secondaryButtonClass}
            onClick={onClose}
          >
            {t('close')}
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-muted">{t('empty')}</p>
        ) : (
          <DayTimeline items={items} ariaLabel={t('timeline')} />
        )}

        {/* ----------------------------------------------- the sessions of the new group */}
        {planned.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-medium">
              {t('yourSessions', { group: groupName })}
            </h3>
            <ul className="space-y-2">
              {planned.map((session) => (
                <li
                  key={keyOf(session)}
                  className="rounded-md border border-border p-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      <span dir="ltr" className="font-medium">
                        {session.startTime}-{session.endTime}
                      </span>{' '}
                      <span className="text-sm text-muted">
                        {t(`origin.${session.origin}`)}
                      </span>
                    </p>
                    {session.locked && (
                      <span className="text-sm text-muted">{t('locked')}</span>
                    )}
                    {!session.locked &&
                      !(editing && keyOf(editing) === keyOf(session)) && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={secondaryButtonClass}
                            onClick={() => startEdit(session)}
                          >
                            {t('edit')}
                          </button>
                          <button
                            type="button"
                            className={secondaryButtonClass}
                            onClick={() => {
                              setEditing(null);
                              onDelete(session);
                            }}
                          >
                            {t('delete')}
                          </button>
                        </div>
                      )}
                  </div>

                  {editing && keyOf(editing) === keyOf(session) && (
                    <div className="mt-3 space-y-3">
                      <p className="text-sm font-medium">{t('newDate')}</p>
                      <DayPicker
                        initialMonth={monthOf(session.date)}
                        minMonth={monthOf(minDate)}
                        maxMonth={maxDate ? monthOf(maxDate) : undefined}
                        isSelected={(day) => day === slot.date}
                        isDisabled={(day) => !inRange(day)}
                        onPick={(day) =>
                          setSlot((current) => ({ ...current, date: day }))
                        }
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label
                            htmlFor="wiz-edit-start"
                            className="block text-sm"
                          >
                            {t('start')}
                          </label>
                          <input
                            id="wiz-edit-start"
                            type="time"
                            dir="ltr"
                            value={slot.startTime}
                            onChange={(e) =>
                              setSlot({ ...slot, startTime: e.target.value })
                            }
                            className={inputClass}
                          />
                        </div>
                        <div className="space-y-1">
                          <label
                            htmlFor="wiz-edit-end"
                            className="block text-sm"
                          >
                            {t('end')}
                          </label>
                          <input
                            id="wiz-edit-end"
                            type="time"
                            dir="ltr"
                            value={slot.endTime}
                            onChange={(e) =>
                              setSlot({ ...slot, endTime: e.target.value })
                            }
                            className={inputClass}
                          />
                        </div>
                      </div>
                      {editError && (
                        <p role="alert" className="text-sm text-accent">
                          {t(`errors.${editError}`)}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={!editChanged || editError !== null}
                          onClick={() => {
                            onEdit(session, slot);
                            setEditing(null);
                          }}
                        >
                          {t('confirm')}
                        </button>
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          onClick={() => setEditing(null)}
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ------------------------------------------------------ add a session this day */}
        {inRange(date) ? (
          <section className="space-y-3 border-t border-border pt-3">
            <h3 className="font-medium">{t('addTitle')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="wiz-add-start" className="block text-sm">
                  {t('start')}
                </label>
                <input
                  id="wiz-add-start"
                  type="time"
                  dir="ltr"
                  value={addTimes.startTime}
                  onChange={(e) =>
                    setAddTimes({ ...addTimes, startTime: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="wiz-add-end" className="block text-sm">
                  {t('end')}
                </label>
                <input
                  id="wiz-add-end"
                  type="time"
                  dir="ltr"
                  value={addTimes.endTime}
                  onChange={(e) =>
                    setAddTimes({ ...addTimes, endTime: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
            </div>
            {addError && (
              <p role="alert" className="text-sm text-accent">
                {t(`errors.${addError}`)}
              </p>
            )}
            <button
              type="button"
              className={buttonClass}
              disabled={addError !== null}
              onClick={() => onAdd({ date, ...addTimes })}
            >
              {t('addButton')}
            </button>
          </section>
        ) : (
          <p className="border-t border-border pt-3 text-sm text-muted">
            {t('outOfRange')}
          </p>
        )}
      </div>
    </div>
  );
}
