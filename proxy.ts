import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Adds or detects the language in the URL (see i18n/routing.ts).
export default createMiddleware(routing);

export const config = {
  // Skip API routes, /healthz, Next.js internals and any file with a dot (images, fonts...).
  matcher: ['/((?!api|healthz|_next|_vercel|.*\\..*).*)'],
};
