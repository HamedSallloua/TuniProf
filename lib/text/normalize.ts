// Searching names the way people type them (spec 5.5, 5.6): capital letters, accents and
// Arabic diacritics do not matter, and "Mo" finds "Mohamed". The group search uses it now,
// the student search of M9 will use the same functions.

/**
 * Lower case, no accents, no Arabic diacritics or tatweel, one form of alef and yeh.
 * "Élève" -> "eleve", "مُحَمَّد" -> "محمد", "أحمد" -> "احمد".
 */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Latin accents
    .replace(/[ً-ٰٟۖ-ۭـ]/g, '') // Arabic diacritics and tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Only the digits ("+216 22 345 678" -> "21622345678"), Arabic-Indic digits included. */
export function digitsOnly(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
}

/**
 * Every word typed must be the beginning of a word of the text: "mo sa" finds "Mohamed Sarah"
 * and "Sarah Mohamed", but "ham" does not find "Mohamed" (spec 5.6: words are matched from
 * their start).
 */
export function matchesWordStart(query: string, text: string): boolean {
  const words = normalizeSearch(text).split(' ');
  const wanted = normalizeSearch(query).split(' ').filter(Boolean);
  return (
    wanted.length > 0 &&
    wanted.every((prefix) => words.some((word) => word.startsWith(prefix)))
  );
}
