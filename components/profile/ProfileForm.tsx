'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useActionState, useMemo, useState, useTransition } from 'react';
import { saveProfileAction } from '@/app/[locale]/(teacher)/profile-actions';
import type { ProfileFormState } from '@/app/[locale]/(teacher)/profile-state';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/ui';
import type { FieldError, ProfileFormValues } from '@/lib/profile/form';
import {
  DIPLOMAS,
  EXPERIENCES,
  MODES,
  formatMillimesInput,
} from '@/lib/profile/rules';

export type FormOption = { id: string; name: string };

export type ProfileFormProps = {
  /** Changes when the saved profile changes: the fields start again from the new values. */
  version: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';
  initial: ProfileFormValues;
  phoneDisplay: string;
  governorates: FormOption[];
  delegations: (FormOption & { governorateId: string })[];
  levels: (FormOption & { cycle: string })[];
  subjects: FormOption[];
  /** The teacher's own "Autre" subjects, waiting for an admin. */
  waitingSubjects: FormOption[];
  rateRange: { min: number; max: number };
  photo: { currentUrl: string | null; waitingUrl: string | null };
};

const CYCLES = [
  'primaire',
  'preparatoire',
  'secondaire',
  'universite',
] as const;

export function ProfileForm(props: ProfileFormProps) {
  const t = useTranslations('profile');
  const [state, action] = useActionState<ProfileFormState, FormData>(
    saveProfileAction,
    null,
  );
  const [pending, startTransition] = useTransition();
  const values = state?.values ?? props.initial;
  const errors = state?.fieldErrors ?? {};
  const approved = props.status === 'approved';
  const canSubmit = props.status === 'draft' || props.status === 'rejected';

  return (
    // The form is sent by hand, not with the form's `action`: React empties a form after
    // an action, which would also untick the levels and zones the teacher just chose.
    // The clicked button (draft or submit) is included in the data.
    <form
      className="space-y-8"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const data = new FormData(event.currentTarget, submitter);
        startTransition(() => action(data));
      }}
    >
      {state?.notice && (
        <p
          role={state.notice.kind === 'error' ? 'alert' : 'status'}
          className={
            'rounded-md border p-3 text-sm ' +
            (state.notice.kind === 'error'
              ? 'border-accent bg-secondary text-accent'
              : 'border-primary bg-secondary text-primary')
          }
        >
          {state.notice.group === 'errors'
            ? t(`errors.${state.notice.code}` as 'errors.generic')
            : t(`notices.${state.notice.code}` as 'notices.saved')}
        </p>
      )}
      {approved && (
        <p className="rounded-md border border-border bg-surface p-3 text-sm text-muted">
          {t('notices.versionInfo')}
        </p>
      )}

      <Fields key={props.version} {...props} values={values} errors={errors} />

      <div className="flex flex-wrap gap-3">
        {canSubmit ? (
          <>
            <button
              type="submit"
              name="intent"
              disabled={pending}
              value="draft"
              className={secondaryButtonClass}
            >
              {t('actions.saveDraft')}
            </button>
            <button
              type="submit"
              name="intent"
              disabled={pending}
              value="submit"
              className={buttonClass}
            >
              {props.status === 'rejected'
                ? t('actions.resubmit')
                : t('actions.submit')}
            </button>
          </>
        ) : (
          <button
            type="submit"
            name="intent"
            disabled={pending}
            value="save"
            className={buttonClass}
          >
            {t('actions.saveChanges')}
          </button>
        )}
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------- the fields

