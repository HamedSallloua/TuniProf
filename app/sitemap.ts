import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { getPool } from '@/lib/db/client';
import { getSitemapData } from '@/lib/marketplace/profile';
import { pageUrl } from '@/lib/site-url';

// Read from the database on every request: a profile that expires or is suspended leaves the
// sitemap at once, and the list never mentions a hidden profile (invariant 1).
export const dynamic = 'force-dynamic';

const STATIC_PAGES = [
  '/',
  '/recherche',
  '/devenir-professeur',
  '/comment-payer',
  '/contact',
];

function entry(
  path: string,
  extra: Pick<MetadataRoute.Sitemap[number], 'lastModified' | 'priority'> = {},
): MetadataRoute.Sitemap {
  // One entry per language, each pointing at the other one (hreflang).
  const languages = Object.fromEntries(
    routing.locales.map((locale) => [locale, pageUrl(locale, path)]),
  );
  return routing.locales.map((locale) => ({
    url: pageUrl(locale, path),
    alternates: { languages },
    ...extra,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await getSitemapData(getPool());
  return [
    ...STATIC_PAGES.flatMap((path) =>
      entry(path, { priority: path === '/' ? 1 : 0.6 }),
    ),
    ...data.landings.flatMap((l) =>
      entry(`/${l.governorate}/${l.subject}`, { priority: 0.8 }),
    ),
    ...data.profiles.flatMap((p) =>
      entry(`/prof/${p.slug}`, { lastModified: p.updatedAt, priority: 0.7 }),
    ),
  ];
}
