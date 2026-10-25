import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  passwordSchema,
  verifyAgainstDummy,
  verifyPassword,
} from '@/lib/auth/password';

describe('password hashing', () => {
  it('uses argon2id with the chosen settings, and a new salt each time', async () => {
    const first = await hashPassword('correct horse battery');
    const second = await hashPassword('correct horse battery');
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('correct horse');
  });

  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong horse battery')).toBe(false);
  });

  it('treats a damaged hash as a wrong password, not as a crash', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });

  it('the dummy check never succeeds', async () => {
    expect(await verifyAgainstDummy('anything')).toBe(false);
  });
});

describe('password rules', () => {
  const schema = passwordSchema('+21622345678');

  it('accepts 8 to 128 characters', () => {
    expect(schema.safeParse('12345678a').success).toBe(true);
    expect(schema.safeParse('a'.repeat(128)).success).toBe(true);
  });

  it('refuses a short or a very long password', () => {
    expect(schema.safeParse('short').success).toBe(false);
    expect(schema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('refuses a password that contains the phone number', () => {
    expect(schema.safeParse('22345678').success).toBe(false);
    expect(schema.safeParse('abc22345678').success).toBe(false);
    expect(schema.safeParse('22 345 678 x').success).toBe(false);
  });
});
