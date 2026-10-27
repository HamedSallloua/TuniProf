'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import {
  loginAction,
  resetCompleteAction,
  resetRequestAction,
  reviewerLoginAction,
  signUpAction,
} from '@/app/[locale]/(account)/actions';
import type { FormState } from '@/app/[locale]/(account)/form-state';
import { Link } from '@/i18n/navigation';
import { linkClass } from './styles';
import { CheckboxField, FormError, SubmitButton, TextField } from './ui';

const initial: FormState = null;

function PhoneField({ state }: { state: FormState }) {
  const t = useTranslations('auth.fields');
  return (
    <TextField
      name="phone"
      label={t('phone')}
      hint={t('phoneHint')}
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      defaultValue={state?.values?.phone}
      error={state?.fieldErrors?.phone}
      ltr
      required
    />
  );
}

export function SignUpForm() {
  const t = useTranslations('auth');
  const [state, action] = useActionState(signUpAction, initial);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError code={state?.error} minutes={state?.retryMinutes} />
      <PhoneField state={state} />
      <TextField
        name="password"
        label={t('fields.password')}
        hint={t('fields.passwordHint')}
        type="password"
        autoComplete="new-password"
        error={state?.fieldErrors?.password}
        ltr
        required
      />
      <TextField
        name="confirmPassword"
        label={t('fields.confirmPassword')}
        type="password"
        autoComplete="new-password"
        error={state?.fieldErrors?.confirmPassword}
        ltr
        required
      />
      <TextField
        name="email"
        label={t('fields.email')}
        type="email"
        inputMode="email"
        autoComplete="email"
        defaultValue={state?.values?.email}
        error={state?.fieldErrors?.email}
        ltr
      />
      <CheckboxField
        name="terms"
        label={t.rich('fields.terms', {
          terms: (chunks) => (
            <Link href="/conditions" target="_blank" className={linkClass}>
              {chunks}
            </Link>
          ),
        })}
        defaultChecked={state?.values?.terms}
        error={state?.fieldErrors?.terms}
      />
      <CheckboxField
        name="phoneConsent"
        label={t('fields.phoneConsent')}
        defaultChecked={state?.values?.phoneConsent}
        error={state?.fieldErrors?.phoneConsent}
      />
      <SubmitButton>{t('signup.submit')}</SubmitButton>
    </form>
  );
}

export function LoginForm() {
  const t = useTranslations('auth');
  const [state, action] = useActionState(loginAction, initial);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError code={state?.error} minutes={state?.retryMinutes} />
      <PhoneField state={state} />
      <TextField
        name="password"
        label={t('fields.password')}
        type="password"
        autoComplete="current-password"
        error={state?.fieldErrors?.password}
        ltr
        required
      />
      <SubmitButton>{t('login.submit')}</SubmitButton>
    </form>
  );
}

/** Phone number only: reviewer login and password-reset request. */
export function PhoneOnlyForm({ kind }: { kind: 'reviewer' | 'reset' }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState(
    kind === 'reviewer' ? reviewerLoginAction : resetRequestAction,
    initial,
  );
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormError code={state?.error} minutes={state?.retryMinutes} />
      <PhoneField state={state} />
      <SubmitButton>{t(`${kind}.submit`)}</SubmitButton>
    </form>
  );
}

export function NewPasswordForm({ challengeId }: { challengeId: string }) {
  const t = useTranslations('auth');
  const [state, action] = useActionState(resetCompleteAction, initial);
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="challenge" value={challengeId} />
      <FormError code={state?.error} />
      <TextField
        name="password"
        label={t('fields.newPassword')}
        hint={t('fields.passwordHint')}
        type="password"
        autoComplete="new-password"
        error={state?.fieldErrors?.password}
        ltr
        required
      />
      <TextField
        name="confirmPassword"
        label={t('fields.confirmPassword')}
        type="password"
        autoComplete="new-password"
        error={state?.fieldErrors?.confirmPassword}
        ltr
        required
      />
      <SubmitButton>{t('reset.newSubmit')}</SubmitButton>
    </form>
  );
}
