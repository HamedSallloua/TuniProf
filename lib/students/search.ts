import {
  digitsOnly,
  matchesWordStart,
  normalizeSearch,
} from '@/lib/text/normalize';

// The ONE student search (spec 5.6, 5.7): the picker of "Ajouter élève", the new-student
// suggestions, the Élèves list and the group search all use these functions, so every screen
// finds the same people. Pure functions: the browser filters a short list with them, and the
// server uses them to rank what the database found.

export type SearchableStudent = {
  fullName: string;
  /** E.164, "+21622345678", or null. */
  phone: string | null;
  note: string | null;
  /** The names of the groups the student is in now. */
  groupNames: string[];
};

/** Why a student matched; the order is the ranking order (spec 5.7). */
export type MatchKind = 'name' | 'phone' | 'note' | 'group';

/** Show this many results, then "Voir plus" (spec 5.7). */
export const PAGE_SIZE = 20;
/** Below about this many students the list is filtered in the browser, above it by the server. */
export const SERVER_SEARCH_THRESHOLD = 200;
/** Typing less digits than this does not search phone numbers (one digit matches everyone). */
export const MIN_PHONE_DIGITS = 2;

const RANK: Record<MatchKind, number> = {
  name: 0,
  phone: 1,
  note: 2,
  group: 3,
};

/**
 * The best reason why `student` matches `query`, or null. The words typed must be the start of
 * words of the name; phone digits match anywhere in the number; the note and the group names
 * are matched by word start too. Accents, capitals and Arabic diacritics do not matter.
 */
export function matchStudent(
  student: SearchableStudent,
  query: string,
): MatchKind | null {
  if (matchesWordStart(query, student.fullName)) return 'name';
  const digits = digitsOnly(query);
  if (
    digits.length >= MIN_PHONE_DIGITS &&
    student.phone !== null &&
    digitsOnly(student.phone).includes(digits)
  )
    return 'phone';
  if (student.note !== null && matchesWordStart(query, student.note))
    return 'note';
  if (student.groupNames.some((name) => matchesWordStart(query, name)))
    return 'group';
  return null;
}

/**
 * The students that match, best reason first (name, then phone, then note, then group name),
 * each group of results in alphabetical order. An empty query returns everybody, alphabetical,
 * with `match` null.
 */
export function searchStudents<T extends SearchableStudent>(
  students: T[],
  query: string,
): { student: T; match: MatchKind | null }[] {
  const byName = (a: T, b: T) =>
    normalizeSearch(a.fullName).localeCompare(normalizeSearch(b.fullName));
  if (normalizeSearch(query) === '' && digitsOnly(query) === '')
    return [...students]
      .sort(byName)
      .map((student) => ({ student, match: null }));

  return students
    .flatMap((student) => {
      const match = matchStudent(student, query);
      return match ? [{ student, match }] : [];
    })
    .sort(
      (a, b) =>
        RANK[a.match as MatchKind] - RANK[b.match as MatchKind] ||
        byName(a.student, b.student),
    );
}

/** What the typed text of a name field means as a search ("Moha" finds Mohamed). */
export function isSearchable(query: string): boolean {
  return normalizeSearch(query) !== '' || digitsOnly(query) !== '';
}
