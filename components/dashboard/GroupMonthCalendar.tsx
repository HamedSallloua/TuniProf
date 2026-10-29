import { formatDay, weekdayNames } from '@/lib/dashboard/format';
import { MonthGrid } from './MonthGrid';

/**
 * The month calendar of "Modifier calendrier": drawn like the month of the Calendrier section
 * (same card, same circles, the number of sessions of all groups under each day) but every day
 * is a button that opens the day. Colours: green = a day with a session of this group, the
 * Calendrier's own tint = a day with sessions of other groups only, red = a session being added
 * or edited that overlaps another one. Today keeps a thin ring. After "Voir ce qui va changer"
 * the days to add are outlined and the days to remove crossed out.
 */
export function GroupMonthCalendar({
  month,
  locale,
  today,
  ownCounts,
  otherCounts,
  added = [],
  removed = [],
  conflictDays = [],
  markedDate,
  onDayClick,
  labels,
}: {
  /** "2026-11" */
  month: string;
  locale: string;
  today: string;
  /** Sessions of this group per date (with the changes being prepared). */
  ownCounts: Record<string, number>;
  /** Sessions of the teacher's other groups per date. */
  otherCounts: Record<string, number>;
  added?: string[];
  removed?: string[];
  conflictDays?: string[];
  /** The date typed in the search, ringed. */
  markedDate?: string;
  onDayClick: (date: string) => void;
  labels: {
    sessions: (count: number) => string;
    legendOwn: string;
    legendOthers: string;
    legendConflict: string;
    legendAdded?: string;
    legendRemoved?: string;
  };
}) {
  const addedSet = new Set(added);
  const removedSet = new Set(removed);
  const conflictSet = new Set(conflictDays);

  const dot = (className: string) => (
    <span
      aria-hidden="true"
      className={'inline-block size-3 rounded-full ' + className}
    />
  );

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1">
          {dot('bg-primary')}
          {labels.legendOwn}
        </span>
        <span className="inline-flex items-center gap-1">
          {dot('bg-secondary border border-border')}
          {labels.legendOthers}
        </span>
        <span className="inline-flex items-center gap-1">
          {dot('bg-red-700')}
          {labels.legendConflict}
        </span>
        {added.length > 0 && labels.legendAdded && (
          <span className="inline-flex items-center gap-1">
            {dot(
              'bg-primary outline outline-2 outline-offset-1 outline-primary',
            )}
            {labels.legendAdded}
          </span>
        )}
        {removed.length > 0 && labels.legendRemoved && (
          <span className="inline-flex items-center gap-1">
            {dot('border border-dashed border-muted')}
            {labels.legendRemoved}
          </span>
        )}
      </p>
      <div className="rounded-card border border-border bg-surface p-3">
        <MonthGrid
          month={month}
          weekdayLabels={weekdayNames(locale, 'short')}
          renderDay={(date) => {
            const own = Math.max(0, ownCounts[date] ?? 0);
            const others = otherCounts[date] ?? 0;
            const count = own + others;
            const isConflict = conflictSet.has(date);
            const isRemoved = removedSet.has(date) && own === 0;
            return (
              <button
                type="button"
                onClick={() => onDayClick(date)}
                aria-current={date === today ? 'date' : undefined}
                aria-label={`${formatDay(date, locale, { dateStyle: 'full' })}, ${labels.sessions(count)}`}
                className="flex min-h-12 w-10 flex-col items-center gap-0.5 rounded-md py-0.5 hover:bg-secondary"
              >
                <span
                  className={
                    'flex size-8 items-center justify-center rounded-full text-sm ' +
                    (isConflict
                      ? 'bg-red-700 font-semibold text-white '
                      : own > 0
                        ? 'bg-primary font-semibold text-primary-foreground '
                        : others > 0
                          ? 'bg-secondary font-medium text-secondary-foreground '
                          : isRemoved
                            ? 'border border-dashed border-muted text-muted line-through '
                            : '') +
                    (date === today ? 'ring-1 ring-primary ' : '') +
                    (addedSet.has(date)
                      ? 'outline outline-2 outline-offset-1 outline-primary '
                      : '') +
                    (date === markedDate
                      ? 'ring-2 ring-primary ring-offset-2'
                      : '')
                  }
                >
                  {Number(date.slice(8))}
                </span>
                <span className="h-3 text-[11px] leading-3 text-muted">
                  {count > 0 ? count : ''}
                </span>
              </button>
            );
          }}
        />
      </div>
    </div>
  );
}
