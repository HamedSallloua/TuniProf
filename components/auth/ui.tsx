'use client';

import { useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';

// Small building blocks shared by the account forms.

export const inputClass =
  'block w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-foreground aria-[invalid=true]:border-accent aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-accent';

export const buttonClass =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-accent disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-primary bg-surface px-5 font-medium text-primary hover:bg-secondary';

export const linkClass =
  'text-primary underline underline-offset-2 hover:text-accent';

/** Translates an error key from auth.errors. */
export function ErrorText({
  code,
  minutes,
}: {
  code: string;
  minutes?: number;
}) {
  const t = useTranslations('auth.errors');
  return <>{t(code as 'generic', { minutes: minutes ?? 0 })}</>;
}

export function FormError({
  code,
  minutes,
}: {
  code?: string;
  minutes?: number;
}) {
  if (!code) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
    >
      <ErrorText code={code} minutes={minutes} />
    </p>
  );
}

export function TextField(props: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: 'tel' | 'numeric' | 'email' | 'text';
  defaultValue?: string;
  // Numbers, e-mail and passwords are always written left to right, even in Arabic.
  ltr?: boolean;
  required?: boolean;
}) {
  const id = `field-${props.name}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {props.label}
      </label>
      <input
        id={id}
        name={props.name}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        defaultValue={props.defaultValue}
        required={props.required}
        dir={props.ltr ? 'ltr' : undefined}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={
          props.error ? `${id}-error` : props.hint ? `${id}-hint` : undefined
        }
        className={inputClass + (props.ltr ? ' text-start' : '')}
      />
      {props.hint && !props.error && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={`${id}-error`} className="text-sm text-accent">
          <ErrorText code={props.error} />
        </p>
      )}
    </div>
  );
}

export function CheckboxField(props: {
  name: string;
  label: string;
  error?: string;
  defaultChecked?: boolean;
}) {
  const id = `field-${props.name}`;
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={props.name}
          type="checkbox"
          defaultChecked={props.defaultChecked}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? `${id}-error` : undefined}
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <label htmlFor={id}>{props.label}</label>
      </div>
      {props.error && (
        <p id={`${id}-error`} className="text-sm text-accent">
          <ErrorText code={props.error} />
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass}>
      {children}
    </button>
  );
}
