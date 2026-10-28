import {
  addDays,
  addMonths,
  diffDays,
  eachDate,
  isPast,
  isValidDate,
  isValidTime,
  shortTime,
  timeToMinutes,
  weekdayOf,
} from './dates';

// The rules of a group's calendar (spec 5.2, 5.3), as plain functions: the wizard and the
// server both use them, and the database checks the important ones again (migration 0016).

export type Rule = {
  /** 1 = Monday ... 7 = Sunday. */
  weekday: number;
  /** 1 to 3: up to three sessions a day. */
  slotNo: number;
  startTime: string;
  endTime: string;
};

export type SessionDraft = {
  date: string;
  startTime: string;
  endTime: string;
};

/** A session already in the calendar, with the group it belongs to. */
export type ExistingSession = SessionDraft & {
  id: string;
  groupId: string;
  groupName: string;
};

export type Conflict = { draft: SessionDraft; with: ExistingSession };

// ----------------------------------------------------------------------------- group data

export const NAME_MIN = 2;
export const NAME_MAX = 50;
export const MAX_PERIOD_MONTHS = 14;
export const MAX_SLOTS_PER_DAY = 3;
/** At most this many rows in one "Ajouter une séance" request. */
export const MAX_ADDED_SESSIONS = 50;

export function validateName(name: string): boolean {
  const length = name.trim().length;
  return length >= NAME_MIN && length <= NAME_MAX;
}

export type PeriodError = 'invalid_date' | 'end_before_start' | 'too_long';

/** End on or after start, at most 14 months (spec 5.2 step 2). */
export function validatePeriod(
  startDate: string,
  endDate: string,
): PeriodError | null {
  if (!isValidDate(startDate) || !isValidDate(endDate)) return 'invalid_date';
  if (endDate < startDate) return 'end_before_start';
  if (endDate > addMonths(startDate, MAX_PERIOD_MONTHS)) return 'too_long';
  return null;
}

/** 60 weeks is the most that always fits in 14 months (the shortest 14 months last 424 days). */
export const MAX_PERIOD_WEEKS = 60;

/**
 * The last day of a period given as a number of weeks from its first day: 1 week starting
 * Wednesday 28 October ends Tuesday 3 November (7 days, the first one included). Null when the
 * number is not a whole number from 1 to 60.
 */
export function endDateAfterWeeks(
  startDate: string,
  weeks: number,
): string | null {
  if (!isValidDate(startDate)) return null;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_PERIOD_WEEKS)
    return null;
  return addDays(startDate, weeks * 7 - 1);
}

/** "7 sept. 2026 -> 21 sept. 2026, 15 jours": the number of days, both ends included. */
export function periodDays(startDate: string, endDate: string): number {
  return diffDays(startDate, endDate) + 1;
}

// ---------------------------------------------------------------------------- weekly rules

export type RuleError =
  | 'none' // no session at all
  | 'weekday'
  | 'slot'
  | 'time_format'
  | 'end_before_start' // the end is not after the start (so also "within one day")
  | 'overlap_same_day'
  | 'too_many_slots';

export type RulesCheck =
  { ok: true } | { ok: false; errors: { index: number; code: RuleError }[] };

