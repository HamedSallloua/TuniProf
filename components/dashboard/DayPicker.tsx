'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { addMonths, monthOf, startOfMonth } from '@/lib/dashboard/dates';
import { formatDay, monthTitle, weekdayNames } from '@/lib/dashboard/format';
import { MonthGrid } from './MonthGrid';

/**
 * One month of a calendar with previous / next arrows, for choosing days by touching them (the
 * group wizard and the editing of a session). It only draws and reports touches: what is
 * selected and what cannot be touched is given by the caller.
 */
export function DayPicker({
  initialMonth,
  minMonth,
  maxMonth,
  isSelected,
  isDisabled,
  onPick,
}: {
  /** "2026-10" */
  initialMonth: string;
  /** The first and last month that can be shown ("2026-10"), when limited. */
  minMonth?: string;
  maxMonth?: string;
  isSelected: (date: string) => boolean;
  isDisabled: (date: string) => boolean;
  onPick: (date: string) => void;
}) {
  const t = useTranslations('groups.page');
  const locale = useLocale();
  const [month, setMonth] = useState(initialMonth);

  const step = (by: number) =>
    setMonth((current) =>
      monthOf(addMonths(startOfMonth(`${current}-01`), by)),
    );
  const atStart = minMonth !== undefined && month <= minMonth;
  const atEnd = maxMonth !== undefined && month >= maxMonth;
  const arrow =
    'flex size-11 items-center justify-center rounded-md border border-border text-lg disabled:opacity-40 rtl:rotate-180';

  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className={arrow}
          onClick={() => step(-1)}
          disabled={atStart}
          aria-label={t('previousMonth')}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <h3 className="text-center font-medium first-letter:uppercase">
          {monthTitle(month, locale)}
        </h3>
        <button
          type="button"
          className={arrow}
          onClick={() => step(1)}
          disabled={atEnd}
          aria-label={t('nextMonth')}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <MonthGrid
        month={month}
        weekdayLabels={weekdayNames(locale, 'narrow')}
        renderDay={(date) => {
          const picked = isSelected(date);
          const disabled = isDisabled(date);
          return (
            <button
              type="button"
              onClick={() => onPick(date)}
              disabled={disabled}
              aria-pressed={picked}
              aria-label={formatDay(date, locale, { dateStyle: 'full' })}
              className="flex min-h-11 w-9 items-center justify-center rounded-md disabled:opacity-40"
            >
              <span
                className={
                  'flex size-8 items-center justify-center rounded-full text-sm ' +
                  (picked
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : disabled
                      ? ''
                      : 'hover:bg-secondary')
                }
              >
                {Number(date.slice(8))}
              </span>
            </button>
          );
        }}
      />
    </div>
  );
}
