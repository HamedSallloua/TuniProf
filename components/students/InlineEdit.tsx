'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';

/**
 * One value with its own "Modifier" underneath (spec 5.6, 5.7): the name, the phone, the note of
 * a student. `onSave` returns null when it worked, or the code of the error to show.
 */
export function InlineEdit({
  id,
  label,
  value,
  display,
  canWrite,
  onSave,
  inputType = 'text',
  multiline = false,
  maxLength,
}: {
  id: string;
  label: string;
  /** What is typed in the field to start with ("" when empty). */
  value: string;
  /** What is shown when not editing. */
  display: ReactNode;
  canWrite: boolean;
  onSave: (value: string) => Promise<string | null>;
  inputType?: 'text' | 'tel';
  multiline?: boolean;
  maxLength?: number;
}) {
  const t = useTranslations('students');
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const failure = await onSave(typed);
      if (failure === null) setEditing(false);
      else setError(failure);
    });
  }

  if (!editing)
    return (
      <div>
        <div>{display}</div>
        {canWrite && (
          <button
            type="button"
            className="text-sm text-primary underline underline-offset-2"
            onClick={() => {
              setTyped(value);
              setError(null);
              setEditing(true);
            }}
          >
            {t('edit')}
            <span className="sr-only"> {label}</span>
          </button>
        )}
      </div>
    );

  const field = multiline ? (
    <textarea
      id={id}
      value={typed}
      maxLength={maxLength}
      onChange={(e) => setTyped(e.target.value)}
      rows={3}
      className={inputClass}
    />
  ) : (
    <input
      id={id}
      type={inputType}
      dir={inputType === 'tel' ? 'ltr' : undefined}
      value={typed}
      maxLength={maxLength}
      onChange={(e) => setTyped(e.target.value)}
      className={inputClass}
    />
  );
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {field}
      {error && (
        <p role="alert" className="text-sm text-accent">
          {t(`errors.${error}` as 'errors.invalid_name')}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} disabled={pending}>
          {t('save')}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
