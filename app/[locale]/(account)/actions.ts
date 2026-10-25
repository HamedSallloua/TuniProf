'use server';

import { randomUUID } from 'node:crypto';
import { getLocale } from 'next-intl/server';
import { headers, cookies } from 'next/headers';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { SESSION_COOKIE } from '@/lib/auth/config';
import {
  clearSessionCookie,
  getCurrentUser,
  setSessionCookie,
} from '@/lib/auth/current-user';
import type { Role } from '@/lib/auth/permissions';
import { getDeviceContext } from '@/lib/auth/device';
import {
  completePasswordReset,
  completeSignUp,
  completeVisitorLogin,
  loginWithPassword,
  requestPasswordReset,
  signUpTeacher,
  startVisitorLogin,
} from '@/lib/auth/flows';
import {
  challengeIdSchema,
  fieldErrors,
  formValues,
  loginSchema,
  newPasswordSchema,
  phoneOnlySchema,
  signUpSchema,
} from '@/lib/auth/schemas';
import { revokeSession } from '@/lib/auth/session';
import {
  getChallengeView,
  handleInboundMessage,
  startChallenge,
} from '@/lib/auth/verification';
import { getPool } from '@/lib/db/client';
import { getVerificationProviderName } from '@/lib/env';
import type { FormState } from './form-state';

// Server actions behind the account pages. Each one: validates with Zod, calls a tested
// function of lib/auth/flows.ts, then redirects. No business rule lives here.

async function currentLocale(): Promise<Locale> {
  return (await getLocale()) as Locale;
}

async function userAgent(): Promise<string | null> {
  return (await headers()).get('user-agent');
}

/** Where each kind of account lands after signing in. */
function homePathFor(role: Role): '/espace-professeur' | '/admin' | '/' {
  if (role === 'teacher') return '/espace-professeur';
  if (role === 'visitor') return '/'; // the review form comes in M6
  return '/admin';
}

function toVerification(locale: Locale, challengeId: string): never {
  return redirect({
    href: { pathname: '/verification', query: { c: challengeId } },
    locale,
  });
}

/** Turns a refusal from lib/auth into a form message. */
function refusal(
  result: { reason: string; retryAfterMs?: number },
  values?: NonNullable<FormState>['values'],
): FormState {
  const retryMinutes =
    result.retryAfterMs === undefined
      ? undefined
      : Math.max(1, Math.ceil(result.retryAfterMs / 60000));
  const keys: Record<string, string> = {
    phone_taken: 'phoneTaken',
    rate_limited: 'rateLimited',
    locked: 'locked',
    account_exists: 'accountExists',
    suspended: 'suspended',
    invalid_credentials: 'invalidCredentials',
  };
  return { error: keys[result.reason] ?? 'generic', retryMinutes, values };
}

// ------------------------------------------------------------------ teacher sign-up

export async function signUpAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = formValues(formData, [
    'phone',
    'password',
    'confirmPassword',
    'email',
    'terms',
    'phoneConsent',
  ]);
  const values = {
    phone: raw.phone,
    email: raw.email,
    terms: raw.terms === 'on',
    phoneConsent: raw.phoneConsent === 'on',
  };
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success)
    return { fieldErrors: fieldErrors(parsed.error), values };

  const device = await getDeviceContext({ create: true });
  const result = await signUpTeacher(getPool(), {
    phone: parsed.data.phone,
    password: parsed.data.password,
    email: parsed.data.email,
    device: device!,
  });
  if (!result.ok) return refusal(result, values);
  return toVerification(await currentLocale(), result.challengeId);
}

// ---------------------------------------------------------------------------- login

export async function loginAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = formValues(formData, ['phone', 'password']);
  const values = { phone: raw.phone };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success)
    return { fieldErrors: fieldErrors(parsed.error), values };

  const pool = getPool();
  const device = (await getDeviceContext({ create: true }))!;
  const locale = await currentLocale();
  const result = await loginWithPassword(pool, {
    phone: parsed.data.phone,
    password: parsed.data.password,
    device,
    userAgent: await userAgent(),
  });

  if (result.ok) {
    await setSessionCookie(result.session.token, result.role);
    return redirect({ href: homePathFor(result.role), locale });
  }
  if (result.reason === 'not_verified') {
    // Right password but the number was never verified: restart the WhatsApp check.
    const started = await startChallenge(pool, {
      phone: parsed.data.phone,
      purpose: 'signup',
      userId: result.userId,
      device,
    });
    return started.ok
      ? toVerification(locale, started.challengeId)
      : refusal(started, values);
  }
  return refusal(result, values);
}

// ------------------------------------------------------------- reviewer (no password)

