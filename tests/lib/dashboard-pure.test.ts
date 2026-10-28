import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  diffDays,
  eachDate,
  endOfMonth,
  isPast,
  isValidDate,
  isValidTime,
  startOfMonth,
  startOfWeek,
  tunisNow,
  weekdayOf,
} from '@/lib/dashboard/dates';
import {
  countByDate,
  currentSchoolYear,
  findConflicts,
  generateSessions,
  hasSlotChanged,
  overlaps,
  periodDays,
  summarizeRules,
  validateName,
  validatePeriod,
  validateRules,
  type ExistingSession,
  type Rule,
} from '@/lib/dashboard/schedule';

const rule = (
  weekday: number,
  slotNo: number,
  startTime: string,
  endTime: string,
): Rule => ({ weekday, slotNo, startTime, endTime });

describe('dates', () => {
  it('knows the weekday: 7 September 2026 is a Monday, weeks start on Monday', () => {
    expect(weekdayOf('2026-09-07')).toBe(1);
    expect(weekdayOf('2026-09-13')).toBe(7); // Sunday
    expect(startOfWeek('2026-09-10')).toBe('2026-09-07');
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07');
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07');
  });

  it('adds days across months and years, and counts days', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-09-07', '2026-09-21')).toBe(14);
    expect(diffDays('2026-09-21', '2026-09-07')).toBe(-14);
    expect(eachDate('2026-09-07', '2026-09-09')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]);
    expect(eachDate('2026-09-09', '2026-09-07')).toEqual([]);
  });

  it('adds months like PostgreSQL: the last day of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-12-31', 2)).toBe('2028-02-29');
    expect(addMonths('2026-09-01', 14)).toBe('2027-11-01');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('finds the first and last day of a month', () => {
    expect(startOfMonth('2026-09-17')).toBe('2026-09-01');
    expect(endOfMonth('2026-09-17')).toBe('2026-09-30');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
  });

  it('checks the format of dates and times', () => {
    expect(isValidDate('2026-09-07')).toBe(true);
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '07/09/2026',
      '2026-9-7',
      '',
      null,
      5,
    ]) {
      expect(isValidDate(bad)).toBe(false);
    }
    expect(isValidTime('08:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    for (const bad of ['24:00', '8:00', '08:60', '08:00:00', '', null]) {
      expect(isValidTime(bad)).toBe(false);
    }
  });

  it('reads the date and time in Tunisia, whatever the server clock', () => {
    // 23:30 UTC is already 00:30 the next day in Tunis (UTC+1, no daylight saving).
    expect(tunisNow(new Date('2026-12-31T23:30:00Z'))).toEqual({
      date: '2027-01-01',
      time: '00:30',
    });
    expect(tunisNow(new Date('2026-09-07T07:05:00Z'))).toEqual({
      date: '2026-09-07',
      time: '08:05',
    });
  });

  it('a session is past once its end time has come; the future is not', () => {
    const now = new Date('2026-09-07T08:30:00Z'); // 09:30 in Tunis
    expect(isPast({ date: '2026-09-06', endTime: '23:00' }, now)).toBe(true);
    expect(isPast({ date: '2026-09-07', endTime: '09:00' }, now)).toBe(true);
    expect(isPast({ date: '2026-09-07', endTime: '09:30' }, now)).toBe(true); // ends right now
    expect(isPast({ date: '2026-09-07', endTime: '09:31' }, now)).toBe(false);
    expect(isPast({ date: '2026-09-07', endTime: '10:00:00' }, now)).toBe(
      false,
    );
    expect(isPast({ date: '2026-09-08', endTime: '08:00' }, now)).toBe(false);
  });
});

