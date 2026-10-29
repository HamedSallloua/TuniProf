'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';

export type PickableGroup = {
  id: string;
  name: string;
  color: string;
  /** The student is already in it: shown, not selectable. */
  disabled?: boolean;
};

/**
 * A list of the teacher's groups to choose from: several for "Ajouter à un (autre) groupe", one
 * for "Déplacer vers un autre groupe" (spec 5.6, 5.7). Groups the student is already in are
 * disabled. `onConfirm` returns null when it worked, or the code of the error to show.
 */
export function GroupPickerDialog({
  title,
  groups,
  multiple,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  groups: PickableGroup[];
  multiple: boolean;
  confirmLabel: string;
  onConfirm: (groupIds: string[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const t = useTranslations('students');
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setChosen((current) =>
      multiple
        ? current.includes(id)
          ? current.filter((g) => g !== id)
          : [...current, id]
        : [id],
    );

  function confirm() {
    setError(null);
    startTransition(async () => {
      const failure = await onConfirm(chosen);
      if (failure === null) onClose();
      else setError(failure);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div className="max-h-[85dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-card bg-surface p-5 sm:rounded-card">
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
        {groups.length === 0 ? (
          <p className="text-muted">{t('noGroups')}</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((group) => (
              <li key={group.id}>
                <label
                  className={
                    'flex min-h-11 items-center gap-3 rounded-md border border-border p-2 ' +
                    (group.disabled ? 'opacity-60' : 'cursor-pointer')
                  }
                >
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    name="group-choice"
                    checked={chosen.includes(group.id)}
                    disabled={group.disabled}
                    onChange={() => toggle(group.id)}
                    className="size-5 accent-primary"
                  />
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="flex-1">{group.name}</span>
                  {group.disabled && (
                    <span className="text-xs text-muted">
                      {t('alreadyInGroup')}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-accent">
            {t(`errors.${error}` as 'errors.invalid_name')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={chosen.length === 0 || pending}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={pending}
            onClick={onClose}
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
