import { describe, expect, it } from 'vitest';
import { getDirection, routing } from '@/i18n/routing';

describe('language routing', () => {
  it('has French (default) and Arabic', () => {
    expect([...routing.locales]).toEqual(['fr', 'ar']);
    expect(routing.defaultLocale).toBe('fr');
  });

  it('hides the prefix for the default language only', () => {
    expect(routing.localePrefix).toBe('as-needed');
  });

  it('writes Arabic right-to-left and French left-to-right', () => {
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('fr')).toBe('ltr');
  });
});
