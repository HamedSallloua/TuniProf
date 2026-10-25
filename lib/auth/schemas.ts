import { z } from 'zod';
import { normalizePhone } from '@/lib/phone';
import { passwordSchema } from './password';

// Every form is validated on the server with these schemas. Error messages are keys of
// auth.errors in messages/*.json, so the page can show them in French or Arabic.

export type FieldName =
  'phone' | 'password' | 'confirmPassword' | 'email' | 'terms' | 'phoneConsent';

const phone = z
  .string()
  .refine((value) => normalizePhone(value) !== null, 'invalidPhone')
  .transform((value) => normalizePhone(value) as string);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) =>
      value === '' ||
      (value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)),
    'invalidEmail',
  )
  .transform((value) => (value === '' ? null : value));

// A checkbox sends "on" when ticked and nothing when not.
const ticked = (key: string) => z.literal('on', key);

export const signUpSchema = z
  .object({
    phone,
    password: z.string(),
    confirmPassword: z.string(),
    email,
    terms: ticked('termsRequired'),
    phoneConsent: ticked('phoneConsentRequired'),
  })
  .superRefine((value, context) => {
    const checked = passwordSchema(value.phone).safeParse(value.password);
    if (!checked.success) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: checked.error.issues[0].message,
      });
    } else if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'passwordMismatch',
      });
    }
  });

export const loginSchema = z.object({
  phone,
  // No rules here: a wrong password is just "incorrect", never a hint about the rules.
  password: z.string().max(1000),
});

export const phoneOnlySchema = z.object({ phone });

export const newPasswordSchema = z
  .object({
    challenge: z.string().uuid(),
    password: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((value, context) => {
    const checked = passwordSchema().safeParse(value.password);
    if (!checked.success) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: checked.error.issues[0].message,
      });
    } else if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'passwordMismatch',
      });
    }
  });

export const challengeIdSchema = z.object({ challenge: z.string().uuid() });

/** Reads the named fields of a form as plain strings (missing field = empty string). */
export function formValues(formData: FormData, names: string[]) {
  return Object.fromEntries(
    names.map((name) => [name, String(formData.get(name) ?? '')]),
  );
}

/** First error message of each field, ready to be shown. */
export function fieldErrors(
  error: z.ZodError,
): Partial<Record<FieldName, string>> {
  const result: Partial<Record<FieldName, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as FieldName | undefined;
    if (field && !(field in result)) result[field] = issue.message;
  }
  return result;
}
