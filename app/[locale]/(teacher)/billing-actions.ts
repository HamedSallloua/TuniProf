'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getCurrentUser } from '@/lib/auth/current-user';
import { can } from '@/lib/auth/permissions';
import { redeemCode } from '@/lib/billing/codes';
import { getEntitlements } from '@/lib/billing/entitlements';
import {
  cancelPaymentRequest,
  createPaymentRequest,
  createUpgradeRequest,
} from '@/lib/billing/payments';
import { getPool } from '@/lib/db/client';

// Server actions of the subscription pages. They only use the signed-in teacher's id.

export type BillingFormState = null | {
  /** A key of subscription.errors, or subscription.code.errors for the code form. */
  error?: string;
  group?: 'errors' | 'code';
  retryMinutes?: number;
  /** The code form worked: the new end of visibility, or "credit" when it waits for approval. */
  success?: { kind: 'now' | 'credit'; until?: string };
};

async function currentTeacher() {
  const locale = (await getLocale()) as Locale;
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'teacher:space'))
    redirect({ href: '/connexion', locale });
  return { user: user!, locale };
}

const planRequestSchema = z.object({
  planId: z.string().uuid(),
  method: z.string().min(1).max(20),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** "Créer ma demande de paiement". */
export async function createRequestAction(
  _previous: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const { user, locale } = await currentTeacher();
  const parsed = planRequestSchema.safeParse({
    planId: text(formData, 'planId'),
    method: text(formData, 'method'),
  });
  if (!parsed.success) return { error: 'invalid_plan', group: 'errors' };

  const result = await createPaymentRequest(getPool(), user.id, {
    planId: parsed.data.planId,
    withDashboard: text(formData, 'withDashboard') === 'on',
    method: parsed.data.method,
  });
  if (!result.ok) return { error: result.reason, group: 'errors' };

  revalidatePath('/', 'layout');
  return redirect({
    href: `/espace-professeur/abonnement/${result.request.reference}`,
    locale,
  });
}

/** "Demander l'ajout du Dashboard". */
export async function createUpgradeAction(
  _previous: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const { user, locale } = await currentTeacher();
  const result = await createUpgradeRequest(getPool(), user.id, {
    method: text(formData, 'method'),
  });
  if (!result.ok) return { error: result.reason, group: 'errors' };

  revalidatePath('/', 'layout');
  return redirect({
    href: `/espace-professeur/abonnement/${result.request.reference}`,
    locale,
  });
}

export async function cancelRequestAction(formData: FormData): Promise<void> {
  const { user, locale } = await currentTeacher();
  const id = z.string().uuid().safeParse(text(formData, 'requestId'));
  if (id.success) await cancelPaymentRequest(getPool(), user.id, id.data);
  revalidatePath('/', 'layout');
  return redirect({ href: '/espace-professeur/abonnement', locale });
}

/** "Activer": the teacher types the activation code. */
export async function redeemCodeAction(
  _previous: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const { user } = await currentTeacher();
  const pool = getPool();
  const result = await redeemCode(
    pool,
    user.id,
    text(formData, 'code').slice(0, 60),
  );

  if (!result.ok) {
    return {
      error: result.reason,
      group: 'code',
      retryMinutes:
        result.reason === 'locked'
          ? Math.max(1, Math.ceil(result.retryAfterMs / 60000))
          : undefined,
    };
  }

  revalidatePath('/', 'layout');
  if (result.credited) return { success: { kind: 'credit' } };
  const entitlements = await getEntitlements(pool, user.id);
  return {
    success: {
      kind: 'now',
      until: entitlements?.visibilityUntil?.toISOString(),
    },
  };
}
