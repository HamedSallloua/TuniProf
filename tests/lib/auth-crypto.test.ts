import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  deriveVerificationCode,
  extractVerificationCode,
  hashVerificationCode,
  hmac,
  randomToken,
  safeEqual,
  sha256,
} from '@/lib/auth/crypto';

describe('code alphabet (spec 2.4)', () => {
  it('has 32 distinct characters and none of 0, O, 1, I', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const forbidden of ['0', 'O', '1', 'I']) {
      expect(CODE_ALPHABET).not.toContain(forbidden);
    }
  });
});

describe('verification code', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('looks like TTP-XXXX with the safe alphabet', () => {
    expect(deriveVerificationCode(id)).toMatch(/^TTP-[A-HJ-NP-Z2-9]{4}$/);
  });

  it('is the same for the same challenge and different for another', () => {
    expect(deriveVerificationCode(id)).toBe(deriveVerificationCode(id));
    const other = '99999999-2222-3333-4444-555555555555';
    expect(deriveVerificationCode(other)).not.toBe(deriveVerificationCode(id));
  });

  it('is stored as a hash that does not contain the code', () => {
    const code = deriveVerificationCode(id);
    const hash = hashVerificationCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(code);
    expect(hashVerificationCode(code.toLowerCase())).toBe(hash);
  });
});

describe('extractVerificationCode', () => {
  it.each([
    ['TTP-7KQ2', 'TTP-7KQ2'],
    ['ttp-7kq2', 'TTP-7KQ2'],
    ['Vérification TuniProf : TTP-7KQ2', 'TTP-7KQ2'],
    ['التحقق من TuniProf: TTP-7KQ2', 'TTP-7KQ2'],
    ['hello TTP-7KQ2.', 'TTP-7KQ2'],
    ['TTP-7KQ2\nmerci', 'TTP-7KQ2'],
  ])('finds the code in %j', (text, expected) => {
    expect(extractVerificationCode(text)).toBe(expected);
  });

  it.each([
    'bonjour',
    '',
    'TTP-7KQ', // too short
    'TTP-0000', // 0 is not in the alphabet
    'TTP-7KQ2X', // too long
    'XTTP-7KQ2', // not at a word start
  ])('finds nothing in %j', (text) => {
    expect(extractVerificationCode(text)).toBeNull();
  });

  it('never mistakes an activation code for a verification code', () => {
    expect(extractVerificationCode('TTP-ABCD-EFGH-JKLM')).toBeNull();
  });
});

describe('hashing helpers', () => {
  it('hmac depends on its purpose', () => {
    expect(hmac('device', 'x')).not.toBe(hmac('ip', 'x'));
    expect(hmac('device', 'x')).toBe(hmac('device', 'x'));
  });

  it('sha256 and random tokens', () => {
    expect(sha256('abc')).toHaveLength(64);
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken().length).toBeGreaterThanOrEqual(43); // 256 bits in base64url
  });

  it('safeEqual compares values of any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
