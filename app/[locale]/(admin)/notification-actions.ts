'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import { getPool } from '@/lib/db/client';
import { markWhatsAppSent } from '@/lib/notifications/deliver';

// "Marquer comme envoyé" on the WhatsApp queue. The admin is checked here and again in the
// database (lib/notifications/deliver.ts).

export async function markWhatsAppSentAction(
  formData: FormData,
): Promise<void> {
  const locale = (await getLocale()) as Locale;
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'admin:panel'))
    return redirect({ href: '/connexion', locale });

  const id = z.string().uuid().safeParse(formData.get('id'));
  const result = id.success
    ? await markWhatsAppSent(getPool(), user.id, id.data)
    : 'not_found';
  revalidatePath('/', 'layout');
  return redirect({
    href: {
      pathname: '/admin/messages',
      query: {
        [result === 'ok' ? 'done' : 'error']: result === 'ok' ? 'sent' : result,
      },
    },
    locale,
  });
}
