import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import {
  changeCalendar,
  createGroup as createGroupAt,
  deleteGroup,
  getGroup,
  listGroups,
  updateGroupPrice,
  type GroupInput,
} from '@/lib/dashboard/groups';
import { eachDate } from '@/lib/dashboard/dates';
import { countByDate, type Rule } from '@/lib/dashboard/schedule';
import {
  addSession,
  addSessions,
  deleteSession,
  getSession,
  listGroupSessions,
  listSessions,
  moveSession,
  nextSessionByGroup,
  upcomingSessions,
} from '@/lib/dashboard/sessions';
import { clearAuthTables } from './auth-helpers';
import {
  CHECK_VIOLATION,
  createTestPool,
  FOREIGN_KEY_VIOLATION,
  testDatabaseUrl,
  UNIQUE_VIOLATION,
} from './helpers';
import { createAdminUser, createTeacher } from './profile-helpers';

const EXCLUSION_VIOLATION = '23P01';

// A fixed "now" (1 September 2026, 10:00 in Tunis) so nothing depends on the real date.
const NOW = new Date('2026-09-01T09:00:00Z');

// Creating a group leaves out sessions that are already over, so it always gets a fixed "now".
const createGroup = (
  pool: Pool,
  owner: string,
  input: GroupInput,
  now: Date = NOW,
) => createGroupAt(pool, owner, input, now);

const rule = (
  weekday: number,
  slotNo: number,
  startTime: string,
  endTime: string,
): Rule => ({
  weekday,
  slotNo,
  startTime,
  endTime,
});

const mondays = (
  start: string,
  end: string,
  from = '08:00',
  to = '10:00',
): GroupInput => ({
  name: 'Groupe A',
  startDate: start,
  endDate: end,
  rules: [rule(1, 1, from, to)],
  pricingModel: 'per_session',
  referencePriceMillimes: 20000,
});

