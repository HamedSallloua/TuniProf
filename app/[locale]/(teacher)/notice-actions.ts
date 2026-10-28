'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import { getPool } from '@/lib/db/client';
import { markSiteNoticeRead } from '@/lib/notifications/deliver';

// "Marquer comme lu" on a notice of the teacher home. Only the signed-in teacher's own
// notices can be read: the id of the person comes from the session, never from the form.
export async function markNoticeReadAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!user || !can(user.role, 'teacher:space') || !id.success) return;
  await markSiteNoticeRead(getPool(), user.id, id.data);
  revalidatePath('/', 'layout');
}
