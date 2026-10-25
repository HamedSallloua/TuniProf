import { z } from 'zod';
import type { RateRange } from './catalogue';
import type { ProfileInput, SubjectChoice } from './repo';
import {
  isDiploma,
  isExperience,
  isMode,
  parseRateToMillimes,
  validateBio,
  validateCustomSubjectName,
  validateFullName,
  type Diploma,
  type Experience,
  type Mode,
} from './rules';

// Reads the profile form (FormData) and checks every field on the server. The photo file is
// handled separately (photo.ts). Error codes are keys of profile.errors in messages/*.json.

export type FieldError = { code: string; min?: number; max?: number };

export type ProfileFieldErrors = Partial<
  Record<
    | 'fullName'
    | 'diploma'
    | 'experience'
    | 'bio'
    | 'governorate'
    | 'modes'
    | 'levels'
    | 'zones'
    | 'subjects'
    | 'customSubject'
    | 'photo',
    FieldError
  >
> & { rates?: Record<string, FieldError> };

/** What the person typed, to show again after an error (passwords have no such field). */
export type ProfileFormValues = {
  fullName: string;
  diploma: string;
  experience: string;
  bio: string;
  governorate: string;
  modes: string[];
  levels: string[];
  zones: string[];
  /** subject id -> the rate as typed, for every ticked subject */
  subjects: Record<string, string>;
  customName: string;
  customRate: string;
};

export type ParsedProfileForm =
  | {
      ok: true;
      input: Omit<ProfileInput, 'photo'>;
      photoFile: File | null;
      removePhoto: boolean;
      values: ProfileFormValues;
    }
  | { ok: false; errors: ProfileFieldErrors; values: ProfileFormValues };

const uuid = z.string().uuid();
const MAX_LEVELS = 16;
const MAX_ZONES = 100;
const MAX_SUBJECTS = 20;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function ids(formData: FormData, name: string): string[] {
  return [
    ...new Set(
      formData.getAll(name).filter((v): v is string => typeof v === 'string'),
    ),
  ];
}

/**
 * `strict` is true when the profile is submitted for review (or already approved): every
 * required field must be there. Otherwise (saving a draft) empty fields are fine, but
 * whatever is filled in must be valid.
 */
export function parseProfileForm(
  formData: FormData,
  options: { strict: boolean; rateRange: RateRange },
): ParsedProfileForm {
  const { strict, rateRange } = options;
  const errors: ProfileFieldErrors = {};

  const values: ProfileFormValues = {
    fullName: text(formData, 'fullName'),
    diploma: text(formData, 'diploma'),
    experience: text(formData, 'experience'),
    bio: text(formData, 'bio'),
    governorate: text(formData, 'governorate'),
    modes: ids(formData, 'modes'),
    levels: ids(formData, 'levels'),
    zones: ids(formData, 'zones'),
    subjects: {},
    customName: text(formData, 'customName'),
    customRate: text(formData, 'customRate'),
  };
  const subjectIds = ids(formData, 'subjects');
  for (const id of subjectIds)
    values.subjects[id] = text(formData, `rate_${id}`);

  // Full name
  let fullName: string | null = null;
  if (values.fullName.trim() !== '') {
    const result = validateFullName(values.fullName);
    if (result.ok) fullName = result.value;
    else errors.fullName = { code: result.error };
  } else if (strict) errors.fullName = { code: 'required' };

  // Diploma and experience (closed lists)
  let diploma: Diploma | null = null;
  if (values.diploma) {
    if (isDiploma(values.diploma)) diploma = values.diploma;
    else errors.diploma = { code: 'invalidChoice' };
  } else if (strict) errors.diploma = { code: 'required' };

  let experience: Experience | null = null;
  if (values.experience) {
    if (isExperience(values.experience)) experience = values.experience;
    else errors.experience = { code: 'invalidChoice' };
  } else if (strict) errors.experience = { code: 'required' };

  // Bio
  let bio: string | null = null;
  if (values.bio.trim() !== '') {
    const result = validateBio(values.bio);
    if (result.ok) bio = result.value;
    else errors.bio = { code: result.error };
  } else if (strict) errors.bio = { code: 'required' };

  // Modes
  const modes: Mode[] = [];
  for (const mode of values.modes) {
    if (isMode(mode)) modes.push(mode);
    else errors.modes = { code: 'invalidChoice' };
  }
  if (strict && modes.length === 0 && !errors.modes)
    errors.modes = { code: 'modesRequired' };

  // Governorate, zones and levels (their existence is checked by the database)
  let governorateId: string | null = null;
  if (values.governorate) {
    if (uuid.safeParse(values.governorate).success)
      governorateId = values.governorate;
    else errors.governorate = { code: 'invalidChoice' };
  } else if (strict) errors.governorate = { code: 'required' };

  const zoneIds = values.zones.filter((id) => uuid.safeParse(id).success);
  if (zoneIds.length !== values.zones.length || zoneIds.length > MAX_ZONES) {
    errors.zones = { code: 'invalidChoice' };
  }
  const onlineOnly = modes.length === 1 && modes[0] === 'online';
  if (strict && !errors.zones && zoneIds.length === 0 && !onlineOnly) {
    errors.zones = { code: 'zonesRequired' };
  }

  const levelIds = values.levels.filter((id) => uuid.safeParse(id).success);
  if (
    levelIds.length !== values.levels.length ||
    levelIds.length > MAX_LEVELS
  ) {
    errors.levels = { code: 'invalidChoice' };
  } else if (strict && levelIds.length === 0)
    errors.levels = { code: 'levelsRequired' };

  // Subjects and rates: a ticked subject always needs a valid rate, even in a draft.
  const subjects: SubjectChoice[] = [];
  if (subjectIds.length > MAX_SUBJECTS)
    errors.subjects = { code: 'invalidChoice' };
  for (const id of subjectIds) {
    if (!uuid.safeParse(id).success) {
      errors.subjects = { code: 'invalidChoice' };
      continue;
    }
    const rate = parseRateToMillimes(values.subjects[id], rateRange);
    if (rate.ok) subjects.push({ subjectId: id, rateMillimes: rate.value });
    else
      (errors.rates ??= {})[id] = {
        code: rate.error,
        min: rateRange.min,
        max: rateRange.max,
      };
  }

  // "Autre": a subject typed by the teacher.
  if (values.customName.trim() !== '' || values.customRate.trim() !== '') {
    const name = validateCustomSubjectName(values.customName);
    const rate = parseRateToMillimes(values.customRate, rateRange);
    if (!name.ok) errors.customSubject = { code: name.error };
    else if (!rate.ok) {
      (errors.rates ??= {}).custom = {
        code: rate.error,
        min: rateRange.min,
        max: rateRange.max,
      };
    } else subjects.push({ customName: name.value, rateMillimes: rate.value });
  }
  if (
    strict &&
    subjects.length === 0 &&
    !errors.subjects &&
    !errors.rates &&
    !errors.customSubject
  ) {
    errors.subjects = { code: 'subjectsRequired' };
  }

  // The photo file itself is checked by processProfilePhoto (bytes, not names).
  const file = formData.get('photo');
  const photoFile = file instanceof File && file.size > 0 ? file : null;
  const removePhoto = text(formData, 'removePhoto') === 'on';

  const failed = Object.keys(errors).length > 0;
  if (failed) return { ok: false, errors, values };

  return {
    ok: true,
    input: {
      fullName,
      diploma,
      experience,
      bio,
      governorateId,
      modes,
      levelIds,
      zoneIds,
      subjects,
    },
    photoFile,
    removePhoto,
    values,
  };
}
