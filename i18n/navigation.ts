import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Use these instead of the ones from next/link and next/navigation:
// they add the language prefix to URLs for you.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
