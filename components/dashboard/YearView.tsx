import { Link } from '@/i18n/navigation';
import { formatDay, monthTitle, weekdayNames } from '@/lib/dashboard/format';
import { MonthGrid } from './MonthGrid';

/**
 * The year (spec 5.10): twelve small months for fast navigation. A month opens that month, a
 * day opens its week. No data beyond navigation.
 */
export function YearView({
  year,
  locale,
  today,
  monthHref,
  dayHref,
}: {
  year: number;
  locale: string;
  today: string;
  monthHref: (month: string) => string;
  dayHref: (date: string) => string;
}) {
  const months = Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`,
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {months.map((month) => (
        <section
          key={month}
          className="rounded-card border border-border bg-surface p-3"
        >
          <h3 className="mb-2 text-center font-medium first-letter:uppercase">
            <Link
              href={monthHref(month)}
              className="text-primary hover:underline"
            >
              {monthTitle(month, locale).replace(/\s?\d{4}$/, '')}
            </Link>
          </h3>
          <MonthGrid
            month={month}
            weekdayLabels={weekdayNames(locale, 'narrow')}
            compact
            renderDay={(date) => (
              <Link
                href={dayHref(date)}
                aria-label={formatDay(date, locale, { dateStyle: 'full' })}
                className={
                  'flex size-8 items-center justify-center rounded-full text-xs hover:bg-secondary ' +
                  (date === today
                    ? 'bg-primary font-semibold text-primary-foreground hover:!bg-accent'
                    : '')
                }
              >
                {Number(date.slice(8))}
              </Link>
            )}
          />
        </section>
      ))}
    </div>
  );
}
