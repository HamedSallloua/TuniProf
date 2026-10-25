/**
 * Turns a name into a URL-safe slug: "Béja" -> "beja", "M'saken" -> "m-saken".
 * Only for Latin text: an Arabic-only name gives an empty string.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
