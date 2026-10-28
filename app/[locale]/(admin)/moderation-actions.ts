'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import { getPool } from '@/lib/db/client';
import { MODERATION_ACTIONS, moderateReview } from '@/lib/reviews/moderation';

// Buttons of the review moderation page. The admin is checked here and again in the database
// (lib/reviews/moderation.ts), which also writes the audit log.

const schema = z.object({
  reviewId: z.string().uuid(),
  action: z.enum(MODERATION_ACTIONS),
});

export async function moderateReviewAction(formData: FormData): Promise<void> {
  const locale = (await getLocale()) as Locale;
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'admin:panel'))
    return redirect({ href: '/connexion', locale });

  const parsed = schema.safeParse({
    reviewId: formData.get('reviewId'),
    action: formData.get('action'),
  });
  if (!parsed.success)
    return redirect({
      href: { pathname: '/admin/avis', query: { error: 'not_found' } },
      locale,
    });

  const result = await moderateReview(
    getPool(),
    user.id,
    parsed.data.reviewId,
    parsed.data.action,
  );
  revalidatePath('/', 'layout');
  return redirect({
    href: {
      pathname: '/admin/avis',
      query: result.ok
        ? { done: parsed.data.action }
        : { error: result.reason },
    },
    locale,
  });
}
