import { updateStudentAction } from '@/app/[locale]/(dashboard)/student-actions';

/**
 * Saves ONE field of a student (their name, phone or note): the same record is edited from the
 * group page, the student page and the Élèves list, so a change shows everywhere (spec 5.7).
 * Returns null when it worked, or the code of the error to show.
 */
export async function saveStudentField(
  studentId: string,
  field: 'fullName' | 'phone' | 'note',
  value: string,
): Promise<string | null> {
  const result = await updateStudentAction(studentId, { [field]: value });
  return result.ok ? null : result.reason;
}
