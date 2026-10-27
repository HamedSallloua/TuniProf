'use client';

import { useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';
import { buttonClass, inputClass } from './styles';

// Small building blocks shared by the account forms.

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
  label: React.ReactNode;
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