/** Each weekday has 1 to 3 sessions, each ending after it starts, none overlapping another. */
export function validateRules(rules: Rule[]): RulesCheck {
  if (rules.length === 0)
    return { ok: false, errors: [{ index: -1, code: 'none' }] };

  const errors: { index: number; code: RuleError }[] = [];
  rules.forEach((rule, index) => {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7)
      errors.push({ index, code: 'weekday' });
    else if (
      !Number.isInteger(rule.slotNo) ||
      rule.slotNo < 1 ||
      rule.slotNo > MAX_SLOTS_PER_DAY
    )
      errors.push({ index, code: 'slot' });
    else if (!isValidTime(rule.startTime) || !isValidTime(rule.endTime))
      errors.push({ index, code: 'time_format' });
    else if (timeToMinutes(rule.endTime) <= timeToMinutes(rule.startTime))
      errors.push({ index, code: 'end_before_start' });
  });
  if (errors.length > 0) return { ok: false, errors };

  const byDay = new Map<number, number[]>();
  rules.forEach((rule, index) => {
    byDay.set(rule.weekday, [...(byDay.get(rule.weekday) ?? []), index]);
  });
  for (const indexes of byDay.values()) {
    if (indexes.length > MAX_SLOTS_PER_DAY) {
      errors.push({
        index: indexes[MAX_SLOTS_PER_DAY],
        code: 'too_many_slots',
      });
      continue;
    }
    if (new Set(indexes.map((i) => rules[i].slotNo)).size !== indexes.length) {
      errors.push({ index: indexes[0], code: 'slot' });
      continue;
    }
    for (let a = 0; a < indexes.length; a++) {
      for (let b = a + 1; b < indexes.length; b++) {
        if (overlaps(rules[indexes[a]], rules[indexes[b]]))
          errors.push({ index: indexes[b], code: 'overlap_same_day' });
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** "Lun 08:00-10:00 · Mer 14:00-16:00" is built from this: rules grouped by weekday. */
export function summarizeRules(
  rules: Rule[],
): { weekday: number; slots: { startTime: string; endTime: string }[] }[] {
  const days = new Map<number, { startTime: string; endTime: string }[]>();
  for (const rule of [...rules].sort(
    (a, b) =>
      a.weekday - b.weekday ||
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  )) {
    days.set(rule.weekday, [
      ...(days.get(rule.weekday) ?? []),
      {
        startTime: shortTime(rule.startTime),
        endTime: shortTime(rule.endTime),
      },
    ]);
  }
  return [...days.entries()].map(([weekday, slots]) => ({ weekday, slots }));
}

// ------------------------------------------------------------------- days picked by hand

/** At most this many sessions in one group when the days are picked by hand. */
export const MAX_CUSTOM_SESSIONS = 1000;

export type CustomSessionError =
  | 'none' // nothing picked
  | 'too_many'
  | 'outside_period'
  | 'time_format'
  | 'end_before_start'
  | 'overlap_same_day'
  | 'too_many_per_day';

/**
 * The sessions of a group whose days were picked in a calendar (spec 5.2, owner request after
 * M8): each one inside the period, ending after it starts, at most three a day, none
 * overlapping another of the same day.
 */
export function validateCustomSessions(
  sessions: SessionDraft[],
  startDate: string,
  endDate: string,
): CustomSessionError | null {
  if (sessions.length === 0) return 'none';
  if (sessions.length > MAX_CUSTOM_SESSIONS) return 'too_many';
  return checkSessions(sessions, startDate, endDate);
}

/** The per-session and per-day checks shared by hand-picked days and a whole planned group. */
function checkSessions(
  sessions: SessionDraft[],
  startDate: string,
  endDate: string,
): CustomSessionError | null {
  for (const session of sessions) {
    if (
      !isValidDate(session.date) ||
      session.date < startDate ||
      session.date > endDate
    )
      return 'outside_period';
    if (!isValidTime(session.startTime) || !isValidTime(session.endTime))
      return 'time_format';
    if (timeToMinutes(session.endTime) <= timeToMinutes(session.startTime))
      return 'end_before_start';
  }
  const byDate = new Map<string, SessionDraft[]>();
  for (const session of sessions)
    byDate.set(session.date, [...(byDate.get(session.date) ?? []), session]);
  for (const sameDay of byDate.values()) {
    if (sameDay.length > MAX_SLOTS_PER_DAY) return 'too_many_per_day';
    for (let a = 0; a < sameDay.length; a++)
      for (let b = a + 1; b < sameDay.length; b++)
        if (overlaps(sameDay[a], sameDay[b])) return 'overlap_same_day';
  }
  return null;
}

// ---------------------------------------------------------------------------- generation

/**
 * One session for every date of the period whose weekday has a rule, one per slot
 * (spec 5.3 "Generation"). `fromDate` leaves out everything before it (used when only the
 * future of a calendar is rebuilt).
 */
export function generateSessions(
  rules: Rule[],
  startDate: string,
  endDate: string,
  fromDate?: string,
): SessionDraft[] {
  const first = fromDate && fromDate > startDate ? fromDate : startDate;
  const byWeekday = new Map<number, Rule[]>();
  for (const rule of rules)
    byWeekday.set(rule.weekday, [...(byWeekday.get(rule.weekday) ?? []), rule]);

  const drafts: SessionDraft[] = [];
  for (const date of eachDate(first, endDate)) {
    for (const rule of byWeekday.get(weekdayOf(date)) ?? []) {
      drafts.push({
        date,
        startTime: shortTime(rule.startTime),
        endTime: shortTime(rule.endTime),
      });
    }
  }
  return drafts;
}

/**
 * A new calendar never gets sessions that are already over: at 16:25 a 08:00-10:00 session of
 * today is left out (it would be a lesson in the past). A session in progress is kept.
 */
export function withoutEnded<T extends SessionDraft>(
  drafts: T[],
  now: Date = new Date(),
): T[] {
  return drafts.filter((draft) => !isPast(draft, now));
}

// ------------------------------------------------------------- a group as the wizard plans it

/** Where a planned session comes from: the weekly pattern, an edit of one, or a day added by hand. */
export type PlannedOrigin = 'rule' | 'moved' | 'manual';

export type PlannedSession = SessionDraft & {
  origin: PlannedOrigin;
  /** The date a moved session was generated on; null for the others. */
  originalDate: string | null;
};

/** A session made by the weekly pattern that the teacher edited in the wizard. */
export type SlotMove = { from: SessionDraft; to: SessionDraft };

/**
 * What the teacher changed by hand next to the weekly pattern (owner request after M8):
 * `removed` and `moved` name sessions the pattern would generate (by date and times),
 * `extras` are days added one by one. Without a pattern only `extras` count.
 */
export type Adjustments = {
  removed: SessionDraft[];
  moved: SlotMove[];
  extras: SessionDraft[];
};

export const NO_ADJUSTMENTS: Adjustments = {
  removed: [],
  moved: [],
  extras: [],
};

export function slotKey(slot: SessionDraft): string {
  return `${slot.date}|${shortTime(slot.startTime)}|${shortTime(slot.endTime)}`;
}

export function sameSlot(a: SessionDraft, b: SessionDraft): boolean {
  return slotKey(a) === slotKey(b);
}

function normalized(slot: SessionDraft): SessionDraft {
  return {
    date: slot.date,
    startTime: shortTime(slot.startTime),
    endTime: shortTime(slot.endTime),
  };
}

/**
 * Every session the new group will have: the pattern's sessions, minus the removed ones, with the
 * edited ones at their new slot (origin `moved`, remembering the date they came from), plus the
 * days added by hand (origin `manual`). An adjustment that names a session the pattern does not
 * generate is ignored. Oldest first. The wizard preview and the server use this same function.
 */
export function planSessions(
  rules: Rule[],
  startDate: string,
  endDate: string,
  adjustments: Adjustments,
): PlannedSession[] {
  const generated =
    rules.length > 0 ? generateSessions(rules, startDate, endDate) : [];
  const removed = new Set(adjustments.removed.map(slotKey));
  const moves = new Map(adjustments.moved.map((m) => [slotKey(m.from), m.to]));

  const planned: PlannedSession[] = [];
  for (const session of generated) {
    const key = slotKey(session);
    if (removed.has(key)) continue;
    const to = moves.get(key);
    if (to) {
      planned.push({
        ...normalized(to),
        origin: 'moved',
        originalDate: session.date,
      });
    } else {
      planned.push({ ...session, origin: 'rule', originalDate: null });
    }
  }
  for (const extra of adjustments.extras)
    planned.push({
      ...normalized(extra),
      origin: 'manual',
      originalDate: null,
    });

  return planned.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );
}

/**
 * The checks on a planned group: every session inside the period, ending after it starts, at
 * most three a day, none overlapping another of the same day. An empty plan is accepted only
 * when there is a weekly pattern (a period whose sessions are all over, or all removed).
 */
export function validatePlan(
  planned: SessionDraft[],
  startDate: string,
  endDate: string,
  hasPattern: boolean,
): CustomSessionError | null {
  if (planned.length === 0) return hasPattern ? null : 'none';
  return checkSessions(planned, startDate, endDate);
}

/** The first and last day of a list of dates, or null when it is empty. */
export function periodOfDates(
  dates: string[],
): { start: string; end: string } | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

// ------------------------------------------------------------------------------ conflicts

/** Two slots overlap when each starts before the other ends (touching ends do not overlap). */
export function overlaps(
  a: { startTime: string; endTime: string },
  b: { startTime: string; endTime: string },
): boolean {
  return (
    timeToMinutes(shortTime(a.startTime)) <
      timeToMinutes(shortTime(b.endTime)) &&
    timeToMinutes(shortTime(b.startTime)) < timeToMinutes(shortTime(a.endTime))
  );
}

/**
 * Every new session that overlaps a session already in the calendar, oldest first
 * (acceptance test 1: "Lun. 14 sept. 08:00-10:00 chevauche Groupe B 09:00-11:00").
 */
export function findConflicts(
  drafts: SessionDraft[],
  existing: ExistingSession[],
): Conflict[] {
  const byDate = new Map<string, ExistingSession[]>();
  for (const session of existing)
    byDate.set(session.date, [...(byDate.get(session.date) ?? []), session]);

  const conflicts: Conflict[] = [];
  for (const draft of drafts) {
    for (const session of byDate.get(draft.date) ?? []) {
      if (overlaps(draft, session)) conflicts.push({ draft, with: session });
    }
  }
  return conflicts.sort(
    (a, b) =>
      a.draft.date.localeCompare(b.draft.date) ||
      timeToMinutes(a.draft.startTime) - timeToMinutes(b.draft.startTime),
  );
}

// ---------------------------------------------------------------------------------- badges

/**
 * Sessions per date: the small number under each calendar day (spec 5.2, 5.10, acceptance
 * test 5). It counts SESSIONS, never groups: a group with two sessions that day counts 2.
 */
export function countByDate(sessions: { date: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const session of sessions)
    counts.set(session.date, (counts.get(session.date) ?? 0) + 1);
  return counts;
}

// ----------------------------------------------------------------------------- the editor

export type SlotChange = { date: string; startTime: string; endTime: string };

/** "Confirmer" of "Modifier date" stays disabled until something changed (acceptance test 4). */
export function hasSlotChanged(
  original: SlotChange,
  edited: SlotChange,
): boolean {
  return (
    original.date !== edited.date ||
    shortTime(original.startTime) !== shortTime(edited.startTime) ||
    shortTime(original.endTime) !== shortTime(edited.endTime)
  );
}
