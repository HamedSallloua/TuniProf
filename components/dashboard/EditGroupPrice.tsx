'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { updateGroupPriceAction } from '@/app/[locale]/(dashboard)/dashboard-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { useRouter } from '@/i18n/navigation';
import { parseDinarsToMillimes } from '@/lib/marketplace/search-params';

/**
 * "Modifier Prix" of a group: the pricing model (per session or per month) and the amount. The
 * price is required. It is a suggestion only: it changes no amount already typed.
 */
export function EditGroupPrice({
  groupId,
  pricingModel,
  referencePriceMillimes,
}: {
  groupId: string;
  pricingModel: 'per_session' | 'per_month';
  referencePriceMillimes: number | null;
}) {
  const t = useTranslations('groups.page.priceEdit');
  const tw = useTranslations('groups.wizard');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(pricingModel);
  const [price, setPrice] = useState(
    referencePriceMillimes === null
      ? ''
      : String(referencePriceMillimes / 1000),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseDinarsToMillimes(price);
  const millimes = parsed !== undefined && parsed > 0 ? parsed : null;

  function close() {
    setOpen(false);
    setError(null);
    setModel(pricingModel);
    setPrice(
      referencePriceMillimes === null
        ? ''
        : String(referencePriceMillimes / 1000),
    );
  }

  function save() {
    if (millimes === null) return;
    setError(null);
    startTransition(async () => {
      const result = await updateGroupPriceAction(groupId, {
        pricingModel: model,
        referencePriceMillimes: millimes,
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.reason);
    });
  }

  if (!open)
    return (
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => setOpen(true)}
      >
        {t('button')}
      </button>
    );

  return (
    <form
      className="space-y-4 rounded-card border border-primary bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <h3 className="font-semibold text-primary">{t('title')}</h3>
      <fieldset className="space-y-1">
        <legend className="font-medium">{tw('pricingLabel')}</legend>
        {(['per_session', 'per_month'] as const).map((value) => (
          <label key={value} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="edit-pricing"
              checked={model === value}
              onChange={() => setModel(value)}
              className="size-5 accent-primary"
            />
            {tw(value === 'per_session' ? 'perSession' : 'perMonth')}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor="edit-price" className="block font-medium">
          {tw('priceLabel')}
        </label>
        <input
          id="edit-price"
          inputMode="decimal"
          dir="ltr"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          aria-invalid={millimes === null}
          className={inputClass + ' text-start sm:!w-48'}
          aria-describedby="edit-price-hint"
          autoFocus
        />
        <p
          id="edit-price-hint"
          className={
            'text-sm ' + (millimes === null ? 'text-accent' : 'text-muted')
          }
        >
          {millimes === null ? tw('priceError') : tw('priceHint')}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-accent">
          {error === 'invalid_price'
            ? t('errors.invalid_price')
            : t('errors.generic')}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className={buttonClass}
          disabled={millimes === null || pending}
        >
          {pending ? t('saving') : t('save')}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={close}
          disabled={pending}
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
