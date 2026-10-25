// Profile rules (spec 4.2). Pure functions: no database, no web. Used by the form
// validation on the server and by the tests. The database repeats the structural rules
// (lengths, lists, completeness); the content rules (bio, name) can only live here.

// ----------------------------------------------------------------------------- option lists

export const DIPLOMAS = [
  'primary_teacher', // Instituteur(trice)
  'middle_school_teacher', // Professeur du collège
  'high_school_teacher', // Professeur du secondaire
  'university_teacher', // Enseignant universitaire
  'student', // Étudiant (master / ingénieur / autre)
  'engineer_executive', // Ingénieur / cadre
  'other_graduate', // Autre diplômé
] as const;

export const EXPERIENCES = [
  'lt_1',
  '1_3',
  '3_5',
  '5_10',
  '10_15',
  'gt_15',
] as const;

export const MODES = ['at_home', 'at_teacher', 'online'] as const;

export type Diploma = (typeof DIPLOMAS)[number];
export type Experience = (typeof EXPERIENCES)[number];
export type Mode = (typeof MODES)[number];

export function isDiploma(value: string): value is Diploma {
  return (DIPLOMAS as readonly string[]).includes(value);
}
export function isExperience(value: string): value is Experience {
  return (EXPERIENCES as readonly string[]).includes(value);
}
export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

