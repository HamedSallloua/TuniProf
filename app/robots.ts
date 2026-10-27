import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/env';

// Crawlers may read the public pages; the private areas are kept out (they are also noindex).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/ar/admin',
        '/espace-professeur',
        '/ar/espace-professeur',
        '/api/',
        '/media/',
      ],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
