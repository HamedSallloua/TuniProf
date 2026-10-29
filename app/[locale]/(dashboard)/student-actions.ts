'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { readableTeacher, writableTeacher } from '@/lib/dashboard/context';
import {
  addStudentsToGroup,
  addStudentToGroups,
  createStudent,
  deleteStudent,
  moveToGroup,
  removeFromGroup,
  searchStudentsOnServer,
  updateStudent,
  type AddMembershipsResult,
  type CreateStudentResult,
  type DeleteStudentResult,
  type MoveResult,
  type RemoveResult,
  type StudentRow,
  type UpdateStudentResult,
} from '@/lib/dashboard/students';
import {
  MAX_LIST_CHANGES,
  saveGroupStudents,
  type SaveGroupStudentsResult,
} from '@/lib/dashboard/group-students';
import { getPool } from '@/lib/db/client';

// Server actions of the students (M9). Same rules as the other Dashboard actions: signed-in
// teacher, Dashboard fully active for every change (read-only and ended Dashboards are refused
// HERE, not only hidden on the screen), input validated, then a tested function of
// lib/dashboard/students that only touches this teacher's rows.

type Blocked = {
  ok: false;
  reason: 'read_only' | 'no_access' | 'not_signed_in' | 'invalid';
};

const uuid = z.string().uuid();
const uuidList = z.array(uuid).max(500);

function revalidate() {
  revalidatePath('/', 'layout');
}

/** Search for the teachers with many students (the browser filters short lists itself). */
export async function searchStudentsAction(
  query: unknown,
): Promise<{ ok: true; students: StudentRow[] } | Blocked> {
  const who = await readableTeacher();
  if (!who.ok) return who;
  if (typeof query !== 'string' || query.length > 100)
    return { ok: false, reason: 'invalid' };
  return {
    ok: true,
    students: await searchStudentsOnServer(getPool(), who.user.id, query),
  };
}

const newStudentSchema = z.object({
  fullName: z.string().max(200),
  phone: z.string().max(40).optional(),
  note: z.string().max(1000).optional(),
  groupId: uuid.nullable().optional(),
  // "Créer quand même" after the duplicate warning.
  force: z.boolean().optional(),
});

export async function createStudentAction(
  input: unknown,
): Promise<CreateStudentResult | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const parsed = newStudentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const { groupId, force, ...student } = parsed.data;
  const result = await createStudent(getPool(), who.user.id, student, {
    groupId: groupId ?? null,
    force: force === true,
  });
  if (result.ok) revalidate();
  return result;
}

const patchSchema = z.object({
  fullName: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  note: z.string().max(1000).optional(),
});

/** Edits the one student record: the change shows in every group and in the Élèves list. */
export async function updateStudentAction(
  studentId: unknown,
  patch: unknown,
): Promise<UpdateStudentResult | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const id = uuid.safeParse(studentId);
  const parsed = patchSchema.safeParse(patch);
  if (!id.success || !parsed.success) return { ok: false, reason: 'invalid' };
  const result = await updateStudent(
    getPool(),
    who.user.id,
    id.data,
    parsed.data,
  );
  if (result.ok) revalidate();
  return result;
}

/** "Ajouter les élèves (n)": the selected existing students join the group, all or nothing. */
export async function addStudentsToGroupAction(
  groupId: unknown,
  studentIds: unknown,
): Promise<AddMembershipsResult | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const group = uuid.safeParse(groupId);
  const ids = uuidList.safeParse(studentIds);
  if (!group.success || !ids.success) return { ok: false, reason: 'invalid' };
  const result = await addStudentsToGroup(
    getPool(),
    who.user.id,
    group.data,
    ids.data,
  );
  if (result.ok) revalidate();
  return result;
}

/** "Ajouter à un autre groupe" / "Ajouter à un groupe": one student, several groups. */
export async function addStudentToGroupsAction(
  studentId: unknown,
  groupIds: unknown,
): Promise<AddMembershipsResult | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const student = uuid.safeParse(studentId);
  const ids = uuidList.safeParse(groupIds);
  if (!student.success || !ids.success) return { ok: false, reason: 'invalid' };
  const result = await addStudentToGroups(
    getPool(),
    who.user.id,
    student.data,
    ids.data,
  );
  if (result.ok) revalidate();
  return result;
}

export async function removeFromGroupAction(
  membershipId: unknown,
): Promise<RemoveResult | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const id = uuid.safeParse(membershipId);
  if (!id.success) return { ok: false, reason: 'invalid' };
  const result = await removeFromGroup(getPool(), who.user.id, id.data);
  if (result.ok) revalidate();
  return result;
}

export async function moveToGroupAction(
  membershipId: unknown,
  targetGroupId: unknown,
): Promise<MoveResult | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const id = uuid.safeParse(membershipId);
  const target = uuid.safeParse(targetGroupId);
  if (!id.success || !target.success) return { ok: false, reason: 'invalid' };
  const result = await moveToGroup(
    getPool(),
    who.user.id,
    id.data,
    target.data,
  );
  if (result.ok) revalidate();
  return result;
}

const listChangeSchema = z.object({
  addStudentIds: uuidList.optional(),
  removeMembershipIds: uuidList.optional(),
  newStudents: z
    .array(
      z.object({
        fullName: z.string().max(200),
        phone: z.string().max(40).optional(),
        note: z.string().max(1000).optional(),
        force: z.boolean().optional(),
      }),
    )
    .max(MAX_LIST_CHANGES)
    .optional(),
  editedStudents: z
    .array(
      z.object({
        studentId: uuid,
        fullName: z.string().max(200).optional(),
        phone: z.string().max(40).optional(),
        note: z.string().max(1000).optional(),
      }),
    )
    .max(MAX_LIST_CHANGES)
    .optional(),
});

/**
 * "Enregistrer la liste" of "Modifier liste d'élèves": students added, created, removed and
 * edited are saved in one step, all or nothing.
 */
export async function saveGroupStudentsAction(
  groupId: unknown,
  change: unknown,
): Promise<SaveGroupStudentsResult | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const group = uuid.safeParse(groupId);
  const parsed = listChangeSchema.safeParse(change);
  if (!group.success || !parsed.success)
    return { ok: false, reason: 'invalid' };
  const result = await saveGroupStudents(
    getPool(),
    who.user.id,
    group.data,
    parsed.data,
  );
  if (result.ok) revalidate();
  return result;
}

/** "Supprimer" a student for good, with the name typed (spec 5.7, invariant 15). */
export async function deleteStudentAction(
  studentId: unknown,
  typedName: unknown,
): Promise<DeleteStudentResult | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const id = uuid.safeParse(studentId);
  if (!id.success || typeof typedName !== 'string')
    return { ok: false, reason: 'invalid' };
  const result = await deleteStudent(
    getPool(),
    who.user.id,
    id.data,
    typedName,
  );
  if (result.ok) revalidate();
  return result;
}
