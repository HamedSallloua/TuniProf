// The filters of the search page (spec 3.2), read from the address bar and written back.
// Anything invalid is ignored, never an error: a stale or hand-typed link still shows results.

export const SORTS = [
  'pertinence',
  'prix-asc',
  'prix-desc',
  'mieux-notes',
  'recents',
] as const;
export type Sort = (typeof SORTS)[number];

export type Mode = 'at_home' | 'at_teacher' | 'online';

// Address-bar values for the three modes.
export const MODE_PARAMS: Record<string, Mode> = {
  domicile: 'at_home',
  professeur: 'at_teacher',
  'en-ligne': 'online',
};
const MODE_TO_PARAM: Record<Mode, string> = {
  at_home: 'domicile',
  at_teacher: 'professeur',
  online: 'en-ligne',
};

export type SearchFilters = {
  /** Slugs from the catalogues. */
  governorate?: string;
  delegation?: string;
  level?: string;
  subject?: string;
  mode?: Mode;
  minRateMillimes?: number;
  maxRateMillimes?: number;
  minRating?: number;
  sort: Sort;
  page: number;
};

export type RawParams = Record<string, string | string[] | undefined>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_PAGE = 500;
const MAX_RATE_DT = 100000;

function first(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

function slug(value: string | string[] | undefined): string | undefined {
  const text = first(value);
  return text && text.length <= 80 && SLUG.test(text) ? text : undefined;
}

/** "25", "25,5", "25.500" -> millimes. Money is never a float inside the app. */
export function parseDinarsToMillimes(
  value: string | string[] | undefined,
): number | undefined {
  const text = first(value)?.replace(',', '.');
  if (!text || !/^\d{1,6}(\.\d{1,3})?$/.test(text)) return undefined;
  const [whole, fraction = ''] = text.split('.');
  const millimes = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return millimes <= MAX_RATE_DT * 1000 ? millimes : undefined;
}

export function parseSearchParams(raw: RawParams): SearchFilters {
  const governorate = slug(raw.gouvernorat);
  const modeValue = first(raw.mode);
  const sortValue = first(raw.tri);
  const ratingValue = Number(first(raw.note)?.replace(',', '.'));
  const pageValue = Number(first(raw.page));

  let min = parseDinarsToMillimes(raw.prix_min);
  let max = parseDinarsToMillimes(raw.prix_max);
  // Typed the wrong way round: swap instead of showing nothing.
  if (min !== undefined && max !== undefined && min > max)
    [min, max] = [max, min];

  return {
    governorate,
    // A délégation only makes sense inside its governorate.
    delegation: governorate ? slug(raw.delegation) : undefined,
    level: slug(raw.niveau),
    subject: slug(raw.matiere),
    mode: modeValue ? MODE_PARAMS[modeValue] : undefined,
    minRateMillimes: min,
    maxRateMillimes: max,
    minRating:
      Number.isFinite(ratingValue) && ratingValue > 0 && ratingValue <= 5
        ? Math.round(ratingValue * 10) / 10
        : undefined,
    sort: (SORTS as readonly string[]).includes(sortValue ?? '')
      ? (sortValue as Sort)
      : 'pertinence',
    page:
      Number.isInteger(pageValue) && pageValue >= 1
        ? Math.min(pageValue, MAX_PAGE)
        : 1,
  };
}

function dinars(millimes: number): string {
  const whole = Math.floor(millimes / 1000);
  const rest = millimes % 1000;
  return rest === 0
    ? String(whole)
    : `${whole}.${String(rest).padStart(3, '0').replace(/0+$/, '')}`;
}

/** The query string of a search ("?gouvernorat=sfax&matiere=physique"), without the defaults. */
export function buildSearchQuery(filters: Partial<SearchFilters>): string {
  const params = new URLSearchParams();
  if (filters.governorate) params.set('gouvernorat', filters.governorate);
  if (filters.governorate && filters.delegation)
    params.set('delegation', filters.delegation);
  if (filters.level) params.set('niveau', filters.level);
  if (filters.subject) params.set('matiere', filters.subject);
  if (filters.mode) params.set('mode', MODE_TO_PARAM[filters.mode]);
  if (filters.minRateMillimes !== undefined)
    params.set('prix_min', dinars(filters.minRateMillimes));
  if (filters.maxRateMillimes !== undefined)
    params.set('prix_max', dinars(filters.maxRateMillimes));
  if (filters.minRating !== undefined)
    params.set('note', String(filters.minRating));
  if (filters.sort && filters.sort !== 'pertinence')
    params.set('tri', filters.sort);
  if (filters.page && filters.page > 1)
    params.set('page', String(filters.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}