/** Reasons an admin can pick when refusing a profile or a change (spec 6: reason templates). */
export const REJECTION_REASONS = [
  'incomplete_info',
  'name_invalid',
  'photo_inappropriate',
  'bio_contact_info',
  'bio_unclear',
  'diploma_unclear',
  'rates_unrealistic',
  'other',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export function isRejectionReason(value: string): value is RejectionReason {
  return (REJECTION_REASONS as readonly string[]).includes(value);
}

// -------------------------------------------------------------------------------- text helpers

const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/** Single-line text: no control or invisible characters, spaces collapsed. */
export function cleanLine(value: string): string {
  return value
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Multi-line text (bio): line breaks kept (at most one blank line), the rest cleaned. */
export function cleanParagraphs(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(CONTROL_EXCEPT_NEWLINE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function westernDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// -------------------------------------------------------------------------------------- name

export type NameError = 'nameLength' | 'nameChars';

/** 2 to 60 characters: letters (Latin or Arabic), spaces, hyphens, apostrophes and dots. */
export function validateFullName(
  raw: string,
): { ok: true; value: string } | { ok: false; error: NameError } {
  const value = cleanLine(raw);
  const length = [...value].length;
  if (length < 2 || length > 60) return { ok: false, error: 'nameLength' };
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’ .\-]*$/u.test(value)) {
    return { ok: false, error: 'nameChars' };
  }
  return { ok: true, value };
}

// --------------------------------------------------------------------- contact details in text

export type ContactKind = 'phone' | 'link' | 'handle' | 'app';

const PHONE_RUN = /(?:\+|00)?\d(?:[\s.\-/()]*\d){7,}/g;
const YEAR_RANGE = /^(?:19|20)\d{2}(?:19|20)\d{2}$/;
const LINK = /(?:https?:\/\/|www\.)/i;
const DOMAIN =
  /(?<![\p{L}\d])[\p{L}\d-]+\.(?:com|net|org|tn|fr|info|me|io|co|app|link|ly|gl|ma|dz|eu|biz|xyz)(?![\p{L}\d])/iu;
const HANDLE = /@\s?[\p{L}\d_.]{2,}/u;
const APP_NAMES = new RegExp(
  '(?<![\\p{L}\\d])(?:' +
    [
      'whats?\\s?app',
      'watsap+',
      'facebook',
      'fb',
      'instagram',
      'insta',
      'telegram',
      'tiktok',
      'snapchat',
      'messenger',
      'viber',
      'واتساب',
      'واتس\\s?اب',
      'واتس',
      'فيسبوك',
      'فايسبوك',
      'انستغرام',
      'إنستغرام',
      'انستا',
      'تيك\\s?توك',
      'تلغرام',
      'تيليغرام',
      'سناب',
      'ماسنجر',
      'فايبر',
    ].join('|') +
    ')(?![\\p{L}\\d])',
  'iu',
);

/**
 * Contact details have no place in a bio: contact goes through the "Voir les coordonnées"
 * button only (spec 4.2). Returns what was found, or null.
 */
export function detectContactInfo(text: string): ContactKind | null {
  const value = westernDigits(text);

  for (const run of value.match(PHONE_RUN) ?? []) {
    const digits = run.replace(/\D/g, '');
    if (!YEAR_RANGE.test(digits)) return 'phone';
  }
  // Handles first, so an e-mail address (sarah@gmail.com) is reported as a handle, not a link.
  if (HANDLE.test(value)) return 'handle';
  if (LINK.test(value) || DOMAIN.test(value)) return 'link';
  if (APP_NAMES.test(value)) return 'app';
  return null;
}

// --------------------------------------------------------------------------------------- bio

export const BIO_MIN = 30;
export const BIO_MAX = 600;

export type BioError = 'bioTooShort' | 'bioTooLong' | 'bioContainsContact';

export function validateBio(
  raw: string,
):
  | { ok: true; value: string }
  | { ok: false; error: BioError; contact?: ContactKind } {
  const value = cleanParagraphs(raw);
  const length = [...value].length;
  if (length < BIO_MIN) return { ok: false, error: 'bioTooShort' };
  if (length > BIO_MAX) return { ok: false, error: 'bioTooLong' };
  const contact = detectContactInfo(value);
  if (contact) return { ok: false, error: 'bioContainsContact', contact };
  return { ok: true, value };
}

// ------------------------------------------------------------------ custom subject ("Autre")

export type SubjectNameError = 'subjectNameInvalid';

export function validateCustomSubjectName(
  raw: string,
): { ok: true; value: string } | { ok: false; error: SubjectNameError } {
  const value = cleanLine(raw);
  const length = [...value].length;
  if (
    length < 2 ||
    length > 40 ||
    !/^[\p{L}\p{M}][\p{L}\p{M}\d'’ .\-/&]*$/u.test(value) ||
    detectContactInfo(value)
  ) {
    return { ok: false, error: 'subjectNameInvalid' };
  }
  return { ok: true, value };
}

// ----------------------------------------------------------------------------------- hourly rates

export type RateError = 'rateInvalid' | 'rateOutOfRange';

/**
 * Reads a rate typed in DT ("25", "25.5", "25,500") and returns millimes (25.500 DT = 25500).
 * Up to 3 decimals. The allowed range comes from the settings (5 to 300 DT by default).
 */
export function parseRateToMillimes(
  raw: string,
  range: { min: number; max: number },
): { ok: true; value: number } | { ok: false; error: RateError } {
  const text = westernDigits(raw).trim().replace(',', '.').replace(/\s/g, '');
  const match = /^(\d{1,4})(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) return { ok: false, error: 'rateInvalid' };

  const millimes =
    Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  if (millimes < range.min || millimes > range.max) {
    return { ok: false, error: 'rateOutOfRange' };
  }
  return { ok: true, value: millimes };
}

/** 25500 -> "25.500" (shown back in the form, and used on cards). */
export function formatMillimesInput(millimes: number): string {
  const whole = Math.floor(millimes / 1000);
  const rest = millimes % 1000;
  return rest === 0
    ? String(whole)
    : `${whole}.${String(rest).padStart(3, '0').replace(/0+$/, '')}`;
}

// ----------------------------------------------------------------------------- completeness (UI)

export type ProfileSnapshot = {
  fullName: string | null;
  diploma: string | null;
  experience: string | null;
  bio: string | null;
  governorateId: string | null;
  modes: readonly string[];
  levelCount: number;
  subjectCount: number;
  zoneCount: number;
  phoneVerified: boolean;
};

export type MissingField =
  | 'fullName'
  | 'diploma'
  | 'experience'
  | 'bio'
  | 'governorate'
  | 'modes'
  | 'levels'
  | 'subjects'
  | 'zones';

/**
 * What is still missing, to guide the teacher. It mirrors the SQL function
 * profile_is_complete(): a test compares the two on many cases.
 */
export function listMissingFields(profile: ProfileSnapshot): MissingField[] {
  const missing: MissingField[] = [];
  if (!profile.fullName) missing.push('fullName');
  if (!profile.diploma) missing.push('diploma');
  if (!profile.experience) missing.push('experience');
  if (!profile.bio) missing.push('bio');
  if (!profile.governorateId) missing.push('governorate');
  if (profile.modes.length === 0) missing.push('modes');
  if (profile.levelCount === 0) missing.push('levels');
  if (profile.subjectCount === 0) missing.push('subjects');
  const onlineOnly =
    profile.modes.length === 1 && profile.modes[0] === 'online';
  if (!onlineOnly && profile.zoneCount === 0) missing.push('zones');
  return missing;
}

export function isProfileComplete(profile: ProfileSnapshot): boolean {
  return profile.phoneVerified && listMissingFields(profile).length === 0;
}
