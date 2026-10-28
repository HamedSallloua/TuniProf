import { addDays } from './dates';

// Names of days and months for the screens, from the browser's own date formatting (French or
// Arabic), always in the Africa/Tunis time zone so a date never shifts by one day.

function formatter(locale: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
}

// 2026-09-07 is a Monday: a fixed starting point for the names of the weekdays.
const MONDAY = '2026-09-07';

/** weekday 1 = Monday ... 7 = Sunday. "lun." / "lundi" / "الاثنين". */
export function weekdayName(
  weekday: number,
  locale: string,
  style: 'short' | 'long' | 'narrow' = 'short',
): string {
  return formatter(locale, { weekday: style }).format(
    new Date(`${addDays(MONDAY, weekday - 1)}T00:00:00Z`),
  );
}

/** The seven names, Monday first. */
export function weekdayNames(
  locale: string,
  style: 'short' | 'long' | 'narrow' = 'short',
): string[] {
  return [1, 2, 3, 4, 5, 6, 7].map((n) => weekdayName(n, locale, style));
}

export function formatDay(
  date: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'long' },
): string {
  return formatter(locale, options).format(new Date(`${date}T00:00:00Z`));
}

/** "septembre 2026" for a month written "2026-09". */
export function monthTitle(month: string, locale: string): string {
  return formatter(locale, { month: 'long', year: 'numeric' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
}

export function monthName(month: string, locale: string): string {
  return formatter(locale, { month: 'long' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
}

/** "Lun. 14 sept." for a conflict line or a row. */
export function shortDay(date: string, locale: string): string {
  return formatDay(date, locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "Lun 08:00-10:00 · Mer 14:00-16:00" (spec 5.5), from the rules of a group. */
export function scheduleText(
  rules: {
    weekday: number;
    startTime: string;
    endTime: string;
    slotNo?: number;
  }[],
  locale: string,
): string {
  const byDay = new Map<number, string[]>();
  for (const rule of [...rules].sort(
    (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
  )) {
    byDay.set(rule.weekday, [
      ...(byDay.get(rule.weekday) ?? []),
      `${rule.startTime.slice(0, 5)}-${rule.endTime.slice(0, 5)}`,
    ]);
  }
  return [...byDay.entries()]
    .map(
      ([weekday, slots]) =>
        `${weekdayName(weekday, locale)} ${slots.join(', ')}`,
    )
    .join(' · ');
}
