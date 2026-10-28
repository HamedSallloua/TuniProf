import { describe, expect, it } from 'vitest';
import {
  digitsOnly,
  matchesWordStart,
  normalizeSearch,
} from '@/lib/text/normalize';

describe('normalizing text for searches', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(normalizeSearch('  Élève   Mohamed ')).toBe('eleve mohamed');
    expect(normalizeSearch('Mathématiques 4ème')).toBe('mathematiques 4eme');
    expect(normalizeSearch('ÇA va')).toBe('ca va');
  });

  it('ignores Arabic diacritics, tatweel and the forms of alef and yeh', () => {
    expect(normalizeSearch('مُحَمَّد')).toBe('محمد');
    expect(normalizeSearch('أحمد')).toBe(normalizeSearch('احمد'));
    expect(normalizeSearch('إيمان')).toBe(normalizeSearch('ايمان'));
    expect(normalizeSearch('مصطفى')).toBe(normalizeSearch('مصطفي'));
    expect(normalizeSearch('محـمد')).toBe('محمد');
  });

  it('keeps only the digits of a phone number, Arabic digits included', () => {
    expect(digitsOnly('+216 22 345 678')).toBe('21622345678');
    expect(digitsOnly('٢٢ ٣٤٥ ٦٧٨')).toBe('22345678');
    expect(digitsOnly('abc')).toBe('');
  });

  it('matches every typed word against the start of a word', () => {
    expect(matchesWordStart('Mo', 'Mohamed Ben Ali')).toBe(true);
    expect(matchesWordStart('mo ali', 'Mohamed Ben Ali')).toBe(true);
    expect(matchesWordStart('ali mo', 'Mohamed Ben Ali')).toBe(true);
    expect(matchesWordStart('sa', 'Sarah')).toBe(true);
    expect(matchesWordStart('ham', 'Mohamed')).toBe(false);
    expect(matchesWordStart('mo zz', 'Mohamed')).toBe(false);
    expect(matchesWordStart('', 'Mohamed')).toBe(false);
    expect(matchesWordStart('eleve', 'Élève')).toBe(true);
    expect(matchesWordStart('محمد', 'مُحَمَّد علي')).toBe(true);
  });
});