describe('group name and period (spec 5.2)', () => {
  it('a name has 2 to 50 characters once trimmed', () => {
    expect(validateName('M')).toBe(false);
    expect(validateName('  M  ')).toBe(false);
    expect(validateName('Ma')).toBe(true);
    expect(validateName('x'.repeat(50))).toBe(true);
    expect(validateName('x'.repeat(51))).toBe(false);
  });

  it('the period ends on or after its start and lasts at most 14 months', () => {
    expect(validatePeriod('2026-09-07', '2026-09-07')).toBeNull();
    expect(validatePeriod('2026-09-07', '2026-09-06')).toBe('end_before_start');
    expect(validatePeriod('2026-09-01', '2027-11-01')).toBeNull();
    expect(validatePeriod('2026-09-01', '2027-11-02')).toBe('too_long');
    expect(validatePeriod('2026-02-30', '2026-03-01')).toBe('invalid_date');
    expect(validatePeriod('2026-09-01', 'x')).toBe('invalid_date');
  });

  it('counts the days of the period, both ends included ("15 jours")', () => {
    expect(periodDays('2026-09-07', '2026-09-21')).toBe(15);
    expect(periodDays('2026-09-07', '2026-09-07')).toBe(1);
  });

  it('"Année scolaire en cours" is 1 September to 30 June', () => {
    expect(currentSchoolYear('2026-10-28')).toEqual({
      start: '2026-09-01',
      end: '2027-06-30',
    });
    expect(currentSchoolYear('2026-09-01')).toEqual({
      start: '2026-09-01',
      end: '2027-06-30',
    });
    expect(currentSchoolYear('2027-03-15')).toEqual({
      start: '2026-09-01',
      end: '2027-06-30',
    });
    expect(currentSchoolYear('2027-08-31')).toEqual({
      start: '2026-09-01',
      end: '2027-06-30',
    });
    expect(validatePeriod('2026-09-01', '2027-06-30')).toBeNull();
  });
});

describe('weekly rules', () => {
  it('accepts one to three sessions a day, one after the other', () => {
    expect(
      validateRules([
        rule(1, 1, '08:00', '10:00'),
        rule(1, 2, '10:00', '12:00'), // touching ends are fine
        rule(1, 3, '14:00', '16:00'),
        rule(3, 1, '08:00', '09:00'),
      ]),
    ).toEqual({ ok: true });
  });

  it('needs at least one session', () => {
    expect(validateRules([])).toEqual({
      ok: false,
      errors: [{ index: -1, code: 'none' }],
    });
  });

  it('refuses an end that is not after the start', () => {
    for (const [start, end] of [
      ['10:00', '10:00'],
      ['10:00', '09:00'],
    ]) {
      expect(validateRules([rule(1, 1, start, end)])).toEqual({
        ok: false,
        errors: [{ index: 0, code: 'end_before_start' }],
      });
    }
  });

  it('refuses bad weekdays, slots and times', () => {
    expect(validateRules([rule(0, 1, '08:00', '09:00')])).toMatchObject({
      ok: false,
    });
    expect(validateRules([rule(8, 1, '08:00', '09:00')])).toMatchObject({
      ok: false,
    });
    expect(validateRules([rule(1, 4, '08:00', '09:00')])).toMatchObject({
      ok: false,
    });
    expect(validateRules([rule(1, 1, '8:00', '09:00')])).toMatchObject({
      ok: false,
    });
    expect(validateRules([rule(1, 1, '08:00', '24:00')])).toMatchObject({
      ok: false,
    });
  });

  it('refuses two sessions of the same day that overlap', () => {
    expect(
      validateRules([
        rule(1, 1, '08:00', '10:00'),
        rule(1, 2, '09:59', '11:00'),
      ]),
    ).toEqual({
      ok: false,
      errors: [{ index: 1, code: 'overlap_same_day' }],
    });
  });

  it('refuses a fourth session on one day and a repeated slot number', () => {
    expect(
      validateRules([
        rule(1, 1, '08:00', '09:00'),
        rule(1, 2, '10:00', '11:00'),
        rule(1, 3, '12:00', '13:00'),
        rule(1, 3, '14:00', '15:00'),
      ]),
    ).toMatchObject({ ok: false });
    expect(
      validateRules([
        rule(1, 1, '08:00', '09:00'),
        rule(1, 1, '10:00', '11:00'),
      ]),
    ).toMatchObject({
      ok: false,
    });
  });

  it('summarises the pattern by weekday and time', () => {
    expect(
      summarizeRules([
        rule(3, 1, '14:00', '16:00'),
        rule(1, 2, '10:00:00', '11:00:00'),
        rule(1, 1, '08:00', '09:00'),
      ]),
    ).toEqual([
      {
        weekday: 1,
        slots: [
          { startTime: '08:00', endTime: '09:00' },
          { startTime: '10:00', endTime: '11:00' },
        ],
      },
      { weekday: 3, slots: [{ startTime: '14:00', endTime: '16:00' }] },
    ]);
  });
});

