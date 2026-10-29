import { normalizePhone } from '@/lib/phone';

// What a student's name, phone and note must look like (spec 5.7). Pure functions: the screens
// check with them while the teacher types, and the server checks again with the same code.

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const NOTE_MAX = 300;

export type StudentInput = {
  fullName: string;
  /** What was typed; empty means no phone. */
  phone?: string;
  note?: string;
};

export type StudentInputError =
  'invalid_name' | 'invalid_phone' | 'invalid_note';

export type CleanStudent = {
  fullName: string;
  phone: string | null;
  note: string | null;
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function cleanName(value: string): string | null {
  const name = value.replace(/\s+/g, ' ').trim();
  return name.length >= NAME_MIN &&
    name.length <= NAME_MAX &&
    !CONTROL_CHARACTERS.test(name)
    ? name
    : null;
}

/** Phone is optional and validated as in spec 4.1; "" means none. */
export function cleanPhone(value: string): string | null | undefined {
  const typed = value.trim();
  if (typed === '') return null;
  return normalizePhone(typed) ?? undefined;
}

export function cleanNote(value: string): string | null | undefined {
  const note = value.trim();
  if (note === '') return null;
  return note.length <= NOTE_MAX &&
    !CONTROL_CHARACTERS.test(note.replace(/\n/g, ' '))
    ? note
    : undefined;
}

export function cleanStudent(
  input: StudentInput,
):
  { ok: true; value: CleanStudent } | { ok: false; reason: StudentInputError } {
  const fullName = cleanName(input.fullName ?? '');
  if (fullName === null) return { ok: false, reason: 'invalid_name' };
  const phone = cleanPhone(input.phone ?? '');
  if (phone === undefined) return { ok: false, reason: 'invalid_phone' };
  const note = cleanNote(input.note ?? '');
  if (note === undefined) return { ok: false, reason: 'invalid_note' };
  return { ok: true, value: { fullName, phone, note } };
}
