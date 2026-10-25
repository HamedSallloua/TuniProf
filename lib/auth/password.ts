import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './config';

// argon2id with the OWASP minimum settings (19 MiB of memory, 2 passes, 1 thread).
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id (the library's enum cannot be imported with isolatedModules)
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A real hash of a random password: when the phone number is unknown, we still verify
// against it, so a login takes the same time whether the account exists or not.
let dummyHash: Promise<string> | undefined;
export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('not-the-password-of-anyone');
  return dummyHash.then((h) => verifyPassword(h, password));
}

/** Password rules: 8 to 128 characters, and not just the phone number. */
export function passwordSchema(phoneE164?: string) {
  return z
    .string()
    .min(PASSWORD_MIN_LENGTH, 'passwordTooShort')
    .max(PASSWORD_MAX_LENGTH, 'passwordTooLong')
    .refine(
      (value) =>
        !phoneE164 || !value.replace(/\D/g, '').endsWith(phoneE164.slice(4)),
      'passwordContainsPhone',
    );
}
