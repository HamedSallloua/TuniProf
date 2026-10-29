import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { saveGroupStudents } from '@/lib/dashboard/group-students';
import { createGroup, type GroupInput } from '@/lib/dashboard/groups';
import {
  addStudentsToGroup,
  addStudentToGroups,
  cleanStudent,
  countStudents,
  createStudent,
  deleteStudent,
  getStudent,
  groupStudentCounts,
  groupStudentsForSearch,
  listGroupMembers,
  listMemberships,
  listStudents,
  moveToGroup,
  removeFromGroup,
  searchStudentsOnServer,
  updateStudent,
} from '@/lib/dashboard/students';
import { searchStudents } from '@/lib/students/search';
import { clearAuthTables } from './auth-helpers';
import {
  CHECK_VIOLATION,
  createTestPool,
  FOREIGN_KEY_VIOLATION,
  testDatabaseUrl,
  UNIQUE_VIOLATION,
} from './helpers';
import { createTeacher } from './profile-helpers';

// 1 September 2026, 10:00 in Tunis.
const NOW = new Date('2026-09-01T09:00:00Z');

describe.skipIf(!testDatabaseUrl)('dashboard: students and memberships', () => {
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

  const makeGroup = async (owner: string, name: string, weekday = 1) => {
    const input: GroupInput = {
      name,
      startDate: '2026-09-07',
      endDate: '2026-09-28',
      rules: [{ weekday, slotNo: 1, startTime: '08:00', endTime: '10:00' }],
      pricingModel: 'per_session',
      referencePriceMillimes: 20000,
    };
    const result = await createGroup(pool, owner, input, NOW);
    if (!result.ok) throw new Error(`group: ${result.reason}`);
    return result.groupId;
  };

  const makeStudent = async (
    owner: string,
    fullName: string,
    extra: { phone?: string; note?: string; groupId?: string } = {},
  ) => {
    const result = await createStudent(
      pool,
      owner,
      { fullName, phone: extra.phone, note: extra.note },
      { groupId: extra.groupId, now: NOW },
    );
    if (!result.ok) throw new Error(`student: ${result.reason}`);
    return result.studentId;
  };

  // ------------------------------------------------------------------------ the input rules

  describe('what a student is', () => {
    it('needs a name of 2 to 80 characters; phone and note are optional', () => {
      expect(cleanStudent({ fullName: ' Sarah   Ben Ali ' })).toEqual({
        ok: true,
        value: { fullName: 'Sarah Ben Ali', phone: null, note: null },
      });
      expect(cleanStudent({ fullName: 'A' })).toEqual({
        ok: false,
        reason: 'invalid_name',
      });
      expect(cleanStudent({ fullName: 'x'.repeat(81) })).toEqual({
        ok: false,
        reason: 'invalid_name',
      });
      expect(cleanStudent({ fullName: '   ' })).toEqual({
        ok: false,
        reason: 'invalid_name',
      });
    });

    it('validates the phone as in spec 4.1 and stores it as +216 and 8 digits', () => {
      const phone = (value: string) => {
        const result = cleanStudent({ fullName: 'Sarah', phone: value });
        return result.ok ? result.value.phone : result.reason;
      };
      expect(phone('22 345 678')).toBe('+21622345678');
      expect(phone('+216 98 111 222')).toBe('+21698111222');
      expect(phone('')).toBeNull();
      expect(phone('12 345 678')).toBe('invalid_phone');
      expect(phone('2234')).toBe('invalid_phone');
      expect(phone('abc')).toBe('invalid_phone');
    });

    it('limits the note to 300 characters', () => {
      expect(
        cleanStudent({ fullName: 'Sarah', note: 'x'.repeat(300) }).ok,
      ).toBe(true);
      expect(
        cleanStudent({ fullName: 'Sarah', note: 'x'.repeat(301) }),
      ).toEqual({ ok: false, reason: 'invalid_note' });
    });

    it('is stored once, with the searchable columns written by the application', async () => {
      const id = await makeStudent(teacher, 'Élodie Brûlé', {
        phone: '22 345 678',
        note: 'Frère de Sarah',
      });
      const { rows } = await pool.query(
        `SELECT full_name, full_name_norm, phone, phone_digits, note, note_norm
           FROM students WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({
        full_name: 'Élodie Brûlé',
        full_name_norm: 'elodie brule',
        phone: '+21622345678',
        phone_digits: '21622345678',
        note: 'Frère de Sarah',
        note_norm: 'frere de sarah',
      });
    });
  });

  // --------------------------------------------- acceptance test 17: new student, duplicates

  describe('a new student (acceptance test 17)', () => {
    it('is created with a membership in the group in one step', async () => {
      const group = await makeGroup(teacher, 'Math');
      const id = await makeStudent(teacher, 'Sarah', { groupId: group });
      const members = await listGroupMembers(pool, teacher, group);
      expect(members.map((m) => m.id)).toEqual([id]);
      expect(members[0].joinedOn).toBe('2026-09-01');
    });

    it('is created without a group from the Élèves section ("Sans groupe")', async () => {
      const id = await makeStudent(teacher, 'Sarah');
      expect((await getStudent(pool, teacher, id))?.groups).toEqual([]);
      expect((await listStudents(pool, teacher)).map((s) => s.id)).toEqual([
        id,
      ]);
    });

    it('suggests existing students with a similar name while typing', async () => {
      await makeStudent(teacher, 'Mohamed Ali');
      await makeStudent(teacher, 'Mohamed Trabelsi');
      await makeStudent(teacher, 'Sarah');
      const typed = searchStudents(await listStudents(pool, teacher), 'Moha');
      expect(typed.map((r) => r.student.fullName)).toEqual([
        'Mohamed Ali',
        'Mohamed Trabelsi',
      ]);
    });

    it('refuses a student with exactly the name and the phone of an existing student', async () => {
      const first = await makeStudent(teacher, 'Mohamed Ali', {
        phone: '22 345 678',
      });
      const again = await createStudent(
        pool,
        teacher,
        { fullName: '  mohamed ALI ', phone: '+216 22 345 678' },
        { now: NOW },
      );
      expect(again).toMatchObject({
        ok: false,
        reason: 'duplicate',
        existing: { id: first, fullName: 'Mohamed Ali' },
      });
      expect(await countStudents(pool, teacher)).toBe(1);
    });

    it('lets two students share a name without a phone, and the database refuses the pair as well', async () => {
      await makeStudent(teacher, 'Mohamed Ali');
      await makeStudent(teacher, 'Mohamed Ali');
      expect(await countStudents(pool, teacher)).toBe(2);
      await makeStudent(teacher, 'Sarah', { phone: '22 345 678' });
      await expect(
        pool.query(
          `INSERT INTO students (teacher_id, full_name, full_name_norm, phone, phone_digits)
           SELECT teacher_id, full_name, full_name_norm, phone, phone_digits
             FROM students WHERE phone IS NOT NULL`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('refuses to change a student so that name AND phone equal another student, and allows one of the two', async () => {
      const first = await makeStudent(teacher, 'Mohamed Ali', {
        phone: '22 345 678',
      });
      const second = await makeStudent(teacher, 'Sarah', {
        phone: '98 111 222',
      });
      // Both together, then each one alone completes the pair.
      expect(
        await updateStudent(pool, teacher, second, {
          fullName: 'Mohamed Ali',
          phone: '22 345 678',
        }),
      ).toMatchObject({
        ok: false,
        reason: 'duplicate',
        existing: { id: first },
      });
      expect(
        await updateStudent(pool, teacher, second, { fullName: 'Mohamed Ali' }),
      ).toEqual({ ok: true });
      expect(
        await updateStudent(pool, teacher, second, { phone: '22 345 678' }),
      ).toMatchObject({
        ok: false,
        reason: 'duplicate',
        existing: { id: first },
      });
      expect((await getStudent(pool, teacher, second))?.phone).toBe(
        '+21698111222',
      );
      // Saving a student without changing the pair is not a duplicate of themself.
      expect(
        await updateStudent(pool, teacher, first, { note: 'frère de Sarah' }),
      ).toEqual({ ok: true });
    });

    it('does not warn for the same name with another phone, or for another teacher', async () => {
      await makeStudent(teacher, 'Mohamed Ali', { phone: '22 345 678' });
      expect(
        (
          await createStudent(
            pool,
            teacher,
            { fullName: 'Mohamed Ali', phone: '98 111 222' },
            { now: NOW },
          )
        ).ok,
      ).toBe(true);
      expect(
        (
          await createStudent(
            pool,
            other,
            { fullName: 'Mohamed Ali', phone: '22 345 678' },
            { now: NOW },
          )
        ).ok,
      ).toBe(true);
    });

    it("creates nothing when the group is not the teacher's, or the input is bad", async () => {
      const foreign = await makeGroup(other, 'Autre');
      expect(
        await createStudent(
          pool,
          teacher,
          { fullName: 'Sarah' },
          { groupId: foreign, now: NOW },
        ),
      ).toEqual({ ok: false, reason: 'group_not_found' });
      expect(
        await createStudent(pool, teacher, { fullName: 'S' }, { now: NOW }),
      ).toEqual({ ok: false, reason: 'invalid_name' });
      expect(await countStudents(pool, teacher)).toBe(0);
    });
  });

  // ------------------------------- acceptance tests 9 and 16: the picker of existing students

  describe('adding existing students to a group (acceptance tests 9 and 16)', () => {
    it('search "Mo", select, search "sa", select: both are added, nobody is created twice', async () => {
      const group = await makeGroup(teacher, 'Groupe B');
      const mohamed = await makeStudent(teacher, 'Mohamed');
      const sarah = await makeStudent(teacher, 'Sarah');
      await makeStudent(teacher, 'Karim');

      const all = await listStudents(pool, teacher);
      const selected = new Set<string>();
      for (const query of ['Mo', 'sa'])
        selected.add(searchStudents(all, query)[0].student.id);
      expect([...selected].sort()).toEqual([mohamed, sarah].sort());

      expect(
        await addStudentsToGroup(pool, teacher, group, [...selected], NOW),
      ).toEqual({ ok: true, count: 2 });
      expect(
        (await listGroupMembers(pool, teacher, group)).map((m) => m.fullName),
      ).toEqual(['Mohamed', 'Sarah']);
      // No new student was created, and each is counted once.
      expect(await countStudents(pool, teacher)).toBe(3);
      const rows = await pool.query(
        'SELECT student_id FROM memberships WHERE group_id = $1',
        [group],
      );
      expect(rows.rows).toHaveLength(2);
    });

    it('refuses a student already in the group, and adds nobody then (all or nothing)', async () => {
      const group = await makeGroup(teacher, 'Groupe B');
      const mohamed = await makeStudent(teacher, 'Mohamed', { groupId: group });
      const sarah = await makeStudent(teacher, 'Sarah');
      expect(
        await addStudentsToGroup(pool, teacher, group, [sarah, mohamed], NOW),
      ).toEqual({ ok: false, reason: 'already_member' });
      expect(await listGroupMembers(pool, teacher, group)).toHaveLength(1);
    });

    it("refuses an empty selection and another teacher's student or group", async () => {
      const group = await makeGroup(teacher, 'Groupe B');
      const sarah = await makeStudent(teacher, 'Sarah');
      const stranger = await makeStudent(other, 'Karim');
      const foreignGroup = await makeGroup(other, 'Autre');

      expect(await addStudentsToGroup(pool, teacher, group, [], NOW)).toEqual({
        ok: false,
        reason: 'nothing_selected',
      });
      expect(
        await addStudentsToGroup(pool, teacher, group, [stranger], NOW),
      ).toEqual({ ok: false, reason: 'student_not_found' });
      expect(
        await addStudentsToGroup(pool, teacher, foreignGroup, [sarah], NOW),
      ).toEqual({ ok: false, reason: 'group_not_found' });
      expect(await listGroupMembers(pool, teacher, group)).toEqual([]);
    });

    it('a student who left can be added again: a new membership, the history stays', async () => {
      const group = await makeGroup(teacher, 'Groupe B');
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: group });
      const [member] = await listGroupMembers(pool, teacher, group);
      await removeFromGroup(pool, teacher, member.membershipId, NOW);
      expect(
        await addStudentsToGroup(pool, teacher, group, [sarah], NOW),
      ).toEqual({ ok: true, count: 1 });
      const history = await listMemberships(pool, teacher, sarah);
      expect(history).toHaveLength(2);
      expect(history.filter((h) => h.leftOn === null)).toHaveLength(1);
    });
  });

  // ------------------------------------------------- acceptance tests 18 and 19: one record

  describe('one record, everywhere (acceptance tests 18 and 19)', () => {
    it('a phone changed once shows in every group row, the student page and the search', async () => {
      const a = await makeGroup(teacher, 'Groupe A', 1);
      const b = await makeGroup(teacher, 'Groupe B', 2);
      const sarah = await makeStudent(teacher, 'Sarah', {
        phone: '22 345 678',
        groupId: a,
      });
      await addStudentToGroups(pool, teacher, sarah, [b], NOW);

      expect(
        await updateStudent(pool, teacher, sarah, { phone: '98 111 222' }),
      ).toEqual({ ok: true });

      for (const group of [a, b])
        expect((await listGroupMembers(pool, teacher, group))[0].phone).toBe(
          '+21698111222',
        );
      expect((await getStudent(pool, teacher, sarah))?.phone).toBe(
        '+21698111222',
      );
      const found = searchStudents(await listStudents(pool, teacher), '98 111');
      expect(found.map((r) => r.student.id)).toEqual([sarah]);
      expect(
        searchStudents(await listStudents(pool, teacher), '22 345'),
      ).toEqual([]);
    });

    it('a name edited from the group page is the same record the student page reads', async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: group });
      await updateStudent(pool, teacher, sarah, { fullName: 'Sarah Ben Ali' });
      expect((await getStudent(pool, teacher, sarah))?.fullName).toBe(
        'Sarah Ben Ali',
      );
      expect((await listGroupMembers(pool, teacher, group))[0].fullName).toBe(
        'Sarah Ben Ali',
      );
      expect(await countStudents(pool, teacher)).toBe(1);
      const { rows } = await pool.query(
        'SELECT full_name_norm FROM students WHERE id = $1',
        [sarah],
      );
      expect(rows[0].full_name_norm).toBe('sarah ben ali');
    });

    it('an edit changes only the fields given, can clear the phone and the note, and refuses bad values', async () => {
      const sarah = await makeStudent(teacher, 'Sarah', {
        phone: '22 345 678',
        note: 'Frère de Karim',
      });
      await updateStudent(pool, teacher, sarah, { note: '' });
      expect(await getStudent(pool, teacher, sarah)).toMatchObject({
        fullName: 'Sarah',
        phone: '+21622345678',
        note: null,
      });
      await updateStudent(pool, teacher, sarah, { phone: '' });
      expect((await getStudent(pool, teacher, sarah))?.phone).toBeNull();
      expect(
        await updateStudent(pool, teacher, sarah, { phone: '1234' }),
      ).toEqual({ ok: false, reason: 'invalid_phone' });
      expect(
        await updateStudent(pool, teacher, sarah, { fullName: 'S' }),
      ).toEqual({ ok: false, reason: 'invalid_name' });
    });

    it('removing the last group leaves the student in the list as "Sans groupe", history kept', async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: group });
      const [member] = await listGroupMembers(pool, teacher, group);
      expect(
        await removeFromGroup(pool, teacher, member.membershipId, NOW),
      ).toEqual({ ok: true });

      expect(await listGroupMembers(pool, teacher, group)).toEqual([]);
      const listed = await listStudents(pool, teacher);
      expect(listed.map((s) => [s.id, s.groups.length])).toEqual([[sarah, 0]]);
      expect(await listMemberships(pool, teacher, sarah)).toMatchObject([
        { groupName: 'Groupe A', joinedOn: '2026-09-01', leftOn: '2026-09-01' },
      ]);
      // Removing twice finds nothing to remove.
      expect(
        await removeFromGroup(pool, teacher, member.membershipId, NOW),
      ).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  // ------------------------------------------------------------------- move, groups, counts

  describe('moving and adding to other groups', () => {
    it('"Déplacer" ends the membership here and starts one in the target group', async () => {
      const a = await makeGroup(teacher, 'Groupe A', 1);
      const b = await makeGroup(teacher, 'Groupe B', 2);
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: a });
      const [member] = await listGroupMembers(pool, teacher, a);
      expect(
        await moveToGroup(pool, teacher, member.membershipId, b, NOW),
      ).toEqual({ ok: true });
      expect(await listGroupMembers(pool, teacher, a)).toEqual([]);
      expect(
        (await listGroupMembers(pool, teacher, b)).map((m) => m.id),
      ).toEqual([sarah]);
      expect(await listMemberships(pool, teacher, sarah)).toHaveLength(2);
    });

    it('"Déplacer" refuses the same group, a group where the student already is, and a foreign group', async () => {
      const a = await makeGroup(teacher, 'Groupe A', 1);
      const b = await makeGroup(teacher, 'Groupe B', 2);
      const foreign = await makeGroup(other, 'Autre');
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: a });
      await addStudentToGroups(pool, teacher, sarah, [b], NOW);
      const [member] = await listGroupMembers(pool, teacher, a);
      expect(
        await moveToGroup(pool, teacher, member.membershipId, a, NOW),
      ).toEqual({ ok: false, reason: 'same_group' });
      expect(
        await moveToGroup(pool, teacher, member.membershipId, b, NOW),
      ).toEqual({ ok: false, reason: 'already_member' });
      expect(
        await moveToGroup(pool, teacher, member.membershipId, foreign, NOW),
      ).toEqual({ ok: false, reason: 'group_not_found' });
      expect(await listGroupMembers(pool, teacher, a)).toHaveLength(1);
    });

    it('"Ajouter à un autre groupe" gives the same student a membership in each chosen group, not in groups they are in', async () => {
      const a = await makeGroup(teacher, 'Groupe A', 1);
      const b = await makeGroup(teacher, 'Groupe B', 2);
      const c = await makeGroup(teacher, 'Groupe C', 3);
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: a });
      expect(
        await addStudentToGroups(pool, teacher, sarah, [a, b], NOW),
      ).toEqual({
        ok: false,
        reason: 'already_member',
      });
      expect(
        await addStudentToGroups(pool, teacher, sarah, [b, c], NOW),
      ).toEqual({
        ok: true,
        count: 2,
      });
      expect(
        (await getStudent(pool, teacher, sarah))?.groups.map(
          (g) => g.groupName,
        ),
      ).toEqual(['Groupe A', 'Groupe B', 'Groupe C']);
      expect(await countStudents(pool, teacher)).toBe(1);
    });

    it('counts the students of each group, and lists names and phones for the group search', async () => {
      const a = await makeGroup(teacher, 'Groupe A', 1);
      const b = await makeGroup(teacher, 'Groupe B', 2);
      await makeStudent(teacher, 'Sarah', { groupId: a, phone: '22 345 678' });
      await makeStudent(teacher, 'Karim', { groupId: a });
      const zied = await makeStudent(teacher, 'Zied', { groupId: b });
      const counts = await groupStudentCounts(pool, teacher);
      expect([counts.get(a), counts.get(b)]).toEqual([2, 1]);
      const [member] = await listGroupMembers(pool, teacher, b);
      await removeFromGroup(pool, teacher, member.membershipId, NOW);
      expect((await groupStudentCounts(pool, teacher)).get(b)).toBeUndefined();
      expect((await groupStudentsForSearch(pool, teacher)).get(a)).toEqual([
        { fullName: 'Karim', phone: null },
        { fullName: 'Sarah', phone: '+21622345678' },
      ]);
      expect(zied).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------------------- delete

  describe('delete', () => {
    it('deletes for good only when the name is typed exactly, memberships included', async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      const sarah = await makeStudent(teacher, 'Sarah Ben Ali', {
        groupId: group,
      });
      expect(await deleteStudent(pool, teacher, sarah, 'Sarah')).toEqual({
        ok: false,
        reason: 'name_mismatch',
      });
      expect(await countStudents(pool, teacher)).toBe(1);
      expect(
        await deleteStudent(pool, teacher, sarah, '  Sarah Ben Ali '),
      ).toEqual({ ok: true });
      expect(await countStudents(pool, teacher)).toBe(0);
      const { rows } = await pool.query(
        'SELECT 1 FROM memberships WHERE group_id = $1',
        [group],
      );
      expect(rows).toEqual([]);
    });

    it('deleting a group keeps its students: they only lose the membership', async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: group });
      await pool.query('DELETE FROM groups WHERE id = $1', [group]);
      expect((await getStudent(pool, teacher, sarah))?.groups).toEqual([]);
    });
  });

  // ----------------------------------------------------------------------------- isolation

  describe('every teacher only sees their own students (invariant 16)', () => {
    it("teacher B can neither read nor change nor delete teacher A's students", async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: group });
      const [member] = await listGroupMembers(pool, teacher, group);
      const bGroup = await makeGroup(other, 'Groupe B');

      expect(await getStudent(pool, other, sarah)).toBeNull();
      expect(await listStudents(pool, other)).toEqual([]);
      expect(await listGroupMembers(pool, other, group)).toEqual([]);
      expect(
        await updateStudent(pool, other, sarah, { fullName: 'Hacked' }),
      ).toEqual({ ok: false, reason: 'not_found' });
      expect(await deleteStudent(pool, other, sarah, 'Sarah')).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(
        await removeFromGroup(pool, other, member.membershipId, NOW),
      ).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(
        await moveToGroup(pool, other, member.membershipId, bGroup, NOW),
      ).toEqual({ ok: false, reason: 'not_found' });
      expect(
        await addStudentsToGroup(pool, other, bGroup, [sarah], NOW),
      ).toEqual({
        ok: false,
        reason: 'student_not_found',
      });
      expect(await searchStudentsOnServer(pool, other, 'Sarah')).toEqual([]);
      expect((await getStudent(pool, teacher, sarah))?.fullName).toBe('Sarah');
    });

    it('the database itself refuses a membership between two teachers, a second open one, and a bad phone', async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      const foreign = await makeStudent(other, 'Karim');
      await expect(
        pool.query(
          `INSERT INTO memberships (teacher_id, group_id, student_id, joined_on)
           VALUES ($1, $2, $3, '2026-09-01')`,
          [teacher, group, foreign],
        ),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });

      const sarah = await makeStudent(teacher, 'Sarah', { groupId: group });
      await expect(
        pool.query(
          `INSERT INTO memberships (teacher_id, group_id, student_id, joined_on)
           VALUES ($1, $2, $3, '2026-09-01')`,
          [teacher, group, sarah],
        ),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });

      await expect(
        pool.query(
          'UPDATE students SET phone = $2, phone_digits = $3 WHERE id = $1',
          [sarah, '+21612345678', '21612345678'],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(
        pool.query(
          'UPDATE memberships SET left_on = $2 WHERE student_id = $1',
          [sarah, '2026-08-01'],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  // ---------------------------------------------------------------------- server-side search

  describe('search on the server gives the same answer as in the browser', () => {
    it("finds by name, phone, note and group name, ranked like the browser, never another teacher's", async () => {
      const group = await makeGroup(teacher, 'Sarahouni physique');
      await makeStudent(teacher, 'Sarah Ben Ali', { phone: '22 345 678' });
      await makeStudent(teacher, 'Moez Gharbi', { note: 'frère de Sarah' });
      await makeStudent(teacher, 'Zied Karray', { groupId: group });
      await makeStudent(teacher, 'Mohamed', { phone: '98 345 111' });
      await makeStudent(other, 'Sarah Autre');

      const all = await listStudents(pool, teacher);
      for (const query of [
        'sarah',
        'sa',
        'Moh',
        '345',
        '22 345',
        'frere',
        'physique',
        'ZIED kar',
        'zzz',
      ]) {
        const server = (await searchStudentsOnServer(pool, teacher, query)).map(
          (s) => s.id,
        );
        const browser = searchStudents(all, query).map((r) => r.student.id);
        expect(server, query).toEqual(browser);
      }
      expect(
        (await searchStudentsOnServer(pool, teacher, 'sarah')).map(
          (s) => s.fullName,
        ),
      ).toEqual(['Sarah Ben Ali', 'Moez Gharbi', 'Zied Karray']);
    });

    it('treats % and _ typed in the box as plain characters, and an empty search as nothing', async () => {
      await makeStudent(teacher, 'Sarah');
      expect(await searchStudentsOnServer(pool, teacher, '%')).toEqual([]);
      expect(await searchStudentsOnServer(pool, teacher, 's_')).toEqual([]);
      expect(await searchStudentsOnServer(pool, teacher, '   ')).toEqual([]);
    });

    it('stays fast and correct with 250 students (above the browser threshold)', async () => {
      await pool.query(
        `INSERT INTO students (teacher_id, full_name, full_name_norm)
         SELECT $1, 'Eleve ' || n, 'eleve ' || n FROM generate_series(1, 250) AS n`,
        [teacher],
      );
      expect(await countStudents(pool, teacher)).toBe(250);
      const found = await searchStudentsOnServer(pool, teacher, 'eleve 24');
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((s) => /^Eleve 24/.test(s.fullName))).toBe(true);
    });
  });

  // -------------------------------------------- "Modifier liste d'élèves": one save, all or nothing

  describe('the list of a group saved in one step', () => {
    const save = (
      group: string,
      change: Parameters<typeof saveGroupStudents>[3],
      owner = teacher,
    ) => saveGroupStudents(pool, owner, group, change, NOW);

    it('adds, creates, removes and edits together', async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: group });
      const karim = await makeStudent(teacher, 'Karim', { groupId: group });
      const zied = await makeStudent(teacher, 'Zied');
      const members = await listGroupMembers(pool, teacher, group);
      const karimMembership = members.find((m) => m.id === karim)!.membershipId;

      const result = await save(group, {
        addStudentIds: [zied],
        newStudents: [{ fullName: 'Lina Ben Salah', phone: '98 111 222' }],
        removeMembershipIds: [karimMembership],
        editedStudents: [
          { studentId: sarah, fullName: 'Sarah Ben Ali', phone: '55 123 456' },
        ],
      });
      expect(result).toEqual({
        ok: true,
        added: 1,
        created: 1,
        removed: 1,
        edited: 1,
      });

      expect(
        (await listGroupMembers(pool, teacher, group)).map((m) => m.fullName),
      ).toEqual(['Lina Ben Salah', 'Sarah Ben Ali', 'Zied']);
      expect((await getStudent(pool, teacher, sarah))?.phone).toBe(
        '+21655123456',
      );
      // Karim left but is still a student, and the history stays.
      expect((await getStudent(pool, teacher, karim))?.groups).toEqual([]);
      expect(await listMemberships(pool, teacher, karim)).toHaveLength(1);
      expect(await countStudents(pool, teacher)).toBe(4);
    });

    it('is all or nothing: one wrong row changes nothing, even the valid ones before it', async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: group });
      const karim = await makeStudent(teacher, 'Karim', { groupId: group });
      const members = await listGroupMembers(pool, teacher, group);
      const before = JSON.stringify(
        await pool
          .query(
            'SELECT s.id, s.full_name, s.phone, m.left_on::text FROM students s LEFT JOIN memberships m ON m.student_id = s.id ORDER BY s.id, m.id',
          )
          .then((r) => r.rows),
      );

      const result = await save(group, {
        removeMembershipIds: [
          members.find((m) => m.id === karim)!.membershipId,
        ],
        newStudents: [{ fullName: 'Lina' }],
        editedStudents: [
          { studentId: sarah, fullName: 'Sarah Ben Ali' },
          { studentId: sarah, phone: '12 345' },
        ],
      });
      expect(result).toEqual({
        ok: false,
        reason: 'invalid_phone',
        list: 'edited',
        index: 1,
      });
      const after = JSON.stringify(
        await pool
          .query(
            'SELECT s.id, s.full_name, s.phone, m.left_on::text FROM students s LEFT JOIN memberships m ON m.student_id = s.id ORDER BY s.id, m.id',
          )
          .then((r) => r.rows),
      );
      expect(after).toBe(before);
      expect(await countStudents(pool, teacher)).toBe(2);
    });

    it('refuses a new student identical to an existing one (with the row), and an edit that makes two students identical, and saves nothing', async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      const first = await makeStudent(teacher, 'Mohamed Ali', {
        phone: '22 345 678',
      });
      const change = {
        newStudents: [
          { fullName: 'Lina' },
          { fullName: ' mohamed ALI ', phone: '+216 22 345 678' },
        ],
      };
      const warned = await save(group, change);
      expect(warned).toMatchObject({
        ok: false,
        reason: 'duplicate',
        index: 1,
        existing: { id: first },
      });
      expect(await countStudents(pool, teacher)).toBe(1);

      // An edit that copies another student's name and phone is refused with its row.
      const sarah = await makeStudent(teacher, 'Sarah', {
        phone: '98 111 222',
      });
      expect(
        await save(group, {
          editedStudents: [
            { studentId: sarah, fullName: 'Mohamed Ali', phone: '22 345 678' },
          ],
        }),
      ).toMatchObject({
        ok: false,
        reason: 'duplicate',
        list: 'edited',
        index: 0,
        existing: { id: first },
      });
      expect((await getStudent(pool, teacher, sarah))?.fullName).toBe('Sarah');
      // Without the copy, the rest of the list saves.
      expect(
        await save(group, { newStudents: [change.newStudents[0]] }),
      ).toMatchObject({ ok: true, created: 1 });
    });

    it("refuses what is not allowed and changes nothing: a student already in the group, another group's membership, another teacher's rows", async () => {
      const a = await makeGroup(teacher, 'Groupe A', 1);
      const b = await makeGroup(teacher, 'Groupe B', 2);
      const sarah = await makeStudent(teacher, 'Sarah', { groupId: a });
      const karim = await makeStudent(teacher, 'Karim', { groupId: b });
      const stranger = await makeStudent(other, 'Zied');
      const foreignGroup = await makeGroup(other, 'Autre');
      const karimMembership = (await listGroupMembers(pool, teacher, b))[0]
        .membershipId;

      expect(await save(a, { addStudentIds: [sarah] })).toEqual({
        ok: false,
        reason: 'already_member',
      });
      // A membership of group B cannot be removed through group A.
      expect(await save(a, { removeMembershipIds: [karimMembership] })).toEqual(
        {
          ok: false,
          reason: 'membership_not_found',
        },
      );
      expect(await save(a, { addStudentIds: [stranger] })).toEqual({
        ok: false,
        reason: 'student_not_found',
      });
      expect(
        await save(a, {
          editedStudents: [{ studentId: stranger, fullName: 'X Y' }],
        }),
      ).toEqual({ ok: false, reason: 'student_not_found' });
      expect(await save(foreignGroup, { addStudentIds: [sarah] })).toEqual({
        ok: false,
        reason: 'group_not_found',
      });
      // Teacher B cannot save teacher A's group list.
      expect(await save(a, { addStudentIds: [karim] }, other)).toEqual({
        ok: false,
        reason: 'group_not_found',
      });
      expect((await getStudent(pool, other, stranger))?.fullName).toBe('Zied');
      expect(await listGroupMembers(pool, teacher, a)).toHaveLength(1);
      expect(await listGroupMembers(pool, teacher, b)).toHaveLength(1);
    });

    it('accepts an empty change, and refuses a huge one', async () => {
      const group = await makeGroup(teacher, 'Groupe A');
      expect(await save(group, {})).toEqual({
        ok: true,
        added: 0,
        created: 0,
        removed: 0,
        edited: 0,
      });
      expect(
        await save(group, {
          newStudents: Array.from({ length: 201 }, (_, i) => ({
            fullName: `Eleve ${i}`,
          })),
        }),
      ).toEqual({ ok: false, reason: 'too_many' });
    });
  });
});
