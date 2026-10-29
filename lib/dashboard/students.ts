import type { Pool, PoolClient } from 'pg';
import type { Queryable } from '@/lib/db/transaction';
import {
  digitsOnly,
  matchesWordStart,
  normalizeSearch,
} from '@/lib/text/normalize';
import {
  cleanStudent,
  type CleanStudent,
  type StudentInput,
  type StudentInputError,
} from '@/lib/students/clean';
import { SERVER_SEARCH_THRESHOLD, searchStudents } from '@/lib/students/search';
import { tunisNow } from './dates';
import { UNIQUE_VIOLATION, withTeacherLock } from './store';

// Students and memberships of a teacher (spec 5.6, 5.7). Every function takes the teacher's id
// and only touches that teacher's rows (invariant 16); the database also refuses a membership
// that links a student and a group of two different teachers.

/** A search on the server looks at no more than this many candidates. */
const CANDIDATE_LIMIT = 500;

export type StudentGroup = {
  membershipId: string;
  groupId: string;
  groupName: string;
  groupColor: string;
  joinedOn: string;
};

/** A student with the groups they are in now. */
export type StudentRow = {
  id: string;
  fullName: string;
  phone: string | null;
  note: string | null;
  groups: StudentGroup[];
  /** For the search functions of lib/students/search.ts. */
  groupNames: string[];
};

export {
  cleanName,
  cleanNote,
  cleanPhone,
  cleanStudent,
  NAME_MAX,
  NAME_MIN,
  NOTE_MAX,
  type CleanStudent,
  type StudentInput,
  type StudentInputError,
} from '@/lib/students/clean';

export const columnsOf = (clean: CleanStudent) => ({
  full_name: clean.fullName,
  full_name_norm: normalizeSearch(clean.fullName),
  phone: clean.phone,
  phone_digits: clean.phone === null ? null : digitsOnly(clean.phone),
  note: clean.note,
  note_norm: clean.note === null ? null : normalizeSearch(clean.note),
});

// ---------------------------------------------------------------------------------- reading

export type StudentDbRow = {
  id: string;
  full_name: string;
  phone: string | null;
  note: string | null;
};

export const STUDENT_COLUMNS = 'id, full_name, phone, note';

export async function attachGroups(
  db: Queryable,
  teacherId: string,
  rows: StudentDbRow[],
): Promise<StudentRow[]> {
  if (rows.length === 0) return [];
  const { rows: memberships } = await db.query<{
    id: string;
    student_id: string;
    group_id: string;
    group_name: string;
    group_color: string;
    joined_on: string;
  }>(
    `SELECT m.id, m.student_id, m.group_id, g.name AS group_name, g.color AS group_color,
            m.joined_on::text AS joined_on
       FROM memberships m JOIN groups g ON g.id = m.group_id
      WHERE m.teacher_id = $1 AND m.left_on IS NULL AND m.student_id = ANY($2::uuid[])
      ORDER BY lower(g.name), m.id`,
    [teacherId, rows.map((r) => r.id)],
  );
  return rows.map((row) => {
    const groups = memberships
      .filter((m) => m.student_id === row.id)
      .map((m) => ({
        membershipId: m.id,
        groupId: m.group_id,
        groupName: m.group_name,
        groupColor: m.group_color,
        joinedOn: m.joined_on,
      }));
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      note: row.note,
      groups,
      groupNames: groups.map((g) => g.groupName),
    };
  });
}

/** Every student of the teacher, alphabetical. */
export async function listStudents(
  db: Queryable,
  teacherId: string,
  options: { limit?: number } = {},
): Promise<StudentRow[]> {
  const { rows } = await db.query<StudentDbRow>(
    `SELECT ${STUDENT_COLUMNS} FROM students
      WHERE teacher_id = $1
      ORDER BY full_name_norm, id
      LIMIT $2::int`,
    [teacherId, options.limit ?? null],
  );
  return attachGroups(db, teacherId, rows);
}

