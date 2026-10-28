// Dates and times of the Dashboard (spec 1, 5.1). They are LOCAL Tunisian values written as
// text, "2026-09-07" and "08:00", and are never converted between time zones. The weekday
// numbers follow the spec: 1 = Monday ... 7 = Sunday (weeks start on Monday).

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1970 &&
    year <= 2200 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** "08:30" -> 510. */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** The database returns "08:00:00"; the application works with "08:00". */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}

function toUtcMs(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** 1 = Monday ... 7 = Sunday. */
export function weekdayOf(date: string): number {
  const day = new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

export function startOfWeek(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

/** Every date from `from` to `to`, both included. Empty when `to` is before `from`. */
export function eachDate(from: string, to: string): string[] {
  const days = diffDays(from, to);
  return days < 0
    ? []
    : Array.from({ length: days + 1 }, (_, i) => addDays(from, i));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Adds months like PostgreSQL does: the day is kept, or the last day of a shorter month
 * (31 January + 1 month = 28 February). The database checks the 14-month limit with the same
 * rule, so the form and the database agree.
 */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  const newYear = Math.floor(index / 12);
  const newMonth = (index % 12) + 1;
  const newDay = Math.min(day, daysInMonth(newYear, newMonth));
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** First day of the month of `date`. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const [year, month] = date.split('-').map(Number);
  return `${date.slice(0, 7)}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
}

/** Today's date and time in Tunisia, whatever the server's own time zone. */
export function tunisNow(now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** Is this slot over? Past sessions are locked (spec 5.3). A session ends at its end time. */
export function isPast(
  session: { date: string; endTime: string },
  now: Date,
): boolean {
  const today = tunisNow(now);
  if (session.date !== today.date) return session.date < today.date;
  return timeToMinutes(shortTime(session.endTime)) <= timeToMinutes(today.time);
}

/** Every month from the one of `from` to the one of `to`, as "2026-09": the cards of a preview. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (
    let month = monthOf(from);
    month <= monthOf(to);
    month = monthOf(addMonths(startOfMonth(`${month}-01`), 1))
  )
    months.push(month);
  return months;
}
