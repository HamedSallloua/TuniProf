'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDeviceContext } from '@/lib/auth/device';
import { can } from '@/lib/auth/permissions';
import { getPool } from '@/lib/db/client';
import type { TeacherReviewState } from '@/lib/reviews/action-state';
import { replyToReview, reportReview } from '@/lib/reviews/repo';

// Answer and report, from the teacher's "Mes avis" page. The teacher's id comes from the
// session, never from the form: a teacher can only act on the reviews of their own profile.

const reviewIdSchema = z.string().uuid();

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

async function currentTeacher() {
  const user = await getCurrentUser();
  return user && can(user.role, 'teacher:space') ? user : null;
}

export async function replyAction(
  _previous: TeacherReviewState,
  formData: FormData,
): Promise<TeacherReviewState> {
  const teacher = await currentTeacher();
  const reviewId = reviewIdSchema.safeParse(text(formData, 'reviewId'));
  if (!teacher || !reviewId.success) return { error: 'not_found' };

  const result = await replyToReview(
    getPool(),
    teacher.id,
    reviewId.data,
    text(formData, 'reply'),
  );
  if (!result.ok) return { error: result.reason };
  revalidatePath('/', 'layout');
  return { done: true };
}

export async function reportReviewAction(
  _previous: TeacherReviewState,
  formData: FormData,
): Promise<TeacherReviewState> {
  const teacher = await currentTeacher();
  const reviewId = reviewIdSchema.safeParse(text(formData, 'reviewId'));
  const device = await getDeviceContext({ create: true });
  if (!teacher || !reviewId.success || !device) return { error: 'not_found' };

  const result = await reportReview(getPool(), {
    teacherId: teacher.id,
    reviewId: reviewId.data,
    reason: text(formData, 'reason'),
    note: text(formData, 'note'),
    device,
  });
  if (!result.ok) return { error: result.reason };
  revalidatePath('/', 'layout');
  return { done: true };
}
