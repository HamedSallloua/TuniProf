// The wording of titles of landing pages and profiles. French elisions: "Cours d'Anglais"
// (not "de Anglais"), "à Sfax" but "au Kef" (the governorate is called "Le Kef"). Arabic has
// no elision: the subject stays as it is and the place gets "في" ("in").

const VOWEL_OR_MUTE_H = /^[aeiouyàâäéèêëîïôöùûüh]/i;

/** "Anglais" -> "d'Anglais", "Physique" -> "de Physique". */
export function deSubject(name: string, locale: string): string {
  if (locale === 'ar') return name;
  return VOWEL_OR_MUTE_H.test(name) ? `d'${name}` : `de ${name}`;
}

/** "Sfax" -> "à Sfax", "Le Kef" -> "au Kef". */
export function inGovernorate(name: string, locale: string): string {
  if (locale === 'ar') return `في ${name}`;
  const match = /^Le\s+(.+)$/.exec(name);
  return match ? `au ${match[1]}` : `à ${name}`;
}
