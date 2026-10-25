import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Needed for a translated 404 page when the root layout lives under [locale].
    // See app/global-not-found.tsx and docs/DECISIONS.md.
    globalNotFound: true,
    // A profile photo is up to 2 MB (spec 4.2); the default limit for a form is 1 MB.
    serverActions: { bodySizeLimit: '3mb' },
  },
  // Browsers request /favicon.ico by themselves. Until the real logo arrives,
  // point them to the placeholder SVG icon (app/icon.svg).
  async redirects() {
    return [
      { source: '/favicon.ico', destination: '/icon.svg', permanent: false },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default withNextIntl(nextConfig);
