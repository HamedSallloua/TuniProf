import { timeToMinutes } from '@/lib/dashboard/dates';

export type TimelineItem = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  color: string;
  /** Greyed out: a cancelled session. */
  muted?: boolean;
  /** Drawn with a thicker outline: the session being created. */
  highlight?: boolean;
};

const HOUR_HEIGHT = 48; // pixels per hour

/** Two items that overlap are drawn side by side (only possible in a preview with conflicts). */
function assignLanes(
  items: TimelineItem[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );
  const laneEnds: number[] = [];
  const result = new Map<string, { lane: number; lanes: number }>();
  for (const item of sorted) {
    const start = timeToMinutes(item.startTime);
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = timeToMinutes(item.endTime);
    result.set(item.id, { lane, lanes: 1 });
  }
  const lanes = Math.max(1, laneEnds.length);
  for (const value of result.values()) value.lanes = lanes;
  return result;
}

/**
 * The hourly timeline of one day (spec 5.4): every block sits at its real start and end, such as
 * 13:20 to 15:45. The hours shown run from 07:00 to 22:00, or wider if a session is outside.
 */
export function DayTimeline({
  items,
  ariaLabel,
}: {
  items: TimelineItem[];
  ariaLabel: string;
}) {
  const starts = items.map((i) => timeToMinutes(i.startTime));
  const ends = items.map((i) => timeToMinutes(i.endTime));
  const firstHour = Math.min(7, ...starts.map((m) => Math.floor(m / 60)));
  const lastHour = Math.max(22, ...ends.map((m) => Math.ceil(m / 60)));
  const hours = Array.from(
    { length: lastHour - firstHour },
    (_, i) => firstHour + i,
  );
  const lanes = assignLanes(items);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative ms-12"
      style={{ height: hours.length * HOUR_HEIGHT }}
    >
      {hours.map((hour, index) => (
        <div
          key={hour}
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-border"
          style={{ top: index * HOUR_HEIGHT }}
        >
          <span
            dir="ltr"
            className="absolute -start-12 -top-2.5 w-10 text-end text-xs text-muted"
          >
            {String(hour).padStart(2, '0')}:00
          </span>
        </div>
      ))}

      {items.map((item) => {
        const start = timeToMinutes(item.startTime);
        const end = timeToMinutes(item.endTime);
        const place = lanes.get(item.id) ?? { lane: 0, lanes: 1 };
        return (
          <div
            key={item.id}
            className={
              'absolute overflow-hidden rounded-md border-s-4 px-2 py-0.5 text-xs leading-tight ' +
              (item.muted ? 'opacity-50 ' : '') +
              (item.highlight ? 'ring-2 ring-accent' : '')
            }
            style={{
              top: ((start - firstHour * 60) / 60) * HOUR_HEIGHT,
              height: Math.max(20, ((end - start) / 60) * HOUR_HEIGHT - 2),
              insetInlineStart: `${(place.lane / place.lanes) * 100}%`,
              width: `${100 / place.lanes - 1}%`,
              borderColor: item.color,
              backgroundColor: `${item.color}22`,
            }}
          >
            <span className="font-semibold">{item.label}</span>{' '}
            <bdi dir="ltr">
              {item.startTime}-{item.endTime}
            </bdi>
          </div>
        );
      })}
    </div>
  );
}
