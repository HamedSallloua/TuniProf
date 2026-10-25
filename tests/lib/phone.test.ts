import { describe, expect, it } from 'vitest';
import {
  formatNationalPhone,
  fromWhatsAppNumber,
  isValidE164,
  normalizePhone,
} from '@/lib/phone';

describe('normalizePhone', () => {
  it.each([
    ['22345678', '+21622345678'],
    ['22 345 678', '+21622345678'],
    ['+216 22 345 678', '+21622345678'],
    ['+21622345678', '+21622345678'],
    ['0021622345678', '+21622345678'],
    ['00216 22-345-678', '+21622345678'],
    ['216 22345678', '+21622345678'],
    ['(216) 22.345.678', '+21622345678'],
  ])('accepts %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('accepts the four allowed first digits: 2, 4, 5 and 9', () => {
    for (const first of ['2', '4', '5', '9']) {
      expect(normalizePhone(`${first}1234567`)).toBe(`+216${first}1234567`);
    }
  });

  it('refuses the other first digits', () => {
    for (const first of ['0', '1', '3', '6', '7', '8']) {
      expect(normalizePhone(`${first}1234567`)).toBeNull();
    }
  });

  it('accepts Arabic-Indic and Persian digits', () => {
    expect(normalizePhone('٢٢٣٤٥٦٧٨')).toBe('+21622345678');
    expect(normalizePhone('۲۲۳۴۵۶۷۸')).toBe('+21622345678');
  });

  it.each([
    '',
    '2234567', // 7 digits
    '223456789', // 9 digits
    '+33612345678', // another country
    '+2162234567', // too short
    '+216223456789', // too long
    'abcdefgh',
    '22 345 67x',
  ])('refuses %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('phone helpers', () => {
  it('validates E.164', () => {
    expect(isValidE164('+21622345678')).toBe(true);
    expect(isValidE164('21622345678')).toBe(false);
    expect(isValidE164('+21612345678')).toBe(false);
  });

  it('formats for screens', () => {
    expect(formatNationalPhone('+21622345678')).toBe('22 345 678');
  });

  it('reads the number format WhatsApp uses (no plus sign)', () => {
    expect(fromWhatsAppNumber('21622345678')).toBe('+21622345678');
    expect(fromWhatsAppNumber('33612345678')).toBeNull();
  });
});