describe('generating the sessions', () => {
  it('creates one session per slot on every matching weekday (Mondays 08:00-10:00, 7 to 21 September)', () => {
    expect(
      generateSessions(
        [rule(1, 1, '08:00', '10:00')],
        '2026-09-07',
        '2026-09-21',
      ),
    ).toEqual([
      { date: '2026-09-07', startTime: '08:00', endTime: '10:00' },
      { date: '2026-09-14', startTime: '08:00', endTime: '10:00' },
      { date: '2026-09-21', startTime: '08:00', endTime: '10:00' },
    ]);
  });

  it('creates every slot of a day, and accepts times as the database writes them', () => {
    const drafts = generateSessions(
      [rule(2, 1, '08:00:00', '09:00:00'), rule(2, 2, '10:00', '11:00')],
      '2026-09-07',
      '2026-09-13',
    );
    expect(drafts).toEqual([
      { date: '2026-09-08', startTime: '08:00', endTime: '09:00' },
      { date: '2026-09-08', startTime: '10:00', endTime: '11:00' },
    ]);
  });

  it('can start later than the period (rebuilding only the future)', () => {
    const drafts = generateSessions(
      [rule(1, 1, '08:00', '10:00')],
      '2026-09-07',
      '2026-09-28',
      '2026-09-15',
    );
    expect(drafts.map((d) => d.date)).toEqual(['2026-09-21', '2026-09-28']);
    // an effective date before the start changes nothing
    expect(
      generateSessions(
        [rule(1, 1, '08:00', '10:00')],
        '2026-09-07',
        '2026-09-14',
        '2026-01-01',
      ),
    ).toHaveLength(2);
  });

  it('creates nothing when the period has no matching weekday', () => {
    expect(
      generateSessions(
        [rule(7, 1, '08:00', '10:00')],
        '2026-09-07',
        '2026-09-12',
      ),
    ).toEqual([]);
  });
});

