import { Link } from '@/i18n/navigation';
import { addDays, timeToMinutes } from '@/lib/dashboard/dates';
import { formatDay, weekdayName } from '@/lib/dashboard/format';
import type { SessionRow } from '@/lib/dashboard/sessions';

const HOUR_HEIGHT = 48;

/**
 * The week (spec 5.10): days across the top, Monday first, hours down the left (07:00 to 22:00
 * unless a session is outside), one coloured block per session. On a phone about three days
 * show and the rest is one swipe away. A block opens the day.
 */
export function WeekView({
  weekStart,
  sessions,
  locale,
  today,
  hrefFor,
  ariaLabel,
}: {
  weekStart: string;
  sessions: SessionRow[];
  locale: string;
  today: string;
  hrefFor: (date: string) => string;
  ariaLabel: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const starts = sessions.map((s) => timeToMinutes(s.startTime));
  const ends = sessions.map((s) => timeToMinutes(s.endTime));
  const firstHour = Math.min(7, ...starts.map((m) => Math.floor(m / 60)));
  const lastHour = Math.max(22, ...ends.map((m) => Math.ceil(m / 60)));
  const hours = Array.from(
    { length: lastHour - firstHour },
    (_, i) => firstHour + i,
  );
  const height = hours.length * HOUR_HEIGHT;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="max-h-[70dvh] snap-x overflow-auto rounded-card border border-border bg-surface"
    >
      <div className="flex min-w-[40rem] md:min-w-0">
        <div className="sticky start-0 z-10 w-12 shrink-0 bg-surface">
          <div className="h-14 border-b border-border" />
          <div className="relative" style={{ height }}>
            {hours.map((hour, index) => (
              <span
                key={hour}
                dir="ltr"
                className="absolute end-1 -translate-y-1/2 text-xs text-muted"
                style={{ top: index * HOUR_HEIGHT }}
              >
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </div>

        {days.map((date) => {
          const daySessions = sessions.filter((s) => s.date === date);
          return (
            <div
              key={date}
              className="min-w-[5.5rem] flex-1 snap-start border-s border-border"
            >
              <Link
                href={hrefFor(date)}
                className={
                  'flex h-14 flex-col items-center justify-center border-b border-border text-sm hover:bg-secondary ' +
                  (date === today
                    ? 'bg-secondary font-semibold text-primary'
                    : '')
                }
                aria-label={formatDay(date, locale, { dateStyle: 'full' })}
              >
                <span>{weekdayName(weekdayOfDate(date), locale)}</span>
                <span className="text-lg leading-none">
                  {Number(date.slice(8))}
                </span>
              </Link>
              <div className="relative" style={{ height }}>
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t border-border"
                    style={{ top: index * HOUR_HEIGHT }}
                  />
                ))}
                {daySessions.map((session) => {
                  const start = timeToMinutes(session.startTime);
                  const end = timeToMinutes(session.endTime);
                  return (
                    <Link
                      key={session.id}
                      href={hrefFor(date)}
                      className="absolute inset-x-0.5 overflow-hidden rounded-md border-s-4 px-1 py-0.5 text-xs leading-tight hover:brightness-95"
                      style={{
                        top: ((start - firstHour * 60) / 60) * HOUR_HEIGHT,
                        height: Math.max(
                          20,
                          ((end - start) / 60) * HOUR_HEIGHT - 2,
                        ),
                        borderColor: session.groupColor,
                        backgroundColor: `${session.groupColor}22`,
                      }}
                    >
                      <span className="block truncate font-semibold">
                        {session.groupName}
                      </span>
                      <bdi dir="ltr" className="block truncate">
                        {session.startTime}-{session.endTime}
                      </bdi>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function weekdayOfDate(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
