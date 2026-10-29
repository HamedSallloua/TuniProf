'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import {
  deleteStudentAction,
  moveToGroupAction,
} from '@/app/[locale]/(dashboard)/student-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { useRouter } from '@/i18n/navigation';
import type { StudentRow } from '@/lib/dashboard/students';

type GroupOption = { id: string; name: string; color: string };

const shell =
  'fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center';
const panel =
  'max-h-[85dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-card bg-surface p-5 sm:rounded-card';

/**
 * "Supprimer" a student for good (spec 5.7, invariant 15): permanent, so the name must be typed.
 * Available on the cards (group page, Élèves list) and on the student page.
 */
export function DeleteStudentDialog({
  student,
  onClose,
  onDeleted,
}: {
  student: { id: string; fullName: string };
  onClose: () => void;
  /** Called after the deletion; by default the page is simply refreshed. */
  onDeleted?: () => void;
}) {
  const t = useTranslations('students');
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await deleteStudentAction(student.id, typed);
      if (result.ok) {
        onClose();
        if (onDeleted) onDeleted();
        else router.refresh();
      } else setError(result.reason);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`delete-${student.id}-title`}
      className={shell}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <form onSubmit={submit} className={panel}>
        <h2
          id={`delete-${student.id}-title`}
          className="text-lg font-semibold text-primary"
        >
          {t('delete')} : {student.fullName}
        </h2>
        <p className="text-sm">
          {t('deleteWarning', { name: student.fullName })}
        </p>
        <div className="space-y-1">
          <label
            htmlFor={`delete-${student.id}-name`}
            className="block text-sm font-medium"
          >
            {t('deleteTypeName')}
          </label>
          <input
            id={`delete-${student.id}-name`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={inputClass}
            autoComplete="off"
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-accent">
            {t(`errors.${error}` as 'errors.invalid_name')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className={buttonClass}
            disabled={pending || typed.trim() !== student.fullName.trim()}
          >
            {t('deleteForever')}
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
      </form>
    </div>
  );
}

/**
 * "Déplacer vers un autre groupe" from a card that is not tied to one group (the Élèves list):
 * which group the student leaves (asked only when they are in several), then which group they
 * join. The groups the student is already in cannot be the target.
 */
export function MoveStudentDialog({
  student,
  groups,
  onClose,
}: {
  student: StudentRow;
  groups: GroupOption[];
  onClose: () => void;
}) {
  const t = useTranslations('students');
  const router = useRouter();
  const [from, setFrom] = useState(
    student.groups.length === 1 ? student.groups[0].membershipId : '',
  );
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const source = student.groups.find((g) => g.membershipId === from);
  const inGroups = new Set(student.groups.map((g) => g.groupId));

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await moveToGroupAction(from, to);
      if (result.ok) {
        onClose();
        router.refresh();
      } else setError(result.reason);
    });
  }

  const radioRow = (
    name: string,
    id: string,
    label: string,
    color: string,
    checked: boolean,
    disabled: boolean,
    onPick: () => void,
  ) => (
    <li key={id}>
      <label
        className={
          'flex min-h-11 items-center gap-3 rounded-md border border-border p-2 ' +
          (disabled ? 'opacity-60' : 'cursor-pointer')
        }
      >
        <input
          type="radio"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={onPick}
          className="size-5 accent-primary"
        />
        <span
          aria-hidden="true"
          className="inline-block size-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="flex-1">{label}</span>
        {disabled && (
          <span className="text-xs text-muted">{t('alreadyInGroup')}</span>
        )}
      </label>
    </li>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('moveToOtherGroup')}
      className={shell}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div className={panel}>
        <h2 className="text-lg font-semibold text-primary">
          {t('moveToOtherGroup')} : {student.fullName}
        </h2>

        {student.groups.length > 1 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('moveFrom')}</legend>
            <ul className="space-y-2">
              {student.groups.map((g) =>
                radioRow(
                  'move-from',
                  g.membershipId,
                  g.groupName,
                  g.groupColor,
                  from === g.membershipId,
                  false,
                  () => {
                    setFrom(g.membershipId);
                    setTo('');
                  },
                ),
              )}
            </ul>
          </fieldset>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('moveTo')}</legend>
          <ul className="space-y-2">
            {groups
              .filter((g) => g.id !== source?.groupId)
              .map((g) =>
                radioRow(
                  'move-to',
                  g.id,
                  g.name,
                  g.color,
                  to === g.id,
                  inGroups.has(g.id),
                  () => setTo(g.id),
                ),
              )}
          </ul>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-accent">
            {t(`errors.${error}` as 'errors.invalid_name')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={from === '' || to === '' || pending}
            onClick={confirm}
          >
            {t('move')}
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
