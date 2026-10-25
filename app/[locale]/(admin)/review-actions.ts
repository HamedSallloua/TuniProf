'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import { getPool } from '@/lib/db/client';
import {
  approveProfile,
  approveVersion,
  rejectProfile,
  rejectVersion,
  restoreProfile,
  suspendProfile,
  type ReviewFailure,
} from '@/lib/profile/review';
import { getStorage } from '@/lib/storage';

// Server actions of the review queue. Each one: checks the signed-in admin, validates the
// input, calls a tested function of lib/profile/review.ts (which checks the admin again in
// the database and writes the audit log), then goes back to a page with a message.

const userIdSchema = z.string().uuid();

async function currentAdmin() {
  const locale = (await getLocale()) as Locale;
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'admin:panel'))
    redirect({ href: '/connexion', locale });
  return { admin: user!, locale };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

async function deleteFiles(keys: string[]) {
  for (const key of keys) {
    try {
      await getStorage().delete(key);
    } catch (error) {
      console.error('could not delete unused photo:', (error as Error).message);
    }
  }
}

/** Back to the profile with a success message, or an error code to show. */
function backTo(
  locale: Locale,
  userId: string,
  outcome: { flash: string } | { error: ReviewFailure },
): never {
  const query =
    'flash' in outcome ? { flash: outcome.flash } : { error: outcome.error };
  revalidatePath('/', 'layout');
  return redirect({
    href: { pathname: `/admin/profils/${userId}`, query },
    locale,
  });
}

function backToQueue(locale: Locale, flash: string): never {
  revalidatePath('/', 'layout');
  return redirect({
    href: { pathname: '/admin/profils', query: { flash } },
    locale,
  });
}

/** Reads the user id of the form; anything else sends the admin back to the list. */
async function target(formData: FormData) {
  const { admin, locale } = await currentAdmin();
  const parsed = userIdSchema.safeParse(text(formData, 'userId'));
  if (!parsed.success) redirect({ href: '/admin/profils', locale });
  return { admin, locale, userId: parsed.data! };
}

export async function approveProfileAction(formData: FormData): Promise<void> {
  const { admin, locale, userId } = await target(formData);
  const result = await approveProfile(getPool(), admin.id, userId);
  if (!result.ok) return backTo(locale, userId, { error: result.reason });
  return backToQueue(locale, 'approved');
}

export async function rejectProfileAction(formData: FormData): Promise<void> {
  const { admin, locale, userId } = await target(formData);
  const result = await rejectProfile(getPool(), admin.id, userId, {
    reason: text(formData, 'reason'),
    note: text(formData, 'note'),
  });
  if (!result.ok) return backTo(locale, userId, { error: result.reason });
  return backToQueue(locale, 'rejected');
}

export async function approveVersionAction(formData: FormData): Promise<void> {
  const { admin, locale, userId } = await target(formData);
  const result = await approveVersion(getPool(), admin.id, userId);
  if (!result.ok) return backTo(locale, userId, { error: result.reason });
  await deleteFiles(result.unusedPhotoKeys);
  return backToQueue(locale, 'versionApproved');
}

export async function rejectVersionAction(formData: FormData): Promise<void> {
  const { admin, locale, userId } = await target(formData);
  const result = await rejectVersion(getPool(), admin.id, userId, {
    reason: text(formData, 'reason'),
    note: text(formData, 'note'),
  });
  if (!result.ok) return backTo(locale, userId, { error: result.reason });
  await deleteFiles(result.unusedPhotoKeys);
  return backToQueue(locale, 'versionRejected');
}

export async function suspendProfileAction(formData: FormData): Promise<void> {
  const { admin, locale, userId } = await target(formData);
  const result = await suspendProfile(
    getPool(),
    admin.id,
    userId,
    text(formData, 'reason'),
  );
  if (!result.ok) return backTo(locale, userId, { error: result.reason });
  return backTo(locale, userId, { flash: 'suspended' });
}

export async function restoreProfileAction(formData: FormData): Promise<void> {
  const { admin, locale, userId } = await target(formData);
  const result = await restoreProfile(getPool(), admin.id, userId);
  if (!result.ok) return backTo(locale, userId, { error: result.reason });
  return backTo(locale, userId, { flash: 'restored' });
}
