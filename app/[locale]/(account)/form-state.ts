import type { FieldName } from '@/lib/auth/schemas';

// What a form action gives back to its page when something is wrong.
// Messages are keys of auth.errors (messages/fr.json and ar.json).
export type FormState = null | {
  error?: string;
  fieldErrors?: Partial<Record<FieldName, string>>;
  // Values shown again in the form. Passwords are never sent back.
  values?: {
    phone?: string;
    email?: string;
    terms?: boolean;
    phoneConsent?: boolean;
  };
  retryMinutes?: number;
};
