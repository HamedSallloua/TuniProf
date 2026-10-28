'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { deleteGroupAction } from '@/app/[locale]/(dashboard)/dashboard-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { useRouter } from '@/i18n/navigation';

/**
 * "Supprimer" a group (spec 5.5, invariant 15): permanent, so the name must be typed.
 */
export function DeleteGroup({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const t = useTranslations('groups.delete');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await deleteGroupAction(groupId, typed);
      if (result.ok) {
        setOpen(false);
        router.push('/groupes');
        router.refresh();
      } else setError(result.reason);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className={secondaryButtonClass + ' !border-accent !text-accent'}
        onClick={() => setOpen(true)}
      >
        {t('button')}
      </button>
    );
  }

  const id = `delete-${groupId}`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-t-card bg-surface p-5 sm:rounded-card"
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold text-accent">
          {t('title', { name: groupName })}
        </h2>
        <p className="text-sm">{t('body')}</p>
        <div className="space-y-1">
          <label htmlFor={id} className="block font-medium">
            {t('typeName')}
          </label>
          <input
            id={id}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={inputClass}
            autoComplete="off"
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-accent">
            {t(`errors.${error}` as 'errors.invalid')}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={pending || typed.trim() === ''}
            className={buttonClass + ' !bg-accent'}
          >
            {t('confirm')}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setOpen(false)}
          >
            {t('cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
