import { describe, expect, it } from 'vitest';
import { slugify } from '@/lib/slug';

describe('slugify', () => {
  it('removes accents and lowercases', () => {
    expect(slugify('Béja')).toBe('beja');
    expect(slugify('Gabès')).toBe('gabes');
    expect(slugify('Économie')).toBe('economie');
  });

  it('replaces spaces, slashes and apostrophes with single dashes', () => {
    expect(slugify('Ben Arous')).toBe('ben-arous');
    expect(slugify("M'saken")).toBe('m-saken');
    expect(slugify('Gestion/Comptabilité')).toBe('gestion-comptabilite');
    expect(slugify('  Sidi   Bou  Said ')).toBe('sidi-bou-said');
  });

  it('gives an empty string for Arabic-only text', () => {
    expect(slugify('تونس')).toBe('');
  });
});
