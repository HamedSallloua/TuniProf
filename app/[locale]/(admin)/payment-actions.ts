'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import { issueCode, revokeCode } from '@/lib/billing/codes';
import {
  markProofReceived,
  rejectPaymentRequest,
} from '@/lib/billing/payments';
import { getPool } from '@/lib/db/client';

// Server actions of the payments screens. Each one checks the signed-in admin, validates the
// input, calls a tested function of lib/billing (which checks the admin again in the database
// and writes the audit log), then returns to the request page with a message.

const idSchema = z.string().uuid();

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

async function target(formData: FormData) {
  const { admin, locale } = await currentAdmin();
  const id = idSchema.safeParse(text(formData, 'requestId'));
  if (!id.success) redirect({ href: '/admin/paiements', locale });
  return { admin, locale, requestId: id.data! };
}

function back(
  locale: Locale,
  requestId: string,
  outcome: { flash: string } | { error: string },
): never {
  revalidatePath('/', 'layout');
  return redirect({
    href: { pathname: `/admin/paiements/${requestId}`, query: outcome },
    locale,
  });
}

export async function markProofAction(formData: FormData): Promise<void> {
  const { admin, locale, requestId } = await target(formData);
  const result = await markProofReceived(getPool(), admin.id, requestId);
  return back(
    locale,
    requestId,
    result.ok ? { flash: 'proof' } : { error: result.reason },
  );
}

export async function issueCodeAction(formData: FormData): Promise<void> {
  const { admin, locale, requestId } = await target(formData);
  const result = await issueCode(getPool(), admin.id, requestId, {
    transactionRef: text(formData, 'transactionRef'),
    transactionDate: text(formData, 'transactionDate'),
    note: text(formData, 'note').trim() || null,
  });
  return back(
    locale,
    requestId,
    result.ok ? { flash: 'issued' } : { error: result.reason },
  );
}

export async function rejectRequestAction(formData: FormData): Promise<void> {
  const { admin, locale, requestId } = await target(formData);
  const result = await rejectPaymentRequest(
    getPool(),
    admin.id,
    requestId,
    text(formData, 'note'),
  );
  return back(
    locale,
    requestId,
    result.ok ? { flash: 'rejected' } : { error: result.reason },
  );
}

export async function revokeCodeAction(formData: FormData): Promise<void> {
  const { admin, locale, requestId } = await target(formData);
  const result = await revokeCode(
    getPool(),
    admin.id,
    requestId,
    text(formData, 'reason'),
  );
  return back(
    locale,
    requestId,
    result.ok ? { flash: 'revoked' } : { error: result.reason },
  );
}
