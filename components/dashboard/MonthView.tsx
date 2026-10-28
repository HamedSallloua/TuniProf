import { Link } from '@/i18n/navigation';
import { formatDay, weekdayNames } from '@/lib/dashboard/format';
import { MonthGrid } from './MonthGrid';

/**
 * The month (spec 5.10): a circle per day with a small number underneath, the number of
 * SESSIONS that day (all groups). A day opens its overlay.
 */
export function MonthView({
  month,
  counts,
  locale,
  today,
  hrefFor,
  sessionsLabel,
}: {
  month: string;
  counts: Map<string, number>;
  locale: string;
  today: string;
  hrefFor: (date: string) => string;
  /** "{count} séances" for the accessible name of a day. */
  sessionsLabel: (count: number) => string;
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <MonthGrid
        month={month}
        weekdayLabels={weekdayNames(locale, 'short')}
        renderDay={(date) => {
          const count = counts.get(date) ?? 0;
          return (
            <Link
              href={hrefFor(date)}
              aria-label={`${formatDay(date, locale, { dateStyle: 'full' })}, ${sessionsLabel(count)}`}
              className="flex min-h-12 w-10 flex-col items-center gap-0.5 rounded-md py-0.5 hover:bg-secondary"
            >
              <span
                className={
                  'flex size-8 items-center justify-center rounded-full text-sm ' +
                  (date === today
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : count > 0
                      ? 'bg-secondary font-medium text-secondary-foreground'
                      : '')
                }
              >
                {Number(date.slice(8))}
              </span>
              <span className="h-3 text-[11px] leading-3 text-muted">
                {count > 0 ? count : ''}
              </span>
            </Link>
          );
        }}
      />
    </div>
  );
}