/**
 * What a screen with a student search starts from (spec 5.7): up to 200 students, which the
 * browser filters by itself, or, when there are more, the first 200 and `serverMode` true (the
 * search then runs on the server).
 */
export async function loadStudentPool(
  db: Queryable,
  teacherId: string,
): Promise<{ students: StudentRow[]; total: number; serverMode: boolean }> {
  const total = await countStudents(db, teacherId);
  const students = await listStudents(db, teacherId, {
    limit: SERVER_SEARCH_THRESHOLD,
  });
  return { students, total, serverMode: total > SERVER_SEARCH_THRESHOLD };
}

export async function countStudents(
  db: Queryable,
  teacherId: string,
): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM students WHERE teacher_id = $1`,
    [teacherId],
  );
  return Number(rows[0].n);
}

export async function getStudent(
  db: Queryable,
  teacherId: string,
  studentId: string,
): Promise<StudentRow | null> {
  const { rows } = await db.query<StudentDbRow>(
    `SELECT ${STUDENT_COLUMNS} FROM students WHERE teacher_id = $1 AND id = $2`,
    [teacherId, studentId],
  );
  return (await attachGroups(db, teacherId, rows))[0] ?? null;
}

export type MembershipHistory = {
  id: string;
  groupId: string;
  groupName: string;
  groupColor: string;
  joinedOn: string;
  leftOn: string | null;
};

/** Every membership of one student, the current ones and the past ones, newest first. */
export async function listMemberships(
  db: Queryable,
  teacherId: string,
  studentId: string,
): Promise<MembershipHistory[]> {
  const { rows } = await db.query<{
    id: string;
    group_id: string;
    group_name: string;
    group_color: string;
    joined_on: string;
    left_on: string | null;
  }>(
    `SELECT m.id, m.group_id, g.name AS group_name, g.color AS group_color,
            m.joined_on::text AS joined_on, m.left_on::text AS left_on
       FROM memberships m JOIN groups g ON g.id = m.group_id
      WHERE m.teacher_id = $1 AND m.student_id = $2
      ORDER BY m.joined_on DESC, m.created_at DESC`,
    [teacherId, studentId],
  );
  return rows.map((r) => ({
    id: r.id,
    groupId: r.group_id,
    groupName: r.group_name,
    groupColor: r.group_color,
    joinedOn: r.joined_on,
    leftOn: r.left_on,
  }));
}

/** The students in a group now, alphabetical. */
export async function listGroupMembers(
  db: Queryable,
  teacherId: string,
  groupId: string,
): Promise<(StudentRow & { membershipId: string; joinedOn: string })[]> {
  const { rows } = await db.query<
    StudentDbRow & { membership_id: string; joined_on: string }
  >(
    `SELECT s.id, s.full_name, s.phone, s.note,
            m.id AS membership_id, m.joined_on::text AS joined_on
       FROM memberships m JOIN students s ON s.id = m.student_id
      WHERE m.teacher_id = $1 AND m.group_id = $2 AND m.left_on IS NULL
      ORDER BY s.full_name_norm, s.id`,
    [teacherId, groupId],
  );
  const students = await attachGroups(db, teacherId, rows);
  return students.map((student, index) => ({
    ...student,
    membershipId: rows[index].membership_id,
    joinedOn: rows[index].joined_on,
  }));
}

/** group id -> number of students in it now (for "Groupe vide" and the count). */
export async function groupStudentCounts(
  db: Queryable,
  teacherId: string,
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ group_id: string; n: string }>(
    `SELECT group_id, count(*) AS n FROM memberships
      WHERE teacher_id = $1 AND left_on IS NULL GROUP BY group_id`,
    [teacherId],
  );
  return new Map(rows.map((r) => [r.group_id, Number(r.n)]));
}

/** group id -> the ids of the students in it now ("Déjà dans ce groupe" in the picker). */
export async function groupMemberIds(
  db: Queryable,
  teacherId: string,
): Promise<Record<string, string[]>> {
  const { rows } = await db.query<{ group_id: string; ids: string[] }>(
    `SELECT group_id, array_agg(student_id) AS ids FROM memberships
      WHERE teacher_id = $1 AND left_on IS NULL GROUP BY group_id`,
    [teacherId],
  );
  return Object.fromEntries(rows.map((r) => [r.group_id, r.ids]));
}

/** group id -> the names and phones of its students now, for the search bar of the groups list. */
export async function groupStudentsForSearch(
  db: Queryable,
  teacherId: string,
): Promise<Map<string, { fullName: string; phone: string | null }[]>> {
  const { rows } = await db.query<{
    group_id: string;
    full_name: string;
    phone: string | null;
  }>(
    `SELECT m.group_id, s.full_name, s.phone
       FROM memberships m JOIN students s ON s.id = m.student_id
      WHERE m.teacher_id = $1 AND m.left_on IS NULL
      ORDER BY s.full_name_norm`,
    [teacherId],
  );
  const result = new Map<
    string,
    { fullName: string; phone: string | null }[]
  >();
  for (const row of rows)
    result.set(row.group_id, [
      ...(result.get(row.group_id) ?? []),
      { fullName: row.full_name, phone: row.phone },
    ]);
  return result;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * Search on the server, for a teacher with many students (spec 5.7): the database narrows the
 * list with the trigram indexes on the normalised columns, then the SAME functions as the
 * browser rank it (lib/students/search.ts), so both ways give the same answer.
 */
export async function searchStudentsOnServer(
  db: Queryable,
  teacherId: string,
  query: string,
): Promise<StudentRow[]> {
  const text = normalizeSearch(query);
  const digits = digitsOnly(query);
  if (text === '' && digits === '') return [];

  const tokens = text.split(' ').filter(Boolean);
  const params: unknown[] = [teacherId];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const conditions: string[] = [];
  if (tokens.length > 0) {
    // Name: every word typed starts a word of the name.
    conditions.push(
      '(' +
        tokens
          .map((token) => {
            const start = add(`${escapeLike(token)}%`);
            const inside = add(`% ${escapeLike(token)}%`);
            return `(full_name_norm LIKE ${start} OR full_name_norm LIKE ${inside})`;
          })
          .join(' AND ') +
        ')',
    );
    // Note: every word typed appears in the note (the exact word-start rule is applied after).
    conditions.push(
      '(' +
        tokens
          .map((token) => `note_norm LIKE ${add(`%${escapeLike(token)}%`)}`)
          .join(' AND ') +
        ')',
    );
  }
  if (digits.length >= 2)
    conditions.push(`phone_digits LIKE ${add(`%${escapeLike(digits)}%`)}`);

  // Group name: the teacher's groups are few, so which ones match is decided here.
  const { rows: groups } = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM groups WHERE teacher_id = $1',
    [teacherId],
  );
  const matching = groups.filter((g) => matchesWordStart(query, g.name));
  if (matching.length > 0)
    conditions.push(
      `EXISTS (SELECT 1 FROM memberships m WHERE m.student_id = students.id
                 AND m.left_on IS NULL AND m.group_id = ANY(${add(matching.map((g) => g.id))}::uuid[]))`,
    );

  const { rows } = await db.query<StudentDbRow>(
    `SELECT ${STUDENT_COLUMNS} FROM students
      WHERE teacher_id = $1 AND (${conditions.join(' OR ')})
      LIMIT ${CANDIDATE_LIMIT}`,
    params,
  );
  const students = await attachGroups(db, teacherId, rows);
  return searchStudents(students, query).map((r) => r.student);
}

// ---------------------------------------------------------------------------------- writing

type Failure<R extends string> = { ok: false; reason: R };

export type CreateStudentResult =
  | { ok: true; studentId: string }
  | Failure<StudentInputError | 'group_not_found'>
  | { ok: false; reason: 'duplicate'; existing: StudentRow };

/**
 * Creates a student, and when `groupId` is given a membership in that group, in one step
 * (spec 5.6 option 2, 5.7). A student with exactly the same name and phone already in the list
 * is a WARNING, not a block (two siblings may share a parent's phone): the answer says
 * "duplicate" with the existing student, and `force` creates it anyway.
 */
export async function createStudent(
  pool: Pool,
  teacherId: string,
  input: StudentInput,
  options: { groupId?: string | null; force?: boolean; now?: Date } = {},
): Promise<CreateStudentResult> {
  const cleaned = cleanStudent(input);
  if (!cleaned.ok) return cleaned;
  const clean = cleaned.value;
  const today = tunisNow(options.now ?? new Date()).date;

  return withTeacherLock(pool, teacherId, async (client) => {
    if (options.groupId) {
      const group = await client.query(
        'SELECT 1 FROM groups WHERE id = $1 AND teacher_id = $2',
        [options.groupId, teacherId],
      );
      if (group.rows.length === 0)
        return { ok: false, reason: 'group_not_found' } as const;
    }
    if (!options.force) {
      const same = await client.query<StudentDbRow>(
        `SELECT ${STUDENT_COLUMNS} FROM students
          WHERE teacher_id = $1 AND full_name_norm = $2
            AND phone IS NOT DISTINCT FROM $3::text
          ORDER BY id LIMIT 1`,
        [teacherId, normalizeSearch(clean.fullName), clean.phone],
      );
      if (same.rows[0]) {
        const [existing] = await attachGroups(client, teacherId, same.rows);
        return { ok: false, reason: 'duplicate', existing } as const;
      }
    }
    const columns = columnsOf(clean);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO students (teacher_id, full_name, full_name_norm, phone, phone_digits,
                             note, note_norm)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        teacherId,
        columns.full_name,
        columns.full_name_norm,
        columns.phone,
        columns.phone_digits,
        columns.note,
        columns.note_norm,
      ],
    );
    if (options.groupId)
      await client.query(
        `INSERT INTO memberships (teacher_id, group_id, student_id, joined_on)
         VALUES ($1, $2, $3, $4)`,
        [teacherId, options.groupId, rows[0].id, today],
      );
    return { ok: true, studentId: rows[0].id } as const;
  });
}

export type UpdateStudentResult =
  { ok: true } | Failure<StudentInputError | 'not_found'>;

/**
 * Changes one or more fields of a student. The change applies everywhere the student appears
 * (a group row, the Élèves list, the search): there is only this one record (invariant 14).
 */
export async function updateStudent(
  pool: Pool,
  teacherId: string,
  studentId: string,
  patch: Partial<StudentInput>,
): Promise<UpdateStudentResult> {
  return withTeacherLock(pool, teacherId, async (client) => {
    const current = await client.query<StudentDbRow>(
      `SELECT ${STUDENT_COLUMNS} FROM students WHERE id = $1 AND teacher_id = $2 FOR UPDATE`,
      [studentId, teacherId],
    );
    if (!current.rows[0]) return { ok: false, reason: 'not_found' } as const;
    const row = current.rows[0];
    const cleaned = cleanStudent({
      fullName: patch.fullName ?? row.full_name,
      phone: patch.phone ?? row.phone ?? '',
      note: patch.note ?? row.note ?? '',
    });
    if (!cleaned.ok) return cleaned;
    const columns = columnsOf(cleaned.value);
    await client.query(
      `UPDATE students SET full_name = $3, full_name_norm = $4, phone = $5, phone_digits = $6,
                           note = $7, note_norm = $8
        WHERE id = $1 AND teacher_id = $2`,
      [
        studentId,
        teacherId,
        columns.full_name,
        columns.full_name_norm,
        columns.phone,
        columns.phone_digits,
        columns.note,
        columns.note_norm,
      ],
    );
    return { ok: true } as const;
  });
}

export type MembershipFailure =
  | 'group_not_found'
  | 'student_not_found'
  | 'already_member'
  | 'nothing_selected';

export type AddMembershipsResult =
  { ok: true; count: number } | Failure<MembershipFailure>;

/** Opens one membership per (student, group) pair, in the caller's transaction. */
export async function openMemberships(
  client: PoolClient,
  teacherId: string,
  pairs: { studentId: string; groupId: string }[],
  today: string,
): Promise<AddMembershipsResult> {
  if (pairs.length === 0) return { ok: false, reason: 'nothing_selected' };
  const studentIds = [...new Set(pairs.map((p) => p.studentId))];
  const groupIds = [...new Set(pairs.map((p) => p.groupId))];

  const groups = await client.query(
    'SELECT id FROM groups WHERE teacher_id = $1 AND id = ANY($2::uuid[])',
    [teacherId, groupIds],
  );
  if (groups.rows.length !== groupIds.length)
    return { ok: false, reason: 'group_not_found' };
  const students = await client.query(
    'SELECT id FROM students WHERE teacher_id = $1 AND id = ANY($2::uuid[])',
    [teacherId, studentIds],
  );
  if (students.rows.length !== studentIds.length)
    return { ok: false, reason: 'student_not_found' };

  const open = await client.query(
    `SELECT 1 FROM memberships
      WHERE teacher_id = $1 AND left_on IS NULL
        AND (group_id, student_id) IN (SELECT * FROM unnest($2::uuid[], $3::uuid[]))`,
    [teacherId, pairs.map((p) => p.groupId), pairs.map((p) => p.studentId)],
  );
  if (open.rows.length > 0) return { ok: false, reason: 'already_member' };

  await client.query(
    `INSERT INTO memberships (teacher_id, group_id, student_id, joined_on)
     SELECT $1, t.g, t.s, $4::date FROM unnest($2::uuid[], $3::uuid[]) AS t(g, s)`,
    [
      teacherId,
      pairs.map((p) => p.groupId),
      pairs.map((p) => p.studentId),
      today,
    ],
  );
  return { ok: true, count: pairs.length };
}

async function addMembershipsSafely(
  pool: Pool,
  teacherId: string,
  pairs: { studentId: string; groupId: string }[],
  now: Date,
): Promise<AddMembershipsResult> {
  const today = tunisNow(now).date;
  try {
    return await withTeacherLock(pool, teacherId, (client) =>
      openMemberships(client, teacherId, pairs, today),
    );
  } catch (error) {
    // Two requests at the same moment: the database refused the second open membership.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION)
      return { ok: false, reason: 'already_member' };
    throw error;
  }
}

/**
 * "Ajouter les élèves (n)": one membership per selected student in one step, none created twice
 * (spec 5.6). All or nothing; a student already in the group refuses everything.
 */
export function addStudentsToGroup(
  pool: Pool,
  teacherId: string,
  groupId: string,
  studentIds: string[],
  now: Date = new Date(),
): Promise<AddMembershipsResult> {
  return addMembershipsSafely(
    pool,
    teacherId,
    [...new Set(studentIds)].map((studentId) => ({ studentId, groupId })),
    now,
  );
}

/** "Ajouter à un autre groupe": the same student, a new membership in each chosen group. */
export function addStudentToGroups(
  pool: Pool,
  teacherId: string,
  studentId: string,
  groupIds: string[],
  now: Date = new Date(),
): Promise<AddMembershipsResult> {
  return addMembershipsSafely(
    pool,
    teacherId,
    [...new Set(groupIds)].map((groupId) => ({ studentId, groupId })),
    now,
  );
}

export type RemoveResult = { ok: true } | Failure<'not_found'>;

/**
 * "Retirer du groupe": ends the membership (`left_on` = today), the history stays. The student
 * stays in the Élèves list, "Sans groupe" if it was the last group (spec 5.6, 5.7).
 */
export async function removeFromGroup(
  pool: Pool,
  teacherId: string,
  membershipId: string,
  now: Date = new Date(),
): Promise<RemoveResult> {
  const today = tunisNow(now).date;
  const { rowCount } = await pool.query(
    `UPDATE memberships SET left_on = GREATEST($3::date, joined_on)
      WHERE id = $1 AND teacher_id = $2 AND left_on IS NULL`,
    [membershipId, teacherId, today],
  );
  return rowCount ? { ok: true } : { ok: false, reason: 'not_found' };
}

export type MoveResult =
  | { ok: true }
  | Failure<'not_found' | 'group_not_found' | 'already_member' | 'same_group'>;

/**
 * "Déplacer vers un autre groupe": ends the membership here and starts one in the target group,
 * in one step (spec 5.6). The student must not already be in the target group.
 */
export async function moveToGroup(
  pool: Pool,
  teacherId: string,
  membershipId: string,
  targetGroupId: string,
  now: Date = new Date(),
): Promise<MoveResult> {
  const today = tunisNow(now).date;
  try {
    return await withTeacherLock(pool, teacherId, async (client) => {
      const { rows } = await client.query<{
        student_id: string;
        group_id: string;
      }>(
        `SELECT student_id, group_id FROM memberships
          WHERE id = $1 AND teacher_id = $2 AND left_on IS NULL FOR UPDATE`,
        [membershipId, teacherId],
      );
      if (!rows[0]) return { ok: false, reason: 'not_found' } as const;
      if (rows[0].group_id === targetGroupId)
        return { ok: false, reason: 'same_group' } as const;
      const target = await client.query(
        'SELECT 1 FROM groups WHERE id = $1 AND teacher_id = $2',
        [targetGroupId, teacherId],
      );
      if (target.rows.length === 0)
        return { ok: false, reason: 'group_not_found' } as const;
      const already = await client.query(
        `SELECT 1 FROM memberships
          WHERE teacher_id = $1 AND student_id = $2 AND group_id = $3 AND left_on IS NULL`,
        [teacherId, rows[0].student_id, targetGroupId],
      );
      if (already.rows.length > 0)
        return { ok: false, reason: 'already_member' } as const;
      await client.query(
        'UPDATE memberships SET left_on = GREATEST($2::date, joined_on) WHERE id = $1',
        [membershipId, today],
      );
      await client.query(
        `INSERT INTO memberships (teacher_id, group_id, student_id, joined_on)
         VALUES ($1, $2, $3, $4)`,
        [teacherId, targetGroupId, rows[0].student_id, today],
      );
      return { ok: true } as const;
    });
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION)
      return { ok: false, reason: 'already_member' };
    throw error;
  }
}

export type DeleteStudentResult =
  { ok: true } | Failure<'not_found' | 'name_mismatch'>;

/**
 * "Supprimer": permanent, and only when the name is typed exactly (spec 5.7, invariant 15).
 * Their memberships go with them. (The warning about recorded revenue comes with the monthly
 * accounts, M10.)
 */
export async function deleteStudent(
  pool: Pool,
  teacherId: string,
  studentId: string,
  typedName: string,
): Promise<DeleteStudentResult> {
  return withTeacherLock(pool, teacherId, async (client) => {
    const { rows } = await client.query<{ full_name: string }>(
      'SELECT full_name FROM students WHERE id = $1 AND teacher_id = $2 FOR UPDATE',
      [studentId, teacherId],
    );
    if (!rows[0]) return { ok: false, reason: 'not_found' } as const;
    if (typedName.trim() !== rows[0].full_name.trim())
      return { ok: false, reason: 'name_mismatch' } as const;
    await client.query(
      'DELETE FROM students WHERE id = $1 AND teacher_id = $2',
      [studentId, teacherId],
    );
    return { ok: true } as const;
  });
}
