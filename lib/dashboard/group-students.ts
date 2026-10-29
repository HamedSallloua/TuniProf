import type { Pool } from 'pg';
import { normalizeSearch } from '@/lib/text/normalize';
import { tunisNow } from './dates';
import { UNIQUE_VIOLATION, withTeacherLock } from './store';
import {
  attachGroups,
  cleanStudent,
  type CleanStudent,
  columnsOf,
  openMemberships,
  STUDENT_COLUMNS,
  type MembershipFailure,
  type StudentDbRow,
  type StudentInput,
  type StudentInputError,
  type StudentRow,
} from './students';

// "Modifier liste d'élèves" of a group (owner request after M9), the counterpart of "Modifier
// calendrier": every change is prepared on the page and saved in ONE step. Students added to the
// group, new students, students taken out of it and edited student information all happen
// together or not at all.

/** At most this many changes in one save. */
export const MAX_LIST_CHANGES = 200;

export type GroupStudentsChange = {
  /** Existing students who join the group. */
  addStudentIds?: string[];
  /** New students, created and put in the group. `force` = "Créer quand même" after the warning. */
  newStudents?: (StudentInput & { force?: boolean })[];
  /** Memberships of THIS group that end ("Retirer du groupe"); the history stays. */
  removeMembershipIds?: string[];
  /** Changed information; only the fields given change. */
  editedStudents?: {
    studentId: string;
    fullName?: string;
    phone?: string;
    note?: string;
  }[];
};

export type SaveGroupStudentsResult =
  | {
      ok: true;
      added: number;
      created: number;
      removed: number;
      edited: number;
    }
  | {
      ok: false;
      reason: StudentInputError | MembershipFailure | 'too_many';
      /** Which list the problem is in, and which row (0-based), when it belongs to one. */
      list?: 'new' | 'edited';
      index?: number;
    }
  | { ok: false; reason: 'membership_not_found' }
  | {
      ok: false;
      reason: 'duplicate';
      /** The new student (0-based) that looks like `existing`. */
      index: number;
      existing: StudentRow;
    };

/** Thrown inside the transaction to roll everything back with a clear answer. */
class Abort extends Error {
  constructor(readonly result: SaveGroupStudentsResult) {
    super('abort');
  }
}

/**
 * Saves every change of the group's student list at once, or none of them (the answer says which
 * row is wrong). A new student with the same name and phone as an existing one is a warning
 * (`duplicate`), settled by `force` on that row, as in "Ajouter élève".
 */
export async function saveGroupStudents(
  pool: Pool,
  teacherId: string,
  groupId: string,
  change: GroupStudentsChange,
  now: Date = new Date(),
): Promise<SaveGroupStudentsResult> {
  const addIds = [...new Set(change.addStudentIds ?? [])];
  const removeIds = [...new Set(change.removeMembershipIds ?? [])];
  const fresh = change.newStudents ?? [];
  const edits = change.editedStudents ?? [];
  if (
    addIds.length + removeIds.length + fresh.length + edits.length >
    MAX_LIST_CHANGES
  )
    return { ok: false, reason: 'too_many' };

  const cleanedNew: CleanStudent[] = [];
  for (let index = 0; index < fresh.length; index++) {
    const cleaned = cleanStudent(fresh[index]);
    if (!cleaned.ok)
      return { ok: false, reason: cleaned.reason, list: 'new', index };
    cleanedNew.push(cleaned.value);
  }
  const today = tunisNow(now).date;

  try {
    return await withTeacherLock(pool, teacherId, async (client) => {
      const fail = (result: SaveGroupStudentsResult): never => {
        throw new Abort(result);
      };

      const group = await client.query(
        'SELECT 1 FROM groups WHERE id = $1 AND teacher_id = $2',
        [groupId, teacherId],
      );
      if (group.rows.length === 0)
        fail({ ok: false, reason: 'group_not_found' });

      // 1. Students taken out of the group.
      if (removeIds.length > 0) {
        const ended = await client.query(
          `UPDATE memberships SET left_on = GREATEST($4::date, joined_on)
            WHERE id = ANY($1::uuid[]) AND group_id = $2 AND teacher_id = $3
              AND left_on IS NULL`,
          [removeIds, groupId, teacherId, today],
        );
        if (ended.rowCount !== removeIds.length)
          fail({ ok: false, reason: 'membership_not_found' });
      }

      // 2. Edited information (the one student record: it changes everywhere).
      for (let index = 0; index < edits.length; index++) {
        const edit = edits[index];
        const current = await client.query<StudentDbRow>(
          `SELECT ${STUDENT_COLUMNS} FROM students
            WHERE id = $1 AND teacher_id = $2 FOR UPDATE`,
          [edit.studentId, teacherId],
        );
        const row = current.rows[0];
        if (!row) return fail({ ok: false, reason: 'student_not_found' });
        const cleaned = cleanStudent({
          fullName: edit.fullName ?? row.full_name,
          phone: edit.phone ?? row.phone ?? '',
          note: edit.note ?? row.note ?? '',
        });
        if (!cleaned.ok)
          return fail({
            ok: false,
            reason: cleaned.reason,
            list: 'edited',
            index,
          });
        const columns = columnsOf(cleaned.value);
        await client.query(
          `UPDATE students SET full_name = $3, full_name_norm = $4, phone = $5,
                               phone_digits = $6, note = $7, note_norm = $8
            WHERE id = $1 AND teacher_id = $2`,
          [
            edit.studentId,
            teacherId,
            columns.full_name,
            columns.full_name_norm,
            columns.phone,
            columns.phone_digits,
            columns.note,
            columns.note_norm,
          ],
        );
      }

      // 3. New students (with the duplicate warning).
      const createdIds: string[] = [];
      for (let index = 0; index < cleanedNew.length; index++) {
        const clean = cleanedNew[index];
        if (!fresh[index].force) {
          const same = await client.query<StudentDbRow>(
            `SELECT ${STUDENT_COLUMNS} FROM students
              WHERE teacher_id = $1 AND full_name_norm = $2
                AND phone IS NOT DISTINCT FROM $3::text
              ORDER BY id LIMIT 1`,
            [teacherId, normalizeSearch(clean.fullName), clean.phone],
          );
          if (same.rows[0]) {
            const [existing] = await attachGroups(client, teacherId, same.rows);
            return fail({ ok: false, reason: 'duplicate', index, existing });
          }
        }
        const columns = columnsOf(clean);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO students (teacher_id, full_name, full_name_norm, phone,
                                 phone_digits, note, note_norm)
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
        createdIds.push(inserted.rows[0].id);
      }

      // 4. Students joining the group (existing and new): one membership each.
      const pairs = [...addIds, ...createdIds].map((studentId) => ({
        studentId,
        groupId,
      }));
      if (pairs.length > 0) {
        const opened = await openMemberships(client, teacherId, pairs, today);
        if (!opened.ok) fail(opened);
      }

      return {
        ok: true,
        added: addIds.length,
        created: createdIds.length,
        removed: removeIds.length,
        edited: edits.length,
      } as const;
    });
  } catch (error) {
    if (error instanceof Abort) return error.result;
    // Two requests at the same moment: the database refused the second open membership.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION)
      return { ok: false, reason: 'already_member' };
    throw error;
  }
}
