'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { ChevronIcon } from '@/components/ui/icons';
import { Link, useRouter } from '@/i18n/navigation';

export type Option = { value: string; label: string };
export type DelegationOption = Option & { governorate: string };

export type SearchValues = {
  gouvernorat: string;
  delegation: string;
  niveau: string;
  matiere: string;
  mode: string;
  prix_min: string;
  prix_max: string;
  note: string;
  tri: string;
};

export const EMPTY_VALUES: SearchValues = {
  gouvernorat: '',
  delegation: '',
  niveau: '',
  matiere: '',
  mode: '',
  prix_min: '',
  prix_max: '',
  note: '',
  tri: '',
};

type Props = {
  /** 'hero' = the three main fields (home page); 'full' = every filter (search page). */
  variant: 'hero' | 'full';
  governorates: Option[];
  delegations: DelegationOption[];
  levels: Option[];
  subjects: Option[];
  initial?: SearchValues;
};

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The search form (spec 3.2). It is a plain GET form, so it works without JavaScript; with
 * JavaScript it drops the empty fields so the address stays short and the délégation list
 * follows the chosen governorate.
 */
export function SearchForm({
  variant,
  governorates,
  delegations,
  levels,
  subjects,
  initial = EMPTY_VALUES,
}: Props) {
  const t = useTranslations('search');
  const tm = useTranslations('profile.options.mode');
  const locale = useLocale();
  const router = useRouter();
  const [governorate, setGovernorate] = useState(initial.gouvernorat);
  const [delegation, setDelegation] = useState(initial.delegation);
  const full = variant === 'full';
  const prefix = variant === 'hero' ? 'hero' : 'filter';

  const visibleDelegations = delegations.filter(
    (d) => d.governorate === governorate,
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === 'string' && value.trim() !== '') {
        params.set(key, value.trim());
      }
    }
    // A new search starts again from page 1; the default sort is not written.
    params.delete('page');
    if (params.get('tri') === 'pertinence') params.delete('tri');
    const query = params.toString();
    router.push(`/recherche${query ? `?${query}` : ''}`);
  }

  const fields = (
    <div
      className={
        full
          ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4'
          : 'grid gap-4 sm:grid-cols-3'
      }
    >
      <Field id={`${prefix}-gouvernorat`} label={t('fields.governorate')}>
        <select
          id={`${prefix}-gouvernorat`}
          name="gouvernorat"
          value={governorate}
          onChange={(event) => {
            setGovernorate(event.target.value);
            setDelegation('');
          }}
          className={inputClass}
        >
          <option value="">{t('any.governorate')}</option>
          {governorates.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {full && (
        <Field id={`${prefix}-delegation`} label={t('fields.delegation')}>
          <select
            id={`${prefix}-delegation`}
            name="delegation"
            value={delegation}
            onChange={(event) => setDelegation(event.target.value)}
            disabled={!governorate}
            className={inputClass}
          >
            <option value="">{t('any.delegation')}</option>
            {visibleDelegations.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field id={`${prefix}-niveau`} label={t('fields.level')}>
        <select
          id={`${prefix}-niveau`}
          name="niveau"
          defaultValue={initial.niveau}
          className={inputClass}
        >
          <option value="">{t('any.level')}</option>
          {levels.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field id={`${prefix}-matiere`} label={t('fields.subject')}>
        <select
          id={`${prefix}-matiere`}
          name="matiere"
          defaultValue={initial.matiere}
          className={inputClass}
        >
          <option value="">{t('any.subject')}</option>
          {subjects.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {full && (
        <>
          <Field id={`${prefix}-mode`} label={t('fields.mode')}>
            <select
              id={`${prefix}-mode`}
              name="mode"
              defaultValue={initial.mode}
              className={inputClass}
            >
              <option value="">{t('any.mode')}</option>
              <option value="domicile">{tm('at_home')}</option>
              <option value="professeur">{tm('at_teacher')}</option>
              <option value="en-ligne">{tm('online')}</option>
            </select>
          </Field>

          <Field id={`${prefix}-prix_min`} label={t('fields.priceMin')}>
            <input
              id={`${prefix}-prix_min`}
              name="prix_min"
              type="text"
              inputMode="decimal"
              dir="ltr"
              defaultValue={initial.prix_min}
              className={inputClass + ' text-start'}
            />
          </Field>

          <Field id={`${prefix}-prix_max`} label={t('fields.priceMax')}>
            <input
              id={`${prefix}-prix_max`}
              name="prix_max"
              type="text"
              inputMode="decimal"
              dir="ltr"
              defaultValue={initial.prix_max}
              className={inputClass + ' text-start'}
            />
          </Field>

          <Field id={`${prefix}-note`} label={t('fields.rating')}>
            <select
              id={`${prefix}-note`}
              name="note"
              defaultValue={initial.note}
              className={inputClass}
            >
              <option value="">{t('any.rating')}</option>
              {[3, 4, 4.5].map((value) => (
                <option key={value} value={String(value)}>
                  {t('ratingOption', { value })}
                </option>
              ))}
            </select>
          </Field>

          <Field id={`${prefix}-tri`} label={t('fields.sort')}>
            <select
              id={`${prefix}-tri`}
              name="tri"
              defaultValue={initial.tri || 'pertinence'}
              className={inputClass}
            >
              <option value="pertinence">{t('sort.pertinence')}</option>
              <option value="prix-asc">{t('sort.priceAsc')}</option>
              <option value="prix-desc">{t('sort.priceDesc')}</option>
              <option value="mieux-notes">{t('sort.bestRated')}</option>
              <option value="recents">{t('sort.newest')}</option>
            </select>
          </Field>
        </>
      )}
    </div>
  );

  return (
    <form
      action={locale === 'ar' ? '/ar/recherche' : '/recherche'}
      method="get"
      onSubmit={onSubmit}
    >
      {full ? (
        <details
          open
          className="group rounded-card border border-border bg-surface p-4"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold text-primary">
            {t('filters')}
            <ChevronIcon className="size-5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4">{fields}</div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="submit" className={buttonClass}>
              {t('submit')}
            </button>
            <Link href="/recherche" className={secondaryButtonClass}>
              {t('reset')}
            </Link>
          </div>
        </details>
      ) : (
        <div className="space-y-4">
          {fields}
          <button type="submit" className={buttonClass}>
            {t('submit')}
          </button>
        </div>
      )}
    </form>
  );
}
