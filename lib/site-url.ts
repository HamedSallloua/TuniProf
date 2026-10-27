import { getSiteUrl } from '@/lib/env';
import { routing, type Locale } from '@/i18n/routing';

// Absolute addresses for canonical links, alternate languages and the sitemap.
// French has no prefix, Arabic lives under /ar (owner decision, see i18n/routing.ts).

/** pageUrl('ar', '/prof/x') -> "https://tuniprof.tn/ar/prof/x"; the home page is path "/". */
export function pageUrl(locale: Locale | string, path: string): string {
  const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;
  const tail = path === '/' ? '' : path;
  return `${getSiteUrl()}${prefix}${tail}`;
}

/** The `alternates` of a page: its canonical address and its twin in the other language. */
export function alternatesFor(locale: Locale | string, path: string) {
  return {
    canonical: pageUrl(locale, path),
    languages: {
      fr: pageUrl('fr', path),
      ar: pageUrl('ar', path),
      'x-default': pageUrl('fr', path),
    },
  };
}
