'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import { getPool } from '@/lib/db/client';
import { getRateRange } from '@/lib/profile/catalogue';
import { parseProfileForm } from '@/lib/profile/form';
import { processProfilePhoto } from '@/lib/profile/photo';
import {
  getOrCreateProfile,
  saveProfile,
  setListed,
  submitProfile,
  type ProfileInput,
} from '@/lib/profile/repo';
import { getStorage } from '@/lib/storage';
import type { ProfileFormState } from './profile-state';

// Server actions of the teacher space. They only ever use the teacher id of the signed-in
// session (never an id sent by the browser), and call the tested functions of lib/profile.

async function currentTeacher() {
  const locale = (await getLocale()) as Locale;
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'teacher:space'))
    redirect({ href: '/connexion', locale });
  return { user: user!, locale };
}

/** Deleting a file that is no longer used must never break the save that made it unused. */
async function deleteFiles(keys: string[]) {
  for (const key of keys) {
    try {
      await getStorage().delete(key);
    } catch (error) {
      console.error('could not delete unused photo:', (error as Error).message);
    }
  }
}

/** "Enregistrer" and "Envoyer pour vérification" of the profile form. */
export async function saveProfileAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const { user, locale } = await currentTeacher();
  const pool = getPool();

  const intent = String(formData.get('intent') ?? 'draft');
  const profile = await getOrCreateProfile(pool, user.id);
  if (profile.status === 'suspended') {
    return { notice: { kind: 'error', code: 'suspended', group: 'errors' } };
  }

  // Submitting, and any edit of an approved profile, need every required field.
  const strict = intent === 'submit' || profile.status === 'approved';
  const parsed = parseProfileForm(formData, {
    strict,
    rateRange: await getRateRange(pool),
  });
  if (!parsed.ok) {
    return {
      notice: { kind: 'error', code: 'fixErrors', group: 'notices' },
      fieldErrors: parsed.errors,
      values: parsed.values,
    };
  }

  // The photo: checked by its bytes, re-encoded, then stored under a new random name.
  let photo: ProfileInput['photo'] = parsed.removePhoto
    ? { action: 'remove' }
    : { action: 'keep' };
  let newPhotoKey: string | null = null;
  if (parsed.photoFile) {
    const processed = await processProfilePhoto(
      Buffer.from(await parsed.photoFile.arrayBuffer()),
    );
    if (!processed.ok) {
      return {
        notice: { kind: 'error', code: 'fixErrors', group: 'notices' },
        fieldErrors: { photo: { code: processed.error } },
        values: parsed.values,
      };
    }
    await getStorage().put(processed.key, processed.data, 'image/jpeg');
    newPhotoKey = processed.key;
    photo = { action: 'replace', key: processed.key };
  }

  const saved = await saveProfile(
    pool,
    user.id,
    { ...parsed.input, photo },
    { strict },
  );
  if (!saved.ok) {
    if (newPhotoKey) await deleteFiles([newPhotoKey]); // the save was undone: drop the new file
    return {
      notice: { kind: 'error', code: saved.error, group: 'errors' },
      values: parsed.values,
    };
  }
  await deleteFiles(saved.unusedPhotoKeys);

  if (intent === 'submit') {
    const submitted = await submitProfile(pool, user.id);
    if (!submitted.ok) {
      return {
        notice: { kind: 'error', code: submitted.error, group: 'errors' },
        values: parsed.values,
      };
    }
    revalidatePath('/', 'layout');
    return redirect({
      href: { pathname: '/espace-professeur', query: { submitted: '1' } },
      locale,
    });
  }

  revalidatePath('/', 'layout');
  const waiting =
    saved.profile.status === 'approved' &&
    saved.profile.pendingVersion !== null;
  return {
    notice: {
      kind: 'success',
      code: waiting ? 'savedWithVersion' : 'saved',
      group: 'notices',
    },
    savedAt: Date.now(),
  };
}

/** The teacher pauses or resumes the public listing (spec 2.3). */
export async function toggleListingAction(formData: FormData): Promise<void> {
  const { user } = await currentTeacher();
  await setListed(
    getPool(),
    user.id,
    String(formData.get('listed')) === 'true',
  );
  revalidatePath('/', 'layout');
}
