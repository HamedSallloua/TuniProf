'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import {
  createRequestAction,
  createUpgradeAction,
  redeemCodeAction,
  type BillingFormState,
} from '@/app/[locale]/(teacher)/billing-actions';
import { buttonClass, inputClass } from '@/components/auth/styles';
import { SubmitButton } from '@/components/auth/ui';

const initial: BillingFormState = null;
const METHODS = ['flouci', 'd17', 'ccp'] as const;

/** Prices of one plan, already formatted on the server, for both ways of buying it. */
export type PlanCard = {
  id: string;
  name: string;
  days: number;
  visibility: { price: string; perMonth: string; saving: number };
  bundle: { price: string; perMonth: string; saving: number };
};

function Notice({ state }: { state: BillingFormState }) {
  const t = useTranslations('subscription');
  if (!state?.error) return null;
  const message =
    state.group === 'code'
      ? t(`code.errors.${state.error}` as 'code.errors.invalid', {
          minutes: state.retryMinutes ?? 0,
        })
      : t(`errors.${state.error}` as 'errors.generic');
  return (
    <p
      role="alert"
      className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
    >
      {message}
    </p>
  );
}

function MethodChoice() {
  const t = useTranslations('subscription');
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{t('plans.methodTitle')}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {METHODS.map((method, i) => (
          <label key={method} className="flex items-center gap-2">
            <input
              type="radio"
              name="method"
              value={method}
              defaultChecked={i === 0}
              className="size-5 accent-primary"
            />
            {t(`methods.${method}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Pick a plan (with or without the Dashboard) and a way to pay. */
export function PlanForm({
  plans,
  defaultPlanId,
}: {
  plans: PlanCard[];
  defaultPlanId: string;
}) {
  const t = useTranslations('subscription');
  const [state, action] = useActionState(createRequestAction, initial);
  const [planId, setPlanId] = useState(defaultPlanId);
  const [withDashboard, setWithDashboard] = useState(false);

  return (
    <form action={action} className="space-y-5">
      <Notice state={state} />
      <fieldset className="space-y-3">
        <legend className="font-medium">{t('plans.title')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((plan) => {
            const shown = withDashboard ? plan.bundle : plan.visibility;
            const selected = plan.id === planId;
            return (
              <label
                key={plan.id}
                className={
                  'flex cursor-pointer gap-3 rounded-card border p-4 ' +
                  (selected
                    ? 'border-primary bg-secondary'
                    : 'border-border bg-surface')
                }
              >
                <input
                  type="radio"
                  name="planId"
                  value={plan.id}
                  checked={selected}
                  onChange={() => setPlanId(plan.id)}
                  className="mt-1 size-5 accent-primary"
                />
                <span className="space-y-0.5">
                  <span className="block font-semibold text-primary">
                    {plan.name}
                  </span>
                  <span className="block text-sm text-muted">
                    {t('plans.days', { days: plan.days })}
                  </span>
                  <span
                    dir="ltr"
                    className="block text-start text-lg font-bold"
                  >
                    {shown.price}
                  </span>
                  <span
                    dir="ltr"
                    className="block text-start text-sm text-muted"
                  >
                    {t('plans.perMonth', { price: shown.perMonth })}
                  </span>
                  {shown.saving > 0 && (
                    <span className="block text-sm font-medium text-primary">
                      {t('plans.saving', { percent: shown.saving })}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="withDashboard"
          checked={withDashboard}
          onChange={(e) => setWithDashboard(e.target.checked)}
          className="mt-1 size-5 accent-primary"
        />
        <span>{t('plans.dashboardOption')}</span>
      </label>

      <MethodChoice />
      <p className="text-sm text-muted">{t('plans.renewHint')}</p>
      <SubmitButton>{t('plans.create')}</SubmitButton>
    </form>
  );
}

/** Add the Dashboard to the running term. */
export function UpgradeForm({ days, price }: { days: number; price: string }) {
  const t = useTranslations('subscription');
  const [state, action] = useActionState(createUpgradeAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Notice state={state} />
      <p>{t('upgrade.body', { days })}</p>
      <p dir="ltr" className="text-start font-semibold">
        {t('upgrade.price', { price })}
      </p>
      <MethodChoice />
      <SubmitButton>{t('upgrade.create')}</SubmitButton>
    </form>
  );
}

/** Type the activation code. */
export function RedeemForm({ defaultCode }: { defaultCode?: string }) {
  const t = useTranslations('subscription');
  const format = useFormatter();
  const [state, action] = useActionState(redeemCodeAction, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Notice state={state} />
      {state?.success && (
        <p
          role="status"
          className="rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
        >
          {state.success.kind === 'credit' || !state.success.until
            ? t('code.successCredit')
            : t('code.successNow', {
                date: format.dateTime(new Date(state.success.until), {
                  dateStyle: 'long',
                }),
              })}
        </p>
      )}
      <div className="space-y-1">
        <label htmlFor="code" className="block font-medium">
          {t('code.label')}
        </label>
        <input
          id="code"
          name="code"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          defaultValue={defaultCode}
          placeholder="TTP-XXXX-XXXX-XXXX"
          maxLength={40}
          className={
            inputClass +
            ' max-w-sm text-start font-mono tracking-wider uppercase'
          }
        />
        <p className="text-sm text-muted">{t('code.hint')}</p>
      </div>
      <button type="submit" className={buttonClass}>
        {t('code.submit')}
      </button>
    </form>
  );
}
