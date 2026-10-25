import { cookies } from 'next/headers';
import { cache } from 'react';
import { getPool } from '@/lib/db/client';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { SESSION_COOKIE, SESSION_TTL_MS } from './config';
import { can, type Permission } from './permissions';
import { getSessionUser, type SessionUser } from './session';

/** The signed-in user of this request, or null. Looked up once per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(getPool(), token);
});

/**
 * Use at the top of a protected page: sends visitors to the login page, and signed-in
 * people who lack the permission back to the home page.
 */
export async function requirePermission(
  permission: Permission,
  locale: Locale,
): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect({ href: '/connexion', locale });
  else if (!can(user.role, permission)) redirect({ href: '/', locale });
  return user as SessionUser;
}

export async function setSessionCookie(
  token: string,
  role: SessionUser['role'],
) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS[role] / 1000),
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