describe.skipIf(!testDatabaseUrl)(
  'dashboard: groups and sessions (database)',
  () => {
    let pool: Pool;
    let teacher: string;
    let other: string;

    beforeAll(async () => {
      pool = createTestPool();
      await runMigrations(pool);
    });

    beforeEach(async () => {
      await clearAuthTables(pool);
      teacher = await createTeacher(pool);
      other = await createTeacher(pool);
    });

    afterAll(async () => {
      await clearAuthTables(pool);
      await pool.end();
    });

    async function make(owner: string, input: GroupInput) {
      const result = await createGroup(pool, owner, input);
      if (!result.ok) throw new Error(`createGroup failed: ${result.reason}`);
      return result.groupId;
    }

    const dates = async (groupId: string) =>
      (
        await pool.query(
          `SELECT date::text AS date FROM sessions
          WHERE group_id = $1 ORDER BY date, start_time`,
          [groupId],
        )
      ).rows.map((r) => r.date as string);

    // ------------------------------------------------------- the database refuses overlaps

    describe('the database itself (invariant 9)', () => {
      let hour = 0;
      async function groupFor(owner: string) {
        // each group sits at its own time of day: the helper never causes a conflict itself
        hour += 1;
        const at = String(hour).padStart(2, '0');
        return make(owner, {
          ...mondays('2026-09-07', '2026-09-07', `${at}:00`, `${at}:30`),
          name: `G-${Math.random()}`,
        });
      }
      const insert = (
        owner: string,
        group: string,
        date: string,
        start: string,
        end: string,
      ) =>
        pool.query(
          `INSERT INTO sessions (teacher_id, group_id, date, start_time, end_time, origin)
         VALUES ($1, $2, $3, $4, $5, 'extra')`,
          [owner, group, date, start, end],
        );

      it('refuses two overlapping sessions of one teacher, even from different groups', async () => {
        const g1 = await groupFor(teacher);
        const g2 = await groupFor(teacher);
        await insert(teacher, g1, '2026-10-05', '08:00', '10:00');
        await expect(
          insert(teacher, g2, '2026-10-05', '09:00', '11:00'),
        ).rejects.toMatchObject({
          code: EXCLUSION_VIOLATION,
        });
        await expect(
          insert(teacher, g1, '2026-10-05', '08:30', '09:00'),
        ).rejects.toMatchObject({
          code: EXCLUSION_VIOLATION,
        });
        await expect(
          insert(teacher, g2, '2026-10-05', '07:00', '12:00'),
        ).rejects.toMatchObject({
          code: EXCLUSION_VIOLATION,
        });
      });

      it('accepts touching sessions, other days, and other teachers at the same time', async () => {
        const g1 = await groupFor(teacher);
        const g2 = await groupFor(other);
        await insert(teacher, g1, '2026-10-05', '08:00', '10:00');
        await insert(teacher, g1, '2026-10-05', '10:00', '11:00');
        await insert(teacher, g1, '2026-10-05', '07:00', '08:00');
        await insert(teacher, g1, '2026-10-06', '08:00', '10:00');
        await insert(other, g2, '2026-10-05', '08:00', '10:00');
      });

      it('refuses a session that does not end after it starts', async () => {
        const g1 = await groupFor(teacher);
        await expect(
          insert(teacher, g1, '2026-10-05', '10:00', '10:00'),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
        await expect(
          insert(teacher, g1, '2026-10-05', '11:00', '10:00'),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      });

      it('a session belongs to a group of the SAME teacher', async () => {
        const g2 = await groupFor(other);
        await expect(
          insert(teacher, g2, '2026-10-05', '08:00', '10:00'),
        ).rejects.toMatchObject({
          code: FOREIGN_KEY_VIOLATION,
        });
      });

      it('only a teacher account can own a group', async () => {
        const admin = await createAdminUser(pool);
        await expect(
          pool.query(
            `INSERT INTO groups (teacher_id, name, color, start_date, end_date) VALUES ($1, 'Admin group', '#1d4ed8', '2026-09-01', '2026-09-30')`,
            [admin],
          ),
        ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
      });

      it('refuses a period of more than 14 months and an end before the start', async () => {
        const bad = (start: string, end: string) =>
          pool.query(
            `INSERT INTO groups (teacher_id, name, color, start_date, end_date) VALUES ($1, 'Long', '#1d4ed8', $2, $3)`,
            [teacher, start, end],
          );
        await bad('2026-09-01', '2027-11-01');
        await expect(bad('2026-09-01', '2027-11-02')).rejects.toMatchObject({
          code: CHECK_VIOLATION,
        });
        await expect(bad('2026-09-02', '2026-09-01')).rejects.toMatchObject({
          code: CHECK_VIOLATION,
        });
      });

      it('the name is unique among the groups of a teacher, whatever the letter case', async () => {
        const insertGroup = (owner: string, name: string) =>
          pool.query(
            `INSERT INTO groups (teacher_id, name, color, start_date, end_date)
           VALUES ($1, $2, '#1d4ed8', '2026-09-01', '2026-09-30')`,
            [owner, name],
          );
        await insertGroup(teacher, 'Math 4ème');
        await expect(
          insertGroup(teacher, '  math 4ème '),
        ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
        await insertGroup(other, 'Math 4ème'); // another teacher: fine
      });

      it('the sessions of one day of a group cannot overlap (weekly rules)', async () => {
        const group = await groupFor(teacher);
        await pool.query(
          `INSERT INTO schedule_rules (group_id, weekday, slot_no, start_time, end_time) VALUES ($1, 2, 1, '08:00', '10:00')`,
          [group],
        );
        await expect(
          pool.query(
            `INSERT INTO schedule_rules (group_id, weekday, slot_no, start_time, end_time) VALUES ($1, 2, 2, '09:00', '11:00')`,
            [group],
          ),
        ).rejects.toMatchObject({ code: EXCLUSION_VIOLATION });
        await expect(
          pool.query(
            `INSERT INTO schedule_rules (group_id, weekday, slot_no, start_time, end_time) VALUES ($1, 8, 1, '09:00', '11:00')`,
            [group],
          ),
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      });
    });

    // ---------------------------------------------------------------------- creating (test 1)

    describe('creating a group', () => {
      it('creates the group, its rules and one session per matching date', async () => {
        const result = await createGroup(
          pool,
          teacher,
          mondays('2026-09-07', '2026-09-21'),
        );
        expect(result).toMatchObject({ ok: true, sessionCount: 3 });
        if (!result.ok) return;
        expect(await dates(result.groupId)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-21',
        ]);
        const group = await getGroup(pool, teacher, result.groupId);
        expect(group).toMatchObject({
          name: 'Groupe A',
          startDate: '2026-09-07',
          endDate: '2026-09-21',
          pricingModel: 'per_session',
          referencePriceMillimes: 20000,
          rules: [
            { weekday: 1, slotNo: 1, startTime: '08:00', endTime: '10:00' },
          ],
        });
        expect(group?.color).toMatch(/^#[0-9a-f]{6}$/);
      });

      it('lists the conflicts and creates NOTHING when a session overlaps another (acceptance test 1)', async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const result = await createGroup(pool, teacher, {
          ...mondays('2026-09-07', '2026-09-21', '09:00', '11:00'),
          name: 'Groupe B',
        });
        expect(result).toMatchObject({ ok: false, reason: 'conflicts' });
        if (result.ok || result.reason !== 'conflicts') return;
        expect(
          result.conflicts?.map((c) => [
            c.draft.date,
            c.with.groupName,
            c.with.startTime,
            c.with.endTime,
          ]),
        ).toEqual([
          ['2026-09-07', 'Groupe A', '08:00', '10:00'],
          ['2026-09-14', 'Groupe A', '08:00', '10:00'],
          ['2026-09-21', 'Groupe A', '08:00', '10:00'],
        ]);
        expect((await listGroups(pool, teacher)).map((g) => g.name)).toEqual([
          'Groupe A',
        ]);
        expect(
          (await pool.query('SELECT count(*)::int AS n FROM sessions')).rows[0]
            .n,
        ).toBe(3);
      });

      it('does not create a session of today that is already over, but keeps one in progress and later ones', async () => {
        const wednesday430 = new Date('2026-10-28T15:25:00Z'); // 16:25 in Tunis
        const input = (start: string, end: string): GroupInput => ({
          ...mondays('2026-10-28', '2026-10-28'),
          name: `G ${start}`,
          rules: [rule(3, 1, start, end)],
        });
        const over = await createGroup(
          pool,
          teacher,
          input('08:00', '10:00'),
          wednesday430,
        );
        expect(over).toMatchObject({ ok: true, sessionCount: 0 });
        const inProgress = await createGroup(
          pool,
          teacher,
          input('16:00', '17:00'),
          wednesday430,
        );
        expect(inProgress).toMatchObject({ ok: true, sessionCount: 1 });
        const later = await createGroup(
          pool,
          teacher,
          input('18:00', '19:00'),
          wednesday430,
        );
        expect(later).toMatchObject({ ok: true, sessionCount: 1 });
        // and next week's Wednesday at 08:00 is still created
        const nextWeek = await createGroup(
          pool,
          teacher,
          { ...input('08:00', '10:00'), name: 'Next', endDate: '2026-11-04' },
          wednesday430,
        );
        expect(nextWeek).toMatchObject({ ok: true, sessionCount: 1 });
        if (nextWeek.ok)
          expect(await dates(nextWeek.groupId)).toEqual(['2026-11-04']);
      });

      it('two groups of different teachers may use the same slot', async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-21'));
        await make(other, mondays('2026-09-07', '2026-09-21'));
      });

      it('gives different colours to the first groups', async () => {
        const ids = [];
        for (const [i, name] of ['A1', 'B1', 'C1'].entries()) {
          ids.push(
            await make(teacher, {
              ...mondays(
                '2026-09-07',
                '2026-09-07',
                `0${i + 1}:00`,
                `0${i + 1}:30`,
              ),
              name,
            }),
          );
        }
        const colors = (await listGroups(pool, teacher)).map((g) => g.color);
        expect(new Set(colors).size).toBe(3);
      });

      it('refuses an invalid name, period, rule set, price, and a name already used', async () => {
        const base = mondays('2026-09-07', '2026-09-21');
        expect(
          await createGroup(pool, teacher, { ...base, name: 'A' }),
        ).toEqual({ ok: false, reason: 'invalid_name' });
        expect(
          await createGroup(pool, teacher, { ...base, endDate: '2026-09-01' }),
        ).toEqual({ ok: false, reason: 'invalid_period' });
        expect(
          await createGroup(pool, teacher, { ...base, endDate: '2028-01-01' }),
        ).toEqual({ ok: false, reason: 'invalid_period' });
        expect(
          await createGroup(pool, teacher, { ...base, rules: [] }),
        ).toEqual({ ok: false, reason: 'invalid_rules' });
        expect(
          await createGroup(pool, teacher, {
            ...base,
            rules: [rule(1, 1, '10:00', '09:00')],
          }),
        ).toEqual({ ok: false, reason: 'invalid_rules' });
        expect(
          await createGroup(pool, teacher, {
            ...base,
            referencePriceMillimes: -1,
          }),
        ).toEqual({ ok: false, reason: 'invalid_price' });
        expect(
          await createGroup(pool, teacher, {
            ...base,
            referencePriceMillimes: 1.5,
          }),
        ).toEqual({ ok: false, reason: 'invalid_price' });
        // A group cannot be created without a price: zero and "no price" are refused.
        expect(
          await createGroup(pool, teacher, {
            ...base,
            referencePriceMillimes: 0,
          }),
        ).toEqual({ ok: false, reason: 'invalid_price' });
        expect(
          await createGroup(pool, teacher, {
            ...base,
            referencePriceMillimes: null as unknown as number,
          }),
        ).toEqual({ ok: false, reason: 'invalid_price' });

        await make(teacher, base);
        expect(
          await createGroup(pool, teacher, {
            ...base,
            rules: [rule(2, 1, '08:00', '10:00')],
          }),
        ).toEqual({
          ok: false,
          reason: 'name_taken',
        });
      });

      it('keeps the reference price and the pricing model, and trims the name', async () => {
        const id = await make(teacher, {
          ...mondays('2026-09-07', '2026-09-07'),
          name: '  Math 4ème  ',
          pricingModel: 'per_month',
          referencePriceMillimes: 20500,
        });
        expect(await getGroup(pool, teacher, id)).toMatchObject({
          name: 'Math 4ème',
          pricingModel: 'per_month',
          referencePriceMillimes: 20500,
        });
      });

      it('"Modifier Prix" changes the model and the amount, refuses a missing or bad price, and only for the own group', async () => {
        const id = await make(teacher, mondays('2026-09-07', '2026-09-28'));
        expect(
          await updateGroupPrice(pool, teacher, id, 'per_month', 150000),
        ).toEqual({ ok: true });
        expect(await getGroup(pool, teacher, id)).toMatchObject({
          pricingModel: 'per_month',
          referencePriceMillimes: 150000,
        });
        for (const bad of [0, -5, 2.5, null as unknown as number])
          expect(
            await updateGroupPrice(pool, teacher, id, 'per_session', bad),
          ).toEqual({ ok: false, reason: 'invalid_price' });
        expect(
          await updateGroupPrice(pool, other, id, 'per_session', 10000),
        ).toEqual({ ok: false, reason: 'not_found' });
        expect(await getGroup(pool, teacher, id)).toMatchObject({
          pricingModel: 'per_month',
          referencePriceMillimes: 150000,
        });
      });

      it('two simultaneous creations for the same slot: exactly one wins', async () => {
        const results = await Promise.all([
          createGroup(pool, teacher, {
            ...mondays('2026-09-07', '2026-09-28'),
            name: 'Un',
          }),
          createGroup(pool, teacher, {
            ...mondays('2026-09-07', '2026-09-28'),
            name: 'Deux',
          }),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(
          results.filter((r) => !r.ok && r.reason === 'conflicts'),
        ).toHaveLength(1);
        expect(
          (await pool.query('SELECT count(*)::int AS n FROM groups')).rows[0].n,
        ).toBe(1);
      });
    });

    // ----------------------------------------------------------------------- badges (test 5)

    it('week of 7 September 2026: groups Mon/Tue/Fri and Mon/Wed/Sun give 2, 1, 1, 0, 1, 0, 1 (acceptance test 5)', async () => {
      await make(teacher, {
        ...mondays('2026-09-01', '2026-09-30'),
        name: 'Groupe A',
        rules: [
          rule(1, 1, '08:00', '10:00'),
          rule(2, 1, '08:00', '10:00'),
          rule(5, 1, '08:00', '10:00'),
        ],
      });
      await make(teacher, {
        ...mondays('2026-09-01', '2026-09-30'),
        name: 'Groupe B',
        rules: [
          rule(1, 1, '10:00', '12:00'),
          rule(3, 1, '08:00', '10:00'),
          rule(7, 1, '08:00', '10:00'),
        ],
      });
      const sessions = await listSessions(
        pool,
        teacher,
        '2026-09-07',
        '2026-09-13',
      );
      const counts = countByDate(sessions);
      expect(
        eachDate('2026-09-07', '2026-09-13').map((d) => counts.get(d) ?? 0),
      ).toEqual([2, 1, 1, 0, 1, 0, 1]);
    });

    // ------------------------------------------------------------ one session at a time

    describe('"Supprimer" a session for good', () => {
      it('deletes only that date; the other Mondays stay and nothing can bring it back', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-28'));
        const [, second] = await listSessions(
          pool,
          teacher,
          '2026-09-07',
          '2026-09-28',
        );
        expect(second.date).toBe('2026-09-14');

        expect(await deleteSession(pool, teacher, second.id, NOW)).toEqual({
          ok: true,
        });
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-21',
          '2026-09-28',
        ]);
        // really gone: not in the calendar, not found any more
        expect(
          await listSessions(pool, teacher, '2026-09-14', '2026-09-14'),
        ).toEqual([]);
        expect(await getSession(pool, teacher, second.id)).toBeNull();
        expect(await deleteSession(pool, teacher, second.id, NOW)).toEqual({
          ok: false,
          reason: 'not_found',
        });
      });

      it('frees the slot for another group', async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-14'));
        const [first] = await listSessions(
          pool,
          teacher,
          '2026-09-07',
          '2026-09-07',
        );
        await deleteSession(pool, teacher, first.id, NOW);

        const taken = await make(teacher, {
          ...mondays('2026-09-07', '2026-09-07', '09:00', '11:00'),
          name: 'Groupe B',
        });
        expect(await dates(taken)).toEqual(['2026-09-07']);
      });

      it('past sessions are locked', async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-14'));
        const [first] = await listSessions(
          pool,
          teacher,
          '2026-09-07',
          '2026-09-07',
        );
        const over = new Date('2026-09-07T09:00:00Z'); // 10:00 in Tunis: it just ended
        expect(await deleteSession(pool, teacher, first.id, over)).toEqual({
          ok: false,
          reason: 'past',
        });
        expect(
          await moveSession(
            pool,
            teacher,
            first.id,
            { date: '2026-09-20', startTime: '08:00', endTime: '09:00' },
            over,
          ),
        ).toEqual({
          ok: false,
          reason: 'past',
        });

        const later = new Date('2026-09-07T08:30:00Z'); // 09:30 in Tunis: it is running, not over
        expect(await deleteSession(pool, teacher, first.id, later)).toEqual({
          ok: true,
        });
      });
    });

    describe('"Modifier date" (acceptance test 3)', () => {
      it('moves one occurrence: the old slot is free, the new one is taken, the origin is kept', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const [, second] = await listSessions(
          pool,
          teacher,
          '2026-09-07',
          '2026-09-21',
        );
        expect(
          await moveSession(
            pool,
            teacher,
            second.id,
            { date: '2026-09-08', startTime: '12:00', endTime: '14:00' },
            NOW,
          ),
        ).toEqual({ ok: true });

        const moved = await getSession(pool, teacher, second.id);
        expect(moved).toMatchObject({
          date: '2026-09-08',
          startTime: '12:00',
          endTime: '14:00',
          origin: 'moved',
          originalDate: '2026-09-14',
        });
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-08',
          '2026-09-21',
        ]);

        // the old slot (14 Sept 08:00-10:00) is free: another group can take it
        await make(teacher, {
          ...mondays('2026-09-14', '2026-09-14'),
          name: 'Groupe B',
        });
        // the new slot (8 Sept 12:00-14:00) is occupied
        const clash = await createGroup(pool, teacher, {
          ...mondays('2026-09-01', '2026-09-30'),
          name: 'Groupe C',
          rules: [rule(2, 1, '13:00', '15:00')],
        });
        expect(clash).toMatchObject({ ok: false, reason: 'conflicts' });
      });

      it('refuses a target that overlaps another session, and says which', async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-21'));
        await make(teacher, {
          ...mondays('2026-09-01', '2026-09-30'),
          name: 'Groupe B',
          rules: [rule(2, 1, '12:00', '14:00')],
        });
        // the session of Monday 14 September (group A)
        const [second] = await listSessions(
          pool,
          teacher,
          '2026-09-14',
          '2026-09-14',
        );
        const result = await moveSession(
          pool,
          teacher,
          second.id,
          { date: '2026-09-08', startTime: '13:00', endTime: '15:00' },
          NOW,
        );
        expect(result).toMatchObject({ ok: false, reason: 'conflict' });
        if (!result.ok)
          expect(
            result.conflicts?.map((c) => [c.groupName, c.startTime, c.endTime]),
          ).toEqual([['Groupe B', '12:00', '14:00']]);
        // nothing moved
        expect((await getSession(pool, teacher, second.id))?.date).toBe(
          '2026-09-14',
        );
      });

      it('may stay in the same day, even over its own old time, and keeps the FIRST original date', async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const [, second] = await listSessions(
          pool,
          teacher,
          '2026-09-07',
          '2026-09-21',
        );
        expect(
          await moveSession(
            pool,
            teacher,
            second.id,
            { date: '2026-09-14', startTime: '09:00', endTime: '11:00' },
            NOW,
          ),
        ).toEqual({ ok: true });
        expect(
          await moveSession(
            pool,
            teacher,
            second.id,
            { date: '2026-10-02', startTime: '09:00', endTime: '11:00' },
            NOW,
          ),
        ).toEqual({ ok: true });
        expect(await getSession(pool, teacher, second.id)).toMatchObject({
          date: '2026-10-02',
          originalDate: '2026-09-14',
        });
      });

      it('may leave the period of the group (make-up lessons) but not go into the past', async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const [first] = await listSessions(
          pool,
          teacher,
          '2026-09-07',
          '2026-09-21',
        );
        expect(
          await moveSession(
            pool,
            teacher,
            first.id,
            { date: '2026-12-01', startTime: '08:00', endTime: '09:00' },
            NOW,
          ),
        ).toEqual({ ok: true });
        const [second] = await listSessions(
          pool,
          teacher,
          '2026-09-14',
          '2026-09-14',
        );
        expect(
          await moveSession(
            pool,
            teacher,
            second.id,
            { date: '2026-08-30', startTime: '08:00', endTime: '09:00' },
            NOW,
          ),
        ).toEqual({
          ok: false,
          reason: 'new_slot_in_past',
        });
      });

      it('refuses nothing-changed, bad values and sessions that are deleted', async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const [first] = await listSessions(
          pool,
          teacher,
          '2026-09-07',
          '2026-09-07',
        );
        const slot = {
          date: '2026-09-07',
          startTime: '08:00',
          endTime: '10:00',
        };
        expect(await moveSession(pool, teacher, first.id, slot, NOW)).toEqual({
          ok: false,
          reason: 'unchanged',
        });
        expect(
          await moveSession(
            pool,
            teacher,
            first.id,
            { ...slot, endTime: '07:00' },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'invalid' });
        expect(
          await moveSession(
            pool,
            teacher,
            first.id,
            { ...slot, date: '2026-02-30' },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'invalid' });
        expect(
          await moveSession(
            pool,
            teacher,
            first.id,
            { ...slot, startTime: '8:00' },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'invalid' });
        await deleteSession(pool, teacher, first.id, NOW);
        expect(
          await moveSession(
            pool,
            teacher,
            first.id,
            { ...slot, date: '2026-09-08' },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'not_found' });
      });
    });

    describe('"Ajouter une séance"', () => {
      it('adds one extra session, refuses an overlap and a past slot', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const slot = {
          groupId: group,
          date: '2026-09-09',
          startTime: '14:00',
          endTime: '15:30',
        };
        const added = await addSession(pool, teacher, slot, NOW);
        expect(added.ok).toBe(true);
        expect(await getSession(pool, teacher, added.sessionId!)).toMatchObject(
          { origin: 'extra', date: '2026-09-09' },
        );

        expect(
          await addSession(
            pool,
            teacher,
            { ...slot, startTime: '15:00', endTime: '16:00' },
            NOW,
          ),
        ).toMatchObject({
          ok: false,
          reason: 'conflict',
        });
        expect(
          await addSession(pool, teacher, { ...slot, date: '2026-08-31' }, NOW),
        ).toEqual({ ok: false, reason: 'new_slot_in_past' });
        expect(
          await addSession(
            pool,
            teacher,
            { ...slot, date: '2026-09-10', endTime: '13:00' },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'invalid' });

        expect(
          await addSession(
            pool,
            teacher,
            { ...slot, groupId: '00000000-0000-4000-8000-000000000000' },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'group_not_found' });
      });
    });

    describe('"Ajouter une séance" with several rows', () => {
      const row = (date: string, startTime = '14:00', endTime = '15:30') => ({
        date,
        startTime,
        endTime,
      });

      it('adds all the rows in one step, as extra sessions of the group', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const result = await addSessions(
          pool,
          teacher,
          {
            groupId: group,
            sessions: [row('2026-09-09'), row('2026-09-10'), row('2026-09-12')],
          },
          NOW,
        );
        expect(result).toEqual({ ok: true, count: 3 });
        const sessions = await listGroupSessions(pool, teacher, group);
        expect(
          sessions.filter((s) => s.origin === 'extra').map((s) => s.date),
        ).toEqual(['2026-09-09', '2026-09-10', '2026-09-12']);
      });

      it('adds nothing when one row overlaps a session of the calendar, and says which row', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const result = await addSessions(
          pool,
          teacher,
          {
            groupId: group,
            sessions: [
              row('2026-09-09'),
              row('2026-09-14', '09:00', '11:00'), // Monday 08:00-10:00 is there
            ],
          },
          NOW,
        );
        expect(result).toMatchObject({ ok: false, reason: 'conflict' });
        if (result.ok || !result.conflicts) return;
        expect(result.conflicts.map((c) => c.index)).toEqual([1]);
        expect(result.conflicts[0].with.groupName).toBe('Groupe A');
        expect(
          (await listGroupSessions(pool, teacher, group)).filter(
            (s) => s.origin === 'extra',
          ),
        ).toEqual([]);
      });

      it('refuses two rows that overlap each other', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const result = await addSessions(
          pool,
          teacher,
          {
            groupId: group,
            sessions: [
              row('2026-09-09', '14:00', '16:00'),
              row('2026-09-09', '15:00', '17:00'),
            ],
          },
          NOW,
        );
        expect(result).toMatchObject({ ok: false, reason: 'conflict' });
        if (result.ok || !result.conflicts) return;
        expect(result.conflicts.map((c) => c.index)).toEqual([1]);
        // Touching rows are fine.
        expect(
          await addSessions(
            pool,
            teacher,
            {
              groupId: group,
              sessions: [
                row('2026-09-09', '14:00', '15:00'),
                row('2026-09-09', '15:00', '16:00'),
              ],
            },
            NOW,
          ),
        ).toEqual({ ok: true, count: 2 });
      });

      it("refuses bad rows with their number, an empty list, and another teacher's group", async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-21'));
        expect(
          await addSessions(
            pool,
            teacher,
            { groupId: group, sessions: [] },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'empty' });
        expect(
          await addSessions(
            pool,
            teacher,
            {
              groupId: group,
              sessions: [
                row('2026-09-09'),
                row('2026-09-10', '16:00', '15:00'),
              ],
            },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'invalid', index: 1 });
        expect(
          await addSessions(
            pool,
            teacher,
            {
              groupId: group,
              sessions: [row('2026-08-31'), row('2026-09-10')],
            },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'new_slot_in_past', index: 0 });
        expect(
          await addSessions(
            pool,
            other,
            { groupId: group, sessions: [row('2026-09-09')] },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'group_not_found' });
      });
    });

    describe('"Prochaines séances"', () => {
      it('lists the rest of today and tomorrow, not what is over, deleted or later', async () => {
        const group = await make(teacher, {
          ...mondays('2026-09-07', '2026-09-30'),
          rules: [
            rule(1, 1, '08:00', '10:00'),
            rule(1, 2, '14:00', '16:00'),
            rule(2, 1, '09:00', '10:00'),
            rule(3, 1, '09:00', '10:00'),
          ],
        });
        const monday = new Date('2026-09-07T09:30:00Z'); // 10:30 in Tunis: the morning session is over
        const list = await upcomingSessions(pool, teacher, monday);
        expect(list.map((s) => [s.date, s.startTime])).toEqual([
          ['2026-09-07', '14:00'],
          ['2026-09-08', '09:00'],
        ]);

        const afternoon = list[0];
        await deleteSession(pool, teacher, afternoon.id, monday);
        expect(
          (await upcomingSessions(pool, teacher, monday)).map((s) => s.date),
        ).toEqual(['2026-09-08']);
        expect(group).toBeTruthy();
      });
    });

    describe('"Prochaine séance" of each group', () => {
      it('is the next session not over yet, per group, and absent for a group whose sessions are all over', async () => {
        const a = await make(teacher, {
          ...mondays('2026-09-07', '2026-09-30'),
          name: 'Groupe A',
          rules: [rule(1, 1, '08:00', '10:00'), rule(1, 2, '14:00', '16:00')],
        });
        const b = await make(teacher, {
          ...mondays('2026-09-08', '2026-09-08'),
          name: 'Groupe B',
          rules: [rule(2, 1, '09:00', '10:00')],
        });
        await make(other, mondays('2026-09-07', '2026-09-07'));
        const mondayMorning = new Date('2026-09-07T09:30:00Z'); // 10:30 in Tunis
        const next = await nextSessionByGroup(pool, teacher, mondayMorning);
        expect(next.get(a)).toEqual({
          date: '2026-09-07',
          startTime: '14:00',
          endTime: '16:00',
        });
        expect(next.get(b)).toEqual({
          date: '2026-09-08',
          startTime: '09:00',
          endTime: '10:00',
        });
        expect(next.size).toBe(2);
        // After the last session of group B, only group A still has one.
        const later = await nextSessionByGroup(
          pool,
          teacher,
          new Date('2026-09-08T10:00:00Z'),
        );
        expect(later.has(b)).toBe(false);
        expect(later.get(a)?.date).toBe('2026-09-14');
      });
    });

    // ------------------------------------------------------------------------- delete

    describe('deleting', () => {
      it('deleting needs the exact name, and removes the rules and sessions with the group', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-21'));
        expect(await deleteGroup(pool, teacher, group, 'Groupe')).toEqual({
          ok: false,
          reason: 'name_mismatch',
        });
        expect(await deleteGroup(pool, teacher, group, '')).toEqual({
          ok: false,
          reason: 'name_mismatch',
        });
        expect(
          (await pool.query('SELECT count(*)::int AS n FROM sessions')).rows[0]
            .n,
        ).toBe(3);

        expect(await deleteGroup(pool, teacher, group, '  Groupe A ')).toEqual({
          ok: true,
        });
        for (const table of ['groups', 'sessions', 'schedule_rules']) {
          expect(
            (await pool.query(`SELECT count(*)::int AS n FROM ${table}`))
              .rows[0].n,
          ).toBe(0);
        }
        expect(await deleteGroup(pool, teacher, group, 'Groupe A')).toEqual({
          ok: false,
          reason: 'not_found',
        });
      });
    });

    // ------------------------------------------------------------ "Modifier calendrier"

    describe('"Modifier calendrier" from an effective date', () => {
      const now = new Date('2026-09-14T06:00:00Z'); // 07:00 on Monday 14 September in Tunis

      it("keeps today's sessions that are already over when the calendar is rebuilt from today", async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-10-05'));
        const noon = new Date('2026-09-14T11:00:00Z'); // 12:00 in Tunis, the 08:00 session is over
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          {
            effectiveDate: '2026-09-14',
            endDate: '2026-10-05',
            rules: [rule(1, 1, '14:00', '16:00')],
          },
          { now: noon },
        );
        expect(result).toMatchObject({ ok: true, removed: 3, created: 4 });
        expect(
          (
            await pool.query(
              `SELECT date::text AS date, to_char(start_time, 'HH24:MI') AS start
                 FROM sessions WHERE group_id = $1 ORDER BY date, start_time`,
              [group],
            )
          ).rows.map((r) => `${r.date} ${r.start}`),
        ).toEqual([
          '2026-09-07 08:00',
          '2026-09-14 08:00',
          '2026-09-14 14:00',
          '2026-09-21 14:00',
          '2026-09-28 14:00',
          '2026-10-05 14:00',
        ]);
      });

      it('never touches the past, rebuilds the future with the new pattern', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-10-05'));
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          {
            effectiveDate: '2026-09-21',
            endDate: '2026-10-07',
            rules: [rule(3, 1, '14:00', '16:00')],
          },
          { now },
        );
        expect(result).toMatchObject({ ok: true, removed: 3, created: 3 });
        // Monday 7 and 14 September stay (before the effective date); then Wednesdays.
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-23',
          '2026-09-30',
          '2026-10-07',
        ]);
        expect((await getGroup(pool, teacher, group))?.rules).toEqual([
          { weekday: 3, slotNo: 1, startTime: '14:00', endTime: '16:00' },
        ]);
        expect((await getGroup(pool, teacher, group))?.endDate).toBe(
          '2026-10-07',
        );
      });

      it('keeps sessions moved one by one and the extra one; a deleted one comes back', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-10-12'));
        const sessions = await listSessions(
          pool,
          teacher,
          '2026-09-07',
          '2026-10-12',
        );
        const byDate = (d: string) => sessions.find((s) => s.date === d)!;
        await deleteSession(pool, teacher, byDate('2026-09-21').id, now); // deleted one by one
        await moveSession(
          pool,
          teacher,
          byDate('2026-09-28').id,
          { date: '2026-09-29', startTime: '15:00', endTime: '16:00' },
          now,
        ); // moved
        await addSession(
          pool,
          teacher,
          {
            groupId: group,
            date: '2026-10-01',
            startTime: '17:00',
            endTime: '18:00',
          },
          now,
        ); // extra

        const change = {
          effectiveDate: '2026-09-15',
          endDate: '2026-10-12',
          rules: [rule(1, 1, '09:00', '11:00')],
        };
        const kept = await changeCalendar(pool, teacher, group, change, {
          now,
        });
        expect(kept.ok).toBe(true);
        // 21 Sept was deleted, so the new pattern creates it again; the moved one stays at 29 Sept
        // and 28 Sept is not regenerated; the extra stays; the untouched Mondays are rebuilt at
        // 09:00.
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-21',
          '2026-09-29',
          '2026-10-01',
          '2026-10-05',
          '2026-10-12',
        ]);
        const rebuilt = await getSession(
          pool,
          teacher,
          (await listSessions(pool, teacher, '2026-10-05', '2026-10-05'))[0].id,
        );
        expect(rebuilt).toMatchObject({
          startTime: '09:00',
          endTime: '11:00',
          origin: 'rule',
        });
      });

      it('a dry run says what would happen and changes nothing', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-10-05'));
        const before = await dates(group);
        const preview = await changeCalendar(
          pool,
          teacher,
          group,
          {
            effectiveDate: '2026-09-21',
            endDate: '2026-10-05',
            rules: [rule(3, 1, '14:00', '16:00')],
          },
          { now, dryRun: true },
        );
        expect(preview).toMatchObject({ ok: true, removed: 3, created: 2 });
        expect(await dates(group)).toEqual(before);
        expect((await getGroup(pool, teacher, group))?.rules[0].weekday).toBe(
          1,
        );
      });

      it('reports conflicts with other groups and changes nothing', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-10-05'));
        await make(teacher, {
          ...mondays('2026-09-01', '2026-10-30'),
          name: 'Groupe B',
          rules: [rule(3, 1, '15:00', '17:00')],
        });
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          {
            effectiveDate: '2026-09-21',
            endDate: '2026-10-05',
            rules: [rule(3, 1, '14:00', '16:00')],
          },
          { now },
        );
        expect(result).toMatchObject({ ok: false, reason: 'conflicts' });
        if (!result.ok && result.conflicts) {
          expect(
            result.conflicts.map((c) => [c.draft.date, c.with.groupName]),
          ).toEqual([
            ['2026-09-23', 'Groupe B'],
            ['2026-09-30', 'Groupe B'],
          ]);
        }
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-21',
          '2026-09-28',
          '2026-10-05',
        ]);
      });

      it('can shorten the group: the sessions after the new end disappear', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-10-05'));
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          {
            effectiveDate: '2026-09-15',
            endDate: '2026-09-22',
            rules: [rule(1, 1, '08:00', '10:00')],
          },
          { now },
        );
        expect(result.ok).toBe(true);
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-21',
        ]);
      });

      it('refuses an effective date in the past, a bad period and bad rules', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-10-05'));
        const base = {
          effectiveDate: '2026-09-15',
          endDate: '2026-10-05',
          rules: [rule(1, 1, '08:00', '10:00')],
        };
        expect(
          await changeCalendar(
            pool,
            teacher,
            group,
            { ...base, effectiveDate: '2026-09-13' },
            { now },
          ),
        ).toEqual({ ok: false, reason: 'invalid_date' });
        expect(
          await changeCalendar(
            pool,
            teacher,
            group,
            { ...base, endDate: '2026-09-01' },
            { now },
          ),
        ).toEqual({ ok: false, reason: 'invalid_period' });
        expect(
          await changeCalendar(
            pool,
            teacher,
            group,
            { ...base, endDate: '2028-01-01' },
            { now },
          ),
        ).toEqual({ ok: false, reason: 'invalid_period' });
        expect(
          await changeCalendar(
            pool,
            teacher,
            group,
            { ...base, rules: [] },
            { now },
          ),
        ).toEqual({ ok: false, reason: 'invalid_rules' });
      });
    });

    // ------------------------------------------------------- days picked in a calendar

    describe('a group whose days are picked in a calendar', () => {
      const picked = (
        sessions: { date: string; startTime: string; endTime: string }[],
        name = 'Groupe manuel',
      ): GroupInput => ({
        name,
        startDate: '2026-09-07',
        endDate: '2026-09-30',
        rules: [],
        customSessions: sessions,
        pricingModel: 'per_session',
        referencePriceMillimes: 20000,
      });
      const slot = (date: string, startTime = '08:00', endTime = '10:00') => ({
        date,
        startTime,
        endTime,
      });

      it('creates exactly the picked sessions, with no weekly pattern', async () => {
        const result = await createGroup(
          pool,
          teacher,
          picked([
            slot('2026-09-09'),
            slot('2026-09-09', '14:00', '16:00'),
            slot('2026-09-21', '09:00', '10:00'),
          ]),
        );
        expect(result).toMatchObject({ ok: true, sessionCount: 3 });
        if (!result.ok) return;
        expect(await dates(result.groupId)).toEqual([
          '2026-09-09',
          '2026-09-09',
          '2026-09-21',
        ]);
        expect((await getGroup(pool, teacher, result.groupId))?.rules).toEqual(
          [],
        );
        const sessions = await listGroupSessions(pool, teacher, result.groupId);
        expect(sessions.map((s) => s.origin)).toEqual([
          'manual',
          'manual',
          'manual',
        ]);
      });

      it('refuses bad picks and creates nothing', async () => {
        const bad = async (sessions: ReturnType<typeof slot>[]) =>
          createGroup(pool, teacher, picked(sessions));
        expect(await bad([])).toMatchObject({
          ok: false,
          reason: 'invalid_sessions',
        });
        // outside the period
        expect(await bad([slot('2026-10-05')])).toMatchObject({
          ok: false,
          reason: 'invalid_sessions',
        });
        // the end is not after the start
        expect(await bad([slot('2026-09-09', '10:00', '10:00')])).toMatchObject(
          { ok: false, reason: 'invalid_sessions' },
        );
        // two sessions of one day that overlap
        expect(
          await bad([
            slot('2026-09-09', '08:00', '10:00'),
            slot('2026-09-09', '09:00', '11:00'),
          ]),
        ).toMatchObject({ ok: false, reason: 'invalid_sessions' });
        // four sessions in one day
        expect(
          await bad([
            slot('2026-09-09', '08:00', '09:00'),
            slot('2026-09-09', '09:00', '10:00'),
            slot('2026-09-09', '10:00', '11:00'),
            slot('2026-09-09', '11:00', '12:00'),
          ]),
        ).toMatchObject({ ok: false, reason: 'invalid_sessions' });
        // nothing to remove or edit without a weekly pattern
        expect(
          await createGroup(pool, teacher, {
            ...picked([slot('2026-09-09')]),
            removedSessions: [slot('2026-09-14')],
          }),
        ).toMatchObject({ ok: false, reason: 'invalid_sessions' });
        expect(await listGroups(pool, teacher)).toEqual([]);
      });

      // ------------------------------------------- a weekly pattern with days adjusted by hand

      describe('a weekly pattern adjusted day by day', () => {
        // Sundays 8-10 from Wed 28 Oct to Tue 24 Nov 2026 are the 1st, 8th, 15th and 22nd.
        const sundays = (): GroupInput => ({
          name: 'Groupe dimanche',
          startDate: '2026-10-28',
          endDate: '2026-11-24',
          rules: [rule(7, 1, '08:00', '10:00')],
          pricingModel: 'per_session',
          referencePriceMillimes: 20000,
        });
        const NOV = new Date('2026-10-28T08:00:00Z');
        const originOf = async (groupId: string) =>
          (await listGroupSessions(pool, teacher, groupId)).map((s) =>
            `${s.date} ${s.startTime} ${s.origin} ${s.originalDate ?? ''}`.trim(),
          );

        it('adds a specific day next to the pattern (owner example: Saturday 21 November 16:00-18:00)', async () => {
          const result = await createGroupAt(
            pool,
            teacher,
            {
              ...sundays(),
              customSessions: [slot('2026-11-21', '16:00', '18:00')],
            },
            NOV,
          );
          expect(result).toMatchObject({ ok: true, sessionCount: 5 });
          if (!result.ok) return;
          expect(await originOf(result.groupId)).toEqual([
            '2026-11-01 08:00 rule',
            '2026-11-08 08:00 rule',
            '2026-11-15 08:00 rule',
            '2026-11-21 16:00 manual',
            '2026-11-22 08:00 rule',
          ]);
          // The pattern itself still has only Sunday.
          expect(
            (await getGroup(pool, teacher, result.groupId))?.rules,
          ).toHaveLength(1);
        });

        it('deletes one pattern session and edits another (date and time), keeping the others', async () => {
          const result = await createGroupAt(
            pool,
            teacher,
            {
              ...sundays(),
              removedSessions: [slot('2026-11-01')],
              movedSessions: [
                {
                  from: slot('2026-11-22'),
                  to: slot('2026-11-23', '14:00', '16:00'),
                },
              ],
            },
            NOV,
          );
          expect(result).toMatchObject({ ok: true, sessionCount: 3 });
          if (!result.ok) return;
          expect(await originOf(result.groupId)).toEqual([
            '2026-11-08 08:00 rule',
            '2026-11-15 08:00 rule',
            '2026-11-23 14:00 moved 2026-11-22',
          ]);
        });

        it('ignores an adjustment that names a session the pattern does not make', async () => {
          const result = await createGroupAt(
            pool,
            teacher,
            {
              ...sundays(),
              removedSessions: [slot('2026-11-02')],
              movedSessions: [
                { from: slot('2026-11-03'), to: slot('2026-11-04') },
              ],
            },
            NOV,
          );
          expect(result).toMatchObject({ ok: true, sessionCount: 4 });
        });

        it('refuses a day added on top of a pattern session at the same time, and a fourth session in one day', async () => {
          expect(
            await createGroupAt(
              pool,
              teacher,
              {
                ...sundays(),
                customSessions: [slot('2026-11-08', '09:00', '11:00')],
              },
              NOV,
            ),
          ).toMatchObject({ ok: false, reason: 'invalid_sessions' });
          expect(
            await createGroupAt(
              pool,
              teacher,
              {
                ...sundays(),
                customSessions: [
                  slot('2026-11-08', '10:00', '11:00'),
                  slot('2026-11-08', '11:00', '12:00'),
                  slot('2026-11-08', '12:00', '13:00'),
                ],
              },
              NOV,
            ),
          ).toMatchObject({ ok: false, reason: 'invalid_sessions' });
          // outside the period
          expect(
            await createGroupAt(
              pool,
              teacher,
              { ...sundays(), customSessions: [slot('2026-12-05')] },
              NOV,
            ),
          ).toMatchObject({ ok: false, reason: 'invalid_sessions' });
          expect(await listGroups(pool, teacher)).toEqual([]);
        });

        it('reports a conflict with another group for a specific day', async () => {
          await make(teacher, mondays('2026-11-02', '2026-11-30'));
          const result = await createGroupAt(
            pool,
            teacher,
            {
              ...sundays(),
              customSessions: [slot('2026-11-09', '09:00', '11:00')],
            },
            NOV,
          );
          expect(result).toMatchObject({ ok: false, reason: 'conflicts' });
        });

        it('"Modifier calendrier" keeps the days added and the sessions edited by hand', async () => {
          const created = await createGroupAt(
            pool,
            teacher,
            {
              ...sundays(),
              customSessions: [slot('2026-11-21', '16:00', '18:00')],
              movedSessions: [
                {
                  from: slot('2026-11-22'),
                  to: slot('2026-11-23', '14:00', '16:00'),
                },
              ],
            },
            NOV,
          );
          if (!created.ok) throw new Error('not created');
          const result = await changeCalendar(
            pool,
            teacher,
            created.groupId,
            {
              effectiveDate: '2026-10-29',
              endDate: '2026-11-24',
              rules: [rule(7, 1, '08:00', '10:00')],
            },
            { now: NOV },
          );
          expect(result).toMatchObject({ ok: true });
          const rows = await originOf(created.groupId);
          expect(rows).toContain('2026-11-21 16:00 manual');
          expect(rows).toContain('2026-11-23 14:00 moved 2026-11-22');
        });
      });

      it("reports the conflicts with the teacher's other sessions", async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const result = await createGroup(
          pool,
          teacher,
          picked([slot('2026-09-14', '09:00', '11:00'), slot('2026-09-15')]),
        );
        expect(result).toMatchObject({ ok: false, reason: 'conflicts' });
        if (result.ok || result.reason !== 'conflicts') return;
        expect(result.conflicts?.map((c) => c.draft.date)).toEqual([
          '2026-09-14',
        ]);
      });

      it('leaves out a picked session that is already over', async () => {
        const monday = new Date('2026-09-07T15:00:00Z'); // 16:00 in Tunis
        const result = await createGroupAt(
          pool,
          teacher,
          picked([slot('2026-09-07'), slot('2026-09-08')]),
          monday,
        );
        expect(result).toMatchObject({ ok: true, sessionCount: 1 });
        if (result.ok)
          expect(await dates(result.groupId)).toEqual(['2026-09-08']);
      });

      it('"Modifier calendrier" gives no weekly pattern to a group whose days were picked', async () => {
        const created = await createGroup(
          pool,
          teacher,
          picked([slot('2026-09-09', '14:00', '16:00')]),
        );
        if (!created.ok) throw new Error('not created');
        const now = new Date('2026-09-08T08:00:00Z');
        const result = await changeCalendar(
          pool,
          teacher,
          created.groupId,
          {
            effectiveDate: '2026-09-08',
            endDate: '2026-09-30',
            rules: [rule(1, 1, '08:00', '10:00')],
          },
          { now },
        );
        expect(result).toEqual({ ok: false, reason: 'invalid_rules' });
        expect(await dates(created.groupId)).toEqual(['2026-09-09']);
      });

      it('"Modifier calendrier" works day by day on such a group, and the period follows its sessions', async () => {
        const created = await createGroup(
          pool,
          teacher,
          picked([slot('2026-09-09'), slot('2026-09-16')]),
        );
        if (!created.ok) throw new Error('not created');
        const now = new Date('2026-09-08T08:00:00Z');
        const [first, second] = await listGroupSessions(
          pool,
          teacher,
          created.groupId,
        );
        const base = {
          effectiveDate: '2026-09-08',
          endDate: '2026-09-30',
          rules: [],
        };
        const result = await changeCalendar(
          pool,
          teacher,
          created.groupId,
          {
            ...base,
            addedSessions: [slot('2026-10-12', '16:00', '18:00')],
            deletedSessionIds: [first.id],
            editedSessions: [
              { id: second.id, to: slot('2026-09-17', '14:00', '15:00') },
            ],
          },
          { now },
        );
        expect(result).toMatchObject({ ok: true });
        const sessions = await listGroupSessions(
          pool,
          teacher,
          created.groupId,
        );
        expect(
          sessions.map((s) => `${s.date} ${s.startTime} ${s.origin}`),
        ).toEqual(['2026-09-17 14:00 manual', '2026-10-12 16:00 manual']);
        // Period = first to last session (a later day widens it, a deleted first day shrinks it).
        const group = await getGroup(pool, teacher, created.groupId);
        expect([group?.startDate, group?.endDate]).toEqual([
          '2026-09-17',
          '2026-10-12',
        ]);
      });
    });

    describe('"Modifier calendrier" day by day on a group with a weekly pattern', () => {
      const now = new Date('2026-09-08T08:00:00Z'); // Tuesday 8 September, 10:00 in Tunis
      const slot = (date: string, startTime = '08:00', endTime = '10:00') => ({
        date,
        startTime,
        endTime,
      });
      const change = (extra: object = {}) => ({
        effectiveDate: '2026-09-08',
        endDate: '2026-09-28',
        rules: [rule(1, 1, '08:00', '10:00')],
        ...extra,
      });
      const idOf = async (group: string, date: string) =>
        (await listGroupSessions(pool, teacher, group)).find(
          (s) => s.date === date,
        )!.id;
      const rowsOf = async (group: string) =>
        (await listGroupSessions(pool, teacher, group)).map(
          (s) => `${s.date} ${s.startTime} ${s.origin}`,
        );

      it('deletes one Monday and the rebuilt pattern does not make it again', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-28'));
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          change({ deletedSessionIds: [await idOf(group, '2026-09-21')] }),
          { now },
        );
        expect(result).toMatchObject({ ok: true });
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-28',
        ]);
      });

      it('does not rebuild the pattern when only days are changed: a Monday deleted earlier stays deleted', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-28'));
        await deleteSession(
          pool,
          teacher,
          await idOf(group, '2026-09-21'),
          now,
        );
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          change({ addedSessions: [slot('2026-09-19', '16:00', '18:00')] }),
          { now },
        );
        expect(result).toMatchObject({ ok: true, removed: 0, created: 0 });
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-19',
          '2026-09-28',
        ]);
        // Changing the pattern itself (here its end date) does build it again, as before.
        const rebuilt = await changeCalendar(
          pool,
          teacher,
          group,
          change({ endDate: '2026-10-05' }),
          { now },
        );
        expect(rebuilt).toMatchObject({ ok: true });
        expect(await dates(group)).toContain('2026-09-21');
      });

      it('edits one Monday to another date and time; the pattern leaves that Monday alone', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-28'));
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          change({
            editedSessions: [
              {
                id: await idOf(group, '2026-09-21'),
                to: slot('2026-09-22', '14:00', '16:00'),
              },
            ],
          }),
          { now },
        );
        expect(result).toMatchObject({ ok: true });
        expect(await rowsOf(group)).toEqual([
          '2026-09-07 08:00 rule',
          '2026-09-14 08:00 rule',
          '2026-09-22 14:00 moved',
          '2026-09-28 08:00 rule',
        ]);
      });

      it('adds a specific day (a Saturday, not every Saturday), also outside the period, which then widens', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-28'));
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          change({
            addedSessions: [
              slot('2026-09-19', '16:00', '18:00'),
              slot('2026-10-03', '16:00', '18:00'),
            ],
          }),
          { now },
        );
        expect(result).toMatchObject({ ok: true });
        expect(await rowsOf(group)).toEqual([
          '2026-09-07 08:00 rule',
          '2026-09-14 08:00 rule',
          '2026-09-19 16:00 manual',
          '2026-09-21 08:00 rule',
          '2026-09-28 08:00 rule',
          '2026-10-03 16:00 manual',
        ]);
        expect((await getGroup(pool, teacher, group))?.endDate).toBe(
          '2026-10-03',
        );
      });

      it('shows what it would do on a dry run and saves nothing', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-28'));
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          change({
            addedSessions: [slot('2026-09-19', '16:00', '18:00')],
            deletedSessionIds: [await idOf(group, '2026-09-21')],
          }),
          { now, dryRun: true },
        );
        expect(result).toMatchObject({ ok: true });
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-21',
          '2026-09-28',
        ]);
      });

      it('refuses an overlap with another group or between new sessions, and changes nothing', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-28'));
        await make(teacher, {
          ...mondays('2026-09-07', '2026-09-28'),
          name: 'Groupe B',
          rules: [rule(3, 1, '14:00', '16:00')],
        });
        const clash = await changeCalendar(
          pool,
          teacher,
          group,
          change({ addedSessions: [slot('2026-09-16', '15:00', '17:00')] }),
          { now },
        );
        expect(clash).toMatchObject({ ok: false, reason: 'conflicts' });
        const twice = await changeCalendar(
          pool,
          teacher,
          group,
          change({
            addedSessions: [
              slot('2026-09-19', '16:00', '18:00'),
              slot('2026-09-19', '17:00', '19:00'),
            ],
          }),
          { now },
        );
        expect(twice).toMatchObject({ ok: false, reason: 'conflicts' });
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-21',
          '2026-09-28',
        ]);
      });

      it('refuses a past session, a session of another group or teacher, and a new slot in the past', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-28'));
        const otherGroup = await make(teacher, {
          ...mondays('2026-09-07', '2026-09-28'),
          name: 'Groupe B',
          rules: [rule(3, 1, '14:00', '16:00')],
        });
        expect(
          await changeCalendar(
            pool,
            teacher,
            group,
            change({ deletedSessionIds: [await idOf(group, '2026-09-07')] }),
            { now },
          ),
        ).toEqual({ ok: false, reason: 'past' });
        expect(
          await changeCalendar(
            pool,
            teacher,
            group,
            change({
              deletedSessionIds: [await idOf(otherGroup, '2026-09-16')],
            }),
            { now },
          ),
        ).toEqual({ ok: false, reason: 'session_not_found' });
        expect(
          await changeCalendar(
            pool,
            other,
            group,
            change({ deletedSessionIds: [await idOf(group, '2026-09-21')] }),
            { now },
          ),
        ).toEqual({ ok: false, reason: 'not_found' });
        expect(
          await changeCalendar(
            pool,
            teacher,
            group,
            change({ addedSessions: [slot('2026-09-07', '16:00', '18:00')] }),
            { now },
          ),
        ).toEqual({ ok: false, reason: 'invalid_sessions' });
        expect(await dates(group)).toHaveLength(4);
      });
    });

    describe('what "Modifier calendrier" reports', () => {
      it('lists the sessions it removes and creates, and saves nothing on a dry run', async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const now = new Date('2026-09-08T08:00:00Z');
        const result = await changeCalendar(
          pool,
          teacher,
          group,
          {
            effectiveDate: '2026-09-08',
            endDate: '2026-09-21',
            rules: [rule(3, 1, '14:00', '16:00')],
          },
          { now, dryRun: true },
        );
        expect(result).toMatchObject({ ok: true, removed: 2, created: 2 });
        if (!result.ok) return;
        expect(result.removedSessions.map((s) => s.date)).toEqual([
          '2026-09-14',
          '2026-09-21',
        ]);
        expect(result.createdSessions).toEqual([
          { date: '2026-09-09', startTime: '14:00', endTime: '16:00' },
          { date: '2026-09-16', startTime: '14:00', endTime: '16:00' },
        ]);
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-21',
        ]);
      });

      it("listGroupSessions returns only that group's sessions, oldest first", async () => {
        const a = await make(teacher, mondays('2026-09-07', '2026-09-14'));
        await make(teacher, {
          ...mondays('2026-09-08', '2026-09-30', '14:00', '15:00'),
          name: 'Groupe B',
        });
        expect(
          (await listGroupSessions(pool, teacher, a)).map((s) => s.date),
        ).toEqual(['2026-09-07', '2026-09-14']);
      });
    });

    // -------------------------------------------------------------------------- isolation

    describe('a teacher only reaches their own rows (invariant 16)', () => {
      it("teacher B cannot read, change, delete or schedule in teacher A's data", async () => {
        const group = await make(teacher, mondays('2026-09-07', '2026-09-21'));
        const [session] = await listSessions(
          pool,
          teacher,
          '2026-09-07',
          '2026-09-07',
        );

        expect(await getGroup(pool, other, group)).toBeNull();
        expect(await listGroups(pool, other)).toEqual([]);
        expect(
          await listSessions(pool, other, '2026-09-01', '2026-09-30'),
        ).toEqual([]);
        expect(await getSession(pool, other, session.id)).toBeNull();
        expect(await deleteSession(pool, other, session.id, NOW)).toEqual({
          ok: false,
          reason: 'not_found',
        });
        expect(await listGroupSessions(pool, other, group)).toEqual([]);
        expect(
          await moveSession(
            pool,
            other,
            session.id,
            { date: '2026-09-09', startTime: '08:00', endTime: '09:00' },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'not_found' });
        expect(
          await addSession(
            pool,
            other,
            {
              groupId: group,
              date: '2026-09-09',
              startTime: '08:00',
              endTime: '09:00',
            },
            NOW,
          ),
        ).toEqual({ ok: false, reason: 'group_not_found' });
        expect(await deleteGroup(pool, other, group, 'Groupe A')).toEqual({
          ok: false,
          reason: 'not_found',
        });
        expect(
          await changeCalendar(
            pool,
            other,
            group,
            {
              effectiveDate: '2026-09-15',
              endDate: '2026-09-21',
              rules: [rule(2, 1, '08:00', '09:00')],
            },
            { now: NOW },
          ),
        ).toEqual({ ok: false, reason: 'not_found' });

        // nothing happened to teacher A's data
        expect(await dates(group)).toEqual([
          '2026-09-07',
          '2026-09-14',
          '2026-09-21',
        ]);
        expect(await getGroup(pool, teacher, group)).not.toBeNull();
      });

      it("another teacher's sessions never cause a conflict", async () => {
        await make(teacher, mondays('2026-09-07', '2026-09-21'));
        expect(
          (await createGroup(pool, other, mondays('2026-09-07', '2026-09-21')))
            .ok,
        ).toBe(true);
      });
    });
  },
);
