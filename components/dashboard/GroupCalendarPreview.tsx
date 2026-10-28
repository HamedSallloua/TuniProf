import { formatDay, monthTitle, weekdayNames } from '@/lib/dashboard/format';
import { MonthGrid } from './MonthGrid';

/**
 * "Aperçu du calendrier" of ONE group: a card per month, the days with a session of this group
 * filled with the group's colour and the number of sessions under them. It only draws; it works
 * in a page and in a client form. After "Voir ce qui va changer" it also marks the days that
 * are added (outlined) and the days that are removed (crossed out).
 */
export function GroupCalendarPreview({
  months,
  counts,
  color,
  locale,
  today,
  added = [],
  removed = [],
  conflictDays = [],
  onDayClick,
  labels,
}: {
  /** "2026-09", "2026-10", ... */
  months: string[];
  /** Sessions of the group per date. */
  counts: Record<string, number>;
  color: string;
  locale: string;
  today: string;
  added?: string[];
  removed?: string[];
  /** Days drawn in red: a session of this group overlaps another group's. */
  conflictDays?: string[];
  /** When given, every day is a button (a client form passes it to open the day). */
  onDayClick?: (date: string) => void;
  labels: {
    sessions: (count: number) => string;
    legendSessions: string;
    legendAdded?: string;
    legendRemoved?: string;
  };
}) {
  const addedSet = new Set(added);
  const removedSet = new Set(removed);
  const conflictSet = new Set(conflictDays);
  const weekLabels = weekdayNames(locale, 'narrow');

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-full"
            style={{ backgroundColor: color }}
          />
          {labels.legendSessions}
        </span>
        {added.length > 0 && labels.legendAdded && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-full outline outline-2 outline-offset-1"
              style={{ backgroundColor: color, outlineColor: color }}
            />
            {labels.legendAdded}
          </span>
        )}
        {removed.length > 0 && labels.legendRemoved && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-full border border-dashed border-muted"
            />
            {labels.legendRemoved}
          </span>
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((month) => (
          <section
            key={month}
            className="rounded-card border border-border bg-surface p-3"
          >
            <h3 className="mb-2 text-center font-medium first-letter:uppercase">
              {monthTitle(month, locale)}
            </h3>
            <MonthGrid
              month={month}
              weekdayLabels={weekLabels}
              compact
              renderDay={(date) => {
                const count = counts[date] ?? 0;
                const isAdded = addedSet.has(date);
                const isRemoved = removedSet.has(date) && count === 0;
                const isConflict = conflictSet.has(date);
                const Wrapper = onDayClick ? 'button' : 'span';
                return (
                  <Wrapper
                    {...(onDayClick
                      ? {
                          type: 'button' as const,
                          onClick: () => onDayClick(date),
                        }
                      : {})}
                    aria-current={date === today ? 'date' : undefined}
                    className={
                      'flex min-h-11 w-9 flex-col items-center gap-0.5 py-0.5' +
                      (onDayClick ? ' rounded-md hover:bg-secondary' : '')
                    }
                  >
                    <span className="sr-only">
                      {formatDay(date, locale, { dateStyle: 'full' })},{' '}
                      {labels.sessions(count)}
                    </span>
                    <span
                      aria-hidden="true"
                      className={
                        'flex size-8 items-center justify-center rounded-full text-sm ' +
                        (count > 0
                          ? 'font-semibold text-white '
                          : isRemoved
                            ? 'border border-dashed border-muted text-muted line-through '
                            : date === today
                              ? 'font-semibold text-primary ring-1 ring-primary '
                              : '') +
                        (isAdded || isConflict
                          ? 'outline outline-2 outline-offset-1'
                          : '')
                      }
                      style={
                        count > 0
                          ? {
                              backgroundColor: isConflict ? '#b91c1c' : color,
                              outlineColor: isConflict ? '#b91c1c' : color,
                            }
                          : undefined
                      }
                    >
                      {Number(date.slice(8))}
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-3 text-[10px] leading-3 text-muted"
                    >
                      {count > 1 ? count : ''}
                    </span>
                  </Wrapper>
                );
              }}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
