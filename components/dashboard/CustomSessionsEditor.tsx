'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { inputClass, secondaryButtonClass } from '@/components/auth/styles';
import { isValidTime, timeToMinutes } from '@/lib/dashboard/dates';
import { formatDay } from '@/lib/dashboard/format';
import {
  MAX_SLOTS_PER_DAY,
  overlaps,
  type SessionDraft,
} from '@/lib/dashboard/schedule';
import { DEFAULT_SLOTS, type Slot } from './WeekPatternEditor';

// The list of sessions of a group whose days were picked in a calendar (group wizard, owner
// request after M8): one block per picked day, 1 to 3 sessions each with a start and an end.

/** date -> the sessions of that day */
export type CustomDays = Record<string, Slot[]>;

export const DEFAULT_CUSTOM_SLOT: Slot = DEFAULT_SLOTS[0];

/** The picked days of the period as sessions, oldest first. */
export function customSessionsOf(
  days: CustomDays,
  start: string,
  end: string,
): SessionDraft[] {
  return Object.keys(days)
    .filter((date) => date >= start && date <= end)
    .sort()
    .flatMap((date) => days[date].map((slot) => ({ date, ...slot })));
}

/** date -> the first problem of that day (a code of groups.wizard.ruleErrors). */
export function customDayErrors(days: CustomDays): Map<string, string> {
  const errors = new Map<string, string>();
  for (const [date, slots] of Object.entries(days)) {
    for (const slot of slots) {
      if (!isValidTime(slot.startTime) || !isValidTime(slot.endTime))
        errors.set(date, 'time_format');
      else if (timeToMinutes(slot.endTime) <= timeToMinutes(slot.startTime))
        errors.set(date, 'end_before_start');
    }
    if (!errors.has(date)) {
      for (let a = 0; a < slots.length; a++)
        for (let b = a + 1; b < slots.length; b++)
          if (overlaps(slots[a], slots[b]))
            errors.set(date, 'overlap_same_day');
    }
  }
  return errors;
}

export function CustomSessionsEditor({
  days,
  onChange,
  dayErrors,
}: {
  days: CustomDays;
  onChange: (days: CustomDays) => void;
  dayErrors: Map<string, string>;
}) {
  const t = useTranslations('groups.wizard');
  const locale = useLocale();
  const dates = Object.keys(days).sort();
  const [bulk, setBulk] = useState<Slot>(DEFAULT_CUSTOM_SLOT);

  const setSlots = (date: string, slots: Slot[]) =>
    onChange({ ...days, [date]: slots });
  const setSlot = (date: string, index: number, patch: Partial<Slot>) =>
    setSlots(
      date,
      days[date].map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    );
  const setCount = (date: string, count: number) =>
    setSlots(
      date,
      Array.from(
        { length: count },
        (_, i) => days[date][i] ?? DEFAULT_SLOTS[i],
      ),
    );
  const removeDay = (date: string) => {
    const next = { ...days };
    delete next[date];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-surface p-3">
        <p className="font-medium">{t('custom.sameTimesTitle')}</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="bulk-start" className="block text-xs">
              {t('startTime')}
            </label>
            <input
              id="bulk-start"
              type="time"
              dir="ltr"
              value={bulk.startTime}
              onChange={(e) => setBulk({ ...bulk, startTime: e.target.value })}
              className={inputClass + ' !w-32'}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="bulk-end" className="block text-xs">
              {t('endTime')}
            </label>
            <input
              id="bulk-end"
              type="time"
              dir="ltr"
              value={bulk.endTime}
              onChange={(e) => setBulk({ ...bulk, endTime: e.target.value })}
              className={inputClass + ' !w-32'}
            />
          </div>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() =>
              onChange(Object.fromEntries(dates.map((date) => [date, [bulk]])))
            }
          >
            {t('custom.applyToAll')}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">{t('custom.sameTimesHint')}</p>
      </div>

      <ul className="space-y-3">
        {dates.map((date) => {
          const slots = days[date];
          const errorCode = dayErrors.get(date);
          return (
            <li
              key={date}
              className="rounded-card border border-border bg-surface p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium first-letter:uppercase">
                  {formatDay(date, locale, { dateStyle: 'full' })}
                </h3>
                <div className="flex items-center gap-2">
                  <label htmlFor={`cs-count-${date}`} className="text-sm">
                    {t('slotsCount')}
                  </label>
                  <select
                    id={`cs-count-${date}`}
                    value={slots.length}
                    onChange={(e) => setCount(date, Number(e.target.value))}
                    className={inputClass + ' !w-20'}
                  >
                    {Array.from({ length: MAX_SLOTS_PER_DAY }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => removeDay(date)}
                  >
                    {t('custom.removeDay')}
                  </button>
                </div>
              </div>
              <div className="mt-2 space-y-2">
                {slots.map((slot, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[auto_1fr_1fr] items-end gap-2"
                  >
                    <span className="pb-3 text-sm text-muted">
                      {t('slotLabel', { n: index + 1 })}
                    </span>
                    <div className="space-y-1">
                      <label
                        htmlFor={`cs-s-${date}-${index}`}
                        className="block text-xs"
                      >
                        {t('startTime')}
                      </label>
                      <input
                        id={`cs-s-${date}-${index}`}
                        type="time"
                        dir="ltr"
                        value={slot.startTime}
                        onChange={(e) =>
                          setSlot(date, index, { startTime: e.target.value })
                        }
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor={`cs-e-${date}-${index}`}
                        className="block text-xs"
                      >
                        {t('endTime')}
                      </label>
                      <input
                        id={`cs-e-${date}-${index}`}
                        type="time"
                        dir="ltr"
                        value={slot.endTime}
                        onChange={(e) =>
                          setSlot(date, index, { endTime: e.target.value })
                        }
                        className={inputClass}
                      />
                    </div>
                  </div>
                ))}
                {errorCode && (
                  <p role="alert" className="text-sm text-accent">
                    {t(`ruleErrors.${errorCode}` as 'ruleErrors.none')}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