describe('conflicts (acceptance test 1)', () => {
  const groupA = (date: string): ExistingSession => ({
    id: `a-${date}`,
    groupId: 'A',
    groupName: 'Groupe A',
    groupStatus: 'active',
    date,
    startTime: '08:00',
    endTime: '10:00',
  });
  const existing = ['2026-09-07', '2026-09-14', '2026-09-21'].map(groupA);

  it('lists every new session that overlaps an existing one', () => {
    const drafts = generateSessions(
      [rule(1, 1, '09:00', '11:00')],
      '2026-09-07',
      '2026-09-21',
    );
    const conflicts = findConflicts(drafts, existing);
    expect(
      conflicts.map((c) => [
        c.draft.date,
        c.draft.startTime,
        c.with.groupName,
        c.with.startTime,
        c.with.endTime,
      ]),
    ).toEqual([
      ['2026-09-07', '09:00', 'Groupe A', '08:00', '10:00'],
      ['2026-09-14', '09:00', 'Groupe A', '08:00', '10:00'],
      ['2026-09-21', '09:00', 'Groupe A', '08:00', '10:00'],
    ]);
  });

  it('touching sessions are not a conflict, and neither are other days', () => {
    expect(
      findConflicts(
        [{ date: '2026-09-07', startTime: '10:00', endTime: '12:00' }],
        existing,
      ),
    ).toEqual([]);
    expect(
      findConflicts(
        [{ date: '2026-09-07', startTime: '06:00', endTime: '08:00' }],
        existing,
      ),
    ).toEqual([]);
    expect(
      findConflicts(
        [{ date: '2026-09-08', startTime: '08:00', endTime: '10:00' }],
        existing,
      ),
    ).toEqual([]);
  });

  it('detects containment and partial overlap on both sides', () => {
    const inside = { startTime: '08:30', endTime: '09:30' };
    const around = { startTime: '07:00', endTime: '11:00' };
    const early = { startTime: '07:00', endTime: '08:01' };
    for (const slot of [inside, around, early]) {
      expect(overlaps(slot, { startTime: '08:00', endTime: '10:00' })).toBe(
        true,
      );
      expect(overlaps({ startTime: '08:00', endTime: '10:00' }, slot)).toBe(
        true,
      );
    }
  });

  it('sorts conflicts by date then time', () => {
    const conflicts = findConflicts(
      [
        { date: '2026-09-14', startTime: '09:00', endTime: '09:30' },
        { date: '2026-09-07', startTime: '09:00', endTime: '09:30' },
      ],
      existing,
    );
    expect(conflicts.map((c) => c.draft.date)).toEqual([
      '2026-09-07',
      '2026-09-14',
    ]);
  });
});

describe('calendar badges (acceptance test 5)', () => {
  it('week of 7 September 2026: group A Mon/Tue/Fri and group B Mon/Wed/Sun give 2, 1, 1, 0, 1, 0, 1', () => {
    const a = generateSessions(
      [
        rule(1, 1, '08:00', '10:00'),
        rule(2, 1, '08:00', '10:00'),
        rule(5, 1, '08:00', '10:00'),
      ],
      '2026-09-01',
      '2026-09-30',
    );
    const b = generateSessions(
      [
        rule(1, 1, '10:00', '12:00'),
        rule(3, 1, '08:00', '10:00'),
        rule(7, 1, '08:00', '10:00'),
      ],
      '2026-09-01',
      '2026-09-30',
    );
    const counts = countByDate([...a, ...b]);
    const week = eachDate('2026-09-07', '2026-09-13').map(
      (date) => counts.get(date) ?? 0,
    );
    expect(week).toEqual([2, 1, 1, 0, 1, 0, 1]);
  });

  it('counts sessions, not groups: a group with two sessions that day counts 2', () => {
    const drafts = generateSessions(
      [rule(1, 1, '08:00', '09:00'), rule(1, 2, '10:00', '11:00')],
      '2026-09-07',
      '2026-09-07',
    );
    expect(countByDate(drafts).get('2026-09-07')).toBe(2);
  });
});

describe('"Modifier date" (acceptance test 4)', () => {
  const original = {
    date: '2026-09-14',
    startTime: '08:00:00',
    endTime: '10:00:00',
  };

  it('nothing changed: "Confirmer" stays disabled', () => {
    expect(
      hasSlotChanged(original, {
        date: '2026-09-14',
        startTime: '08:00',
        endTime: '10:00',
      }),
    ).toBe(false);
  });

  it('a new date, start or end enables it', () => {
    expect(hasSlotChanged(original, { ...original, date: '2026-09-08' })).toBe(
      true,
    );
    expect(hasSlotChanged(original, { ...original, startTime: '08:30' })).toBe(
      true,
    );
    expect(hasSlotChanged(original, { ...original, endTime: '10:15' })).toBe(
      true,
    );
  });

  it('changing something back to the original disables it again', () => {
    const edited = { ...original, date: '2026-09-08' };
    expect(hasSlotChanged(original, edited)).toBe(true);
    expect(hasSlotChanged(original, { ...edited, date: '2026-09-14' })).toBe(
      false,
    );
  });
});