export async function reviewerLoginAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = formValues(formData, ['phone']);
  const values = { phone: raw.phone };
  const parsed = phoneOnlySchema.safeParse(raw);
  if (!parsed.success)
    return { fieldErrors: fieldErrors(parsed.error), values };

  const device = (await getDeviceContext({ create: true }))!;
  const result = await startVisitorLogin(getPool(), {
    phone: parsed.data.phone,
    device,
  });
  if (!result.ok) return refusal(result, values);
  return toVerification(await currentLocale(), result.challengeId);
}

// -------------------------------------------------------------------- password reset

export async function resetRequestAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = formValues(formData, ['phone']);
  const values = { phone: raw.phone };
  const parsed = phoneOnlySchema.safeParse(raw);
  if (!parsed.success)
    return { fieldErrors: fieldErrors(parsed.error), values };

  const device = (await getDeviceContext({ create: true }))!;
  const result = await requestPasswordReset(getPool(), {
    phone: parsed.data.phone,
    device,
  });
  if (!result.ok) return refusal(result, values);
  return toVerification(await currentLocale(), result.challengeId);
}

export async function resetCompleteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse(
    formValues(formData, ['challenge', 'password', 'confirmPassword']),
  );
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const device = await getDeviceContext({ create: false });
  if (!device) return { error: 'invalidRequest' };

  const result = await completePasswordReset(getPool(), {
    challengeId: parsed.data.challenge,
    device,
    newPassword: parsed.data.password,
  });
  if (!result.ok) {
    const keys = {
      not_verified: 'notVerified',
      invalid: 'invalidRequest',
      no_account: 'noAccount',
    };
    return { error: keys[result.reason] };
  }
  return redirect({
    href: { pathname: '/connexion', query: { reset: '1' } },
    locale: await currentLocale(),
  });
}

// --------------------------------------------------------------- after the WhatsApp check

/** The verification page sends the person here once the number is verified. */
export async function finishVerificationAction(
  formData: FormData,
): Promise<void> {
  const locale = await currentLocale();
  const parsed = challengeIdSchema.safeParse(
    formValues(formData, ['challenge']),
  );
  const device = await getDeviceContext({ create: false });
  if (!parsed.success || !device)
    return redirect({ href: '/connexion', locale });

  const pool = getPool();
  const challengeId = parsed.data.challenge;
  const view = await getChallengeView(pool, challengeId, device.deviceHash);

  // Finished already (double click, repeated request): the session exists, go on to it.
  if (view?.status === 'consumed') {
    const user = await getCurrentUser();
    if (user) return redirect({ href: homePathFor(user.role), locale });
  }
  if (!view || view.status !== 'verified') {
    return redirect({
      href: { pathname: '/verification', query: { c: challengeId } },
      locale,
    });
  }

  const input = { challengeId, device, userAgent: await userAgent() };
  if (view.purpose === 'signup') {
    const done = await completeSignUp(pool, input);
    if (!done.ok) return redirect({ href: '/connexion', locale });
    await setSessionCookie(done.session.token, 'teacher');
    return redirect({ href: '/espace-professeur', locale });
  }
  if (view.purpose === 'visitor_login') {
    const done = await completeVisitorLogin(pool, input);
    if (!done.ok) return redirect({ href: '/connexion', locale });
    await setSessionCookie(done.session.token, 'visitor');
    return redirect({ href: '/', locale });
  }
  // reset: the next page asks for the new password.
  return redirect({
    href: {
      pathname: '/mot-de-passe-oublie/nouveau',
      query: { c: challengeId },
    },
    locale,
  });
}

// ----------------------------------------------------------------------------- logout

export async function logoutAction(): Promise<void> {
  const locale = await currentLocale();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(getPool(), token);
  await clearSessionCookie();
  return redirect({ href: '/connexion', locale });
}

// -------------------------------------------------------- development only: fake WhatsApp

/**
 * Stands in for the WhatsApp message when no Meta account is connected. It goes through
 * exactly the same function as the real webhook. Refuses to run in production.
 */
export async function simulateWhatsAppAction(
  formData: FormData,
): Promise<void> {
  const locale = await currentLocale();
  if (getVerificationProviderName() !== 'dev-stub')
    return redirect({ href: '/', locale });

  const parsed = challengeIdSchema.safeParse(
    formValues(formData, ['challenge']),
  );
  const device = await getDeviceContext({ create: false });
  if (!parsed.success || !device)
    return redirect({ href: '/connexion', locale });

  const pool = getPool();
  const view = await getChallengeView(
    pool,
    parsed.data.challenge,
    device.deviceHash,
  );
  if (view?.status === 'pending' && view.code) {
    await handleInboundMessage(pool, {
      provider: 'dev-stub',
      messageId: `dev-${randomUUID()}`,
      from: view.phone.replace('+', ''),
      text: view.code,
    });
  }
  return toVerification(locale, parsed.data.challenge);
}