function Fields({
  values,
  errors,
  ...props
}: ProfileFormProps & {
  values: ProfileFormValues;
  errors: NonNullable<ProfileFormState>['fieldErrors'] & object;
}) {
  const t = useTranslations('profile');
  const [bio, setBio] = useState(values.bio);
  const [governorate, setGovernorate] = useState(values.governorate);
  const [modes, setModes] = useState(new Set(values.modes));
  const [levels, setLevels] = useState(new Set(values.levels));
  const [zones, setZones] = useState(new Set(values.zones));
  const [rates, setRates] = useState<Record<string, string>>(values.subjects);
  const [removePhoto, setRemovePhoto] = useState(false);

  const zoneChoices = useMemo(
    () => props.delegations.filter((d) => d.governorateId === governorate),
    [props.delegations, governorate],
  );
  const onlyOnline = modes.size === 1 && modes.has('online');
  const suspended = props.status === 'suspended';

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  return (
    <fieldset disabled={suspended} className="space-y-8">
      {suspended && (
        <p role="alert" className="text-accent">
          {t('notices.suspended')}
        </p>
      )}

      {/* ------------------------------------------------------------ identity */}
      <Section title={t('sections.identity')}>
        <Field
          id="fullName"
          label={t('fields.fullName')}
          error={errors.fullName}
        >
          <input
            id="fullName"
            name="fullName"
            defaultValue={values.fullName}
            autoComplete="name"
            maxLength={80}
            aria-invalid={errors.fullName ? true : undefined}
            className={inputClass}
          />
        </Field>

        <div className="space-y-2">
          <label htmlFor="photo" className="block font-medium">
            {t('fields.photo')}
          </label>
          <div className="flex flex-wrap items-center gap-4">
            {props.photo.currentUrl && (
              <figure className="text-center text-xs text-muted">
                <Image
                  src={props.photo.currentUrl}
                  alt=""
                  width={96}
                  height={96}
                  unoptimized
                  className="size-24 rounded-md border border-border object-cover"
                />
                <figcaption>{t('fields.currentPhoto')}</figcaption>
              </figure>
            )}
            {props.photo.waitingUrl && (
              <figure className="text-center text-xs text-muted">
                <Image
                  src={props.photo.waitingUrl}
                  alt=""
                  width={96}
                  height={96}
                  unoptimized
                  className="size-24 rounded-md border border-dashed border-accent object-cover"
                />
                <figcaption>{t('fields.waitingPhoto')}</figcaption>
              </figure>
            )}
            <input
              id="photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png"
              aria-describedby="photo-hint"
              className="text-sm"
            />
          </div>
          <p id="photo-hint" className="text-sm text-muted">
            {t('fields.photoHint')}
          </p>
          {(props.photo.currentUrl || props.photo.waitingUrl) && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="removePhoto"
                checked={removePhoto}
                onChange={(e) => setRemovePhoto(e.target.checked)}
                className="size-4 accent-primary"
              />
              {t('fields.removePhoto')}
            </label>
          )}
          <ErrorLine error={errors.photo} />
        </div>

        <div className="space-y-1">
          <p className="font-medium">{t('fields.phone')}</p>
          <p dir="ltr" className="text-start font-semibold">
            {props.phoneDisplay}
          </p>
          <p className="text-sm text-muted">{t('fields.phoneHint')}</p>
        </div>
      </Section>

      {/* ----------------------------------------------------------- teaching */}
      <Section title={t('sections.teaching')}>
        <Field id="diploma" label={t('fields.diploma')} error={errors.diploma}>
          <select
            id="diploma"
            name="diploma"
            defaultValue={values.diploma}
            className={inputClass}
          >
            <option value="">{t('fields.choose')}</option>
            {DIPLOMAS.map((code) => (
              <option key={code} value={code}>
                {t(`options.diploma.${code}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="experience"
          label={t('fields.experience')}
          error={errors.experience}
        >
          <select
            id="experience"
            name="experience"
            defaultValue={values.experience}
            className={inputClass}
          >
            <option value="">{t('fields.choose')}</option>
            {EXPERIENCES.map((code) => (
              <option key={code} value={code}>
                {t(`options.experience.${code}`)}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="space-y-3">
          <legend className="font-medium">{t('fields.levels')}</legend>
          {CYCLES.map((cycle) => {
            const group = props.levels.filter((l) => l.cycle === cycle);
            const allOn = group.every((l) => levels.has(l.id));
            return (
              <div key={cycle} className="space-y-1">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-semibold text-primary">
                    {t(`options.cycle.${cycle}`)}
                  </p>
                  <button
                    type="button"
                    className="text-sm text-primary underline underline-offset-2"
                    onClick={() => {
                      const next = new Set(levels);
                      for (const l of group) {
                        if (allOn) next.delete(l.id);
                        else next.add(l.id);
                      }
                      setLevels(next);
                    }}
                  >
                    {allOn ? t('fields.selectNone') : t('fields.selectAll')}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {group.map((l) => (
                    <label key={l.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="levels"
                        value={l.id}
                        checked={levels.has(l.id)}
                        onChange={(e) =>
                          setLevels(toggle(levels, l.id, e.target.checked))
                        }
                        className="size-5 accent-primary"
                      />
                      {l.name}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <ErrorLine error={errors.levels} />
        </fieldset>

        <Field id="bio" label={t('fields.bio')} error={errors.bio}>
          <textarea
            id="bio"
            name="bio"
            rows={6}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            aria-invalid={errors.bio ? true : undefined}
            aria-describedby="bio-hint"
            className={inputClass}
          />
          <p
            id="bio-hint"
            className="flex justify-between gap-4 text-sm text-muted"
          >
            <span>{t('fields.bioHint')}</span>
            <span className="shrink-0">
              {t('fields.bioCount', { count: [...bio].length })}
            </span>
          </p>
        </Field>
      </Section>

      {/* -------------------------------------------------------- where / how */}
      <Section title={t('sections.where')}>
        <fieldset className="space-y-1">
          <legend className="font-medium">{t('fields.modes')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="modes"
                  value={mode}
                  checked={modes.has(mode)}
                  onChange={(e) =>
                    setModes(toggle(modes, mode, e.target.checked))
                  }
                  className="size-5 accent-primary"
                />
                {t(`options.mode.${mode}`)}
              </label>
            ))}
          </div>
          <ErrorLine error={errors.modes} />
        </fieldset>

        <Field
          id="governorate"
          label={t('fields.governorate')}
          error={errors.governorate}
        >
          <select
            id="governorate"
            name="governorate"
            value={governorate}
            onChange={(e) => {
              setGovernorate(e.target.value);
              setZones(new Set()); // zones belong to one governorate
            }}
            className={inputClass}
          >
            <option value="">{t('fields.choose')}</option>
            {props.governorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="space-y-2">
          <legend className="font-medium">{t('fields.zones')}</legend>
          <p className="text-sm text-muted">
            {t('fields.zonesHint')}
            {onlyOnline ? '' : ' *'}
          </p>
          {zoneChoices.length > 0 && (
            <div className="flex gap-4 text-sm">
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => setZones(new Set(zoneChoices.map((z) => z.id)))}
              >
                {t('fields.zonesAll')}
              </button>
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => setZones(new Set())}
              >
                {t('fields.zonesNone')}
              </button>
            </div>
          )}
          <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
            {zoneChoices.map((z) => (
              <label key={z.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="zones"
                  value={z.id}
                  checked={zones.has(z.id)}
                  onChange={(e) =>
                    setZones(toggle(zones, z.id, e.target.checked))
                  }
                  className="size-5 accent-primary"
                />
                {z.name}
              </label>
            ))}
          </div>
          <ErrorLine error={errors.zones} />
        </fieldset>
      </Section>

      {/* ----------------------------------------------------- subjects, rates */}
      <Section title={t('sections.subjects')}>
        <p className="text-sm text-muted">{t('fields.subjectsHint')}</p>
        <ul className="space-y-2">
          {[...props.subjects, ...props.waitingSubjects].map((subject) => {
            const on = subject.id in rates;
            const waiting = props.waitingSubjects.some(
              (s) => s.id === subject.id,
            );
            const rateError = errors.rates?.[subject.id];
            return (
              <li
                key={subject.id}
                className="flex flex-wrap items-center gap-3"
              >
                <label className="flex min-w-48 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    name="subjects"
                    value={subject.id}
                    checked={on}
                    onChange={(e) => {
                      const next = { ...rates };
                      if (e.target.checked) next[subject.id] = '';
                      else delete next[subject.id];
                      setRates(next);
                    }}
                    className="size-5 accent-primary"
                  />
                  <span>
                    {subject.name}
                    {waiting && (
                      <span className="ms-2 text-xs text-accent">
                        ({t('fields.pendingSubject')})
                      </span>
                    )}
                  </span>
                </label>
                {on && (
                  <div className="space-y-1">
                    <input
                      name={`rate_${subject.id}`}
                      value={rates[subject.id]}
                      onChange={(e) =>
                        setRates({ ...rates, [subject.id]: e.target.value })
                      }
                      inputMode="decimal"
                      dir="ltr"
                      aria-label={`${t('fields.rate')} - ${subject.name}`}
                      placeholder={t('fields.rate')}
                      aria-invalid={rateError ? true : undefined}
                      className={inputClass + ' w-40 text-start'}
                    />
                    <ErrorLine error={rateError} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <ErrorLine error={errors.subjects} />

        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="font-medium">{t('fields.custom')}</p>
          <p className="text-sm text-muted">{t('fields.customHint')}</p>
          <div className="flex flex-wrap items-start gap-3">
            <div className="space-y-1">
              <input
                name="customName"
                defaultValue={values.customName}
                maxLength={40}
                aria-label={t('fields.customName')}
                placeholder={t('fields.customName')}
                className={inputClass + ' w-56'}
              />
              <ErrorLine error={errors.customSubject} />
            </div>
            <div className="space-y-1">
              <input
                name="customRate"
                defaultValue={values.customRate}
                inputMode="decimal"
                dir="ltr"
                aria-label={t('fields.rate')}
                placeholder={t('fields.rate')}
                className={inputClass + ' w-40 text-start'}
              />
              <ErrorLine error={errors.rates?.custom} />
            </div>
          </div>
        </div>
      </Section>
    </fieldset>
  );
}

// ------------------------------------------------------------------------------ small pieces

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-5 rounded-card border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: FieldError;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {children}
      <ErrorLine error={error} />
    </div>
  );
}

function ErrorLine({ error }: { error?: FieldError }) {
  const t = useTranslations('profile.errors');
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-accent">
      {t(error.code as 'generic', {
        min: formatMillimesInput(error.min ?? 0),
        max: formatMillimesInput(error.max ?? 0),
      })}
    </p>
  );
}
