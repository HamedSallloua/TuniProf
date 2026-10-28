'use server';

import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import { getPool } from '@/lib/db/client';
import type { ReviewFormState } from '@/lib/reviews/action-state';
import { submitReview } from '@/lib/reviews/repo';

// "Envoyer mon avis" on a teacher's profile page. Only the signed-in reviewer's own id is
// used; the rules (one per teacher, 3 per day, visible profile only) are in lib/reviews and
// in the database.

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function submitReviewAction(
  _previous: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const slug = text(formData, 'slug');
  if (!SLUG.test(slug) || slug.length > 120) return { error: 'not_found' };

  const user = await getCurrentUser();
  if (!user || !can(user.role, 'review:create')) return { error: 'forbidden' };

  const result = await submitReview(getPool(), {
    authorId: user.id,
    slug,
    rating: text(formData, 'rating'),
    comment: text(formData, 'comment'),
  });
  return result.ok ? { sent: true } : { error: result.reason };
}
