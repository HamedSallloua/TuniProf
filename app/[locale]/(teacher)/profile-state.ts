import type { ProfileFieldErrors, ProfileFormValues } from '@/lib/profile/form';

// What the profile form action gives back to the page.
export type ProfileFormState = null | {
  /** A message to show at the top: a key of profile.notices or profile.errors. */
  notice?: {
    kind: 'success' | 'error';
    code: string;
    group: 'notices' | 'errors';
  };
  fieldErrors?: ProfileFieldErrors;
  /** What was typed, to show the form again after an error. */
  values?: ProfileFormValues;
  /** Changes every successful save, so the form reloads with the saved data. */
  savedAt?: number;
};
