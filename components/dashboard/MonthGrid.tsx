import type { ReactNode } from 'react';
import { daysInMonth, weekdayOf } from '@/lib/dashboard/dates';

/**
 * The days of one month in rows of seven, Monday first (spec 5.10). It only places the days:
 * what is drawn in each one is given by `renderDay`, so the calendar page, the year view and
 * the group wizard share it.
 */
export function MonthGrid({
  month,
  weekdayLabels,
  renderDay,
  compact = false,
}: {
  /** "2026-09" */
  month: string;
  weekdayLabels: string[];
  renderDay: (date: string) => ReactNode;
  compact?: boolean;
}) {
  const [year, monthNumber] = month.split('-').map(Number);
  const count = daysInMonth(year, monthNumber);
  const blanks = weekdayOf(`${month}-01`) - 1;

  return (
    <div
      role="grid"
      className={'grid grid-cols-7 ' + (compact ? 'gap-0.5' : 'gap-1')}
    >
      {weekdayLabels.map((label, index) => (
        <div
          key={index}
          role="columnheader"
          className="pb-1 text-center text-xs font-medium text-muted"
        >
          {label}
        </div>
      ))}
      {Array.from({ length: blanks }, (_, i) => (
        <div key={`blank-${i}`} role="presentation" />
      ))}
      {Array.from({ length: count }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, '0')}`;
        return (
          <div key={date} role="gridcell" className="flex justify-center">
            {renderDay(date)}
          </div>
        );
      })}
    </div>
  );
}
