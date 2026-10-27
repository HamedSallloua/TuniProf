'use server';

import { headers } from 'next/headers';
import { getDeviceContext } from '@/lib/auth/device';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db/client';
import type { ReportState, RevealState } from '@/lib/marketplace/action-state';
import { reportProfile } from '@/lib/marketplace/reports';
import { revealContact } from '@/lib/marketplace/reveal';

// Server actions of the public profile page: "Voir les coordonnées" and "Signaler ce profil".
// A visitor has no account, so the anonymous device cookie is created here when missing.

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

async function remoteIp(): Promise<string | null> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip');
}

export async function revealAction(
  _previous: RevealState,
  formData: FormData,
): Promise<RevealState> {
  const slug = text(formData, 'slug');
  if (!SLUG.test(slug) || slug.length > 120) return { error: 'not_found' };
  const device = await getDeviceContext({ create: true });
  if (!device) return { error: 'generic' };

  const result = await revealContact(getPool(), {
    slug,
    device,
    turnstileToken: text(formData, 'turnstileToken') || null,
    remoteIp: await remoteIp(),
  });
  if (result.ok) return { phone: result.phone };

  switch (result.reason) {
    case 'rate_limited':
      return {
        error: 'rate_limited',
        minutes: Math.max(1, Math.ceil(result.retryAfterMs / 60000)),
      };
    case 'captcha_required':
    case 'captcha_failed':
      return {
        error: result.reason,
        needsCaptcha: true,
        nonce: crypto.randomUUID(),
      };
    default:
      return { error: result.reason };
  }
}

export async function reportAction(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const slug = text(formData, 'slug');
  if (!SLUG.test(slug) || slug.length > 120) return { error: 'not_found' };
  const device = await getDeviceContext({ create: true });
  if (!device) return { error: 'generic' };

  const user = await getCurrentUser();
  const result = await reportProfile(getPool(), {
    slug,
    reason: text(formData, 'reason'),
    note: text(formData, 'note'),
    reporterId: user?.id ?? null,
    device,
  });
  return result.ok ? { sent: true } : { error: result.reason };
}
