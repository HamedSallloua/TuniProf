'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import {
  addStudentToGroupsAction,
  moveToGroupAction,
  removeFromGroupAction,
} from '@/app/[locale]/(dashboard)/student-actions';
import { secondaryButtonClass } from '@/components/auth/styles';
import { Link, useRouter } from '@/i18n/navigation';
import type { StudentRow } from '@/lib/dashboard/students';
import { ContactLinks } from './ContactLinks';
import { GroupPickerDialog, type PickableGroup } from './GroupPickerDialog';
import { InlineEdit } from './InlineEdit';
import { DeleteStudentDialog } from './StudentDialogs';
import { saveStudentField } from './save-student-field';

export type GroupMember = StudentRow & {
  membershipId: string;
  joinedOn: string;
};

/** Keeps a row highlighted for about 3 seconds after it was added (spec 5.6). */
export function useHighlight(active: boolean): boolean {
  const [on, setOn] = useState(active);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setOn(false), 3000);
    return () => clearTimeout(timer);
  }, [active]);
  return on;
}

/**
 * One student of a group (spec 5.6): the name and the phone each with their own "Modifier",
 * Call and WhatsApp, and the actions Retirer du groupe, Ajouter à un autre groupe and
 * Déplacer vers un autre groupe. (The month figures, the counter and the amounts come with the
 * billing, M10.)
 */
export function StudentRowCard({
  member,
  groupId,
  allGroups,
  canWrite,
  highlight,
}: {
  member: GroupMember;
  groupId: string;
  allGroups: { id: string; name: string; color: string }[];
  canWrite: boolean;
  highlight: boolean;
}) {
  const t = useTranslations('students');
  const router = useRouter();
  const lit = useHighlight(highlight);
  const [dialog, setDialog] = useState<'add' | 'move' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inGroups = new Set(member.groups.map((g) => g.groupId));
  const pickable = (excludeCurrent: boolean): PickableGroup[] =>
    allGroups
      .filter((g) => !(excludeCurrent && g.id === groupId))
      .map((g) => ({ ...g, disabled: inGroups.has(g.id) }));

  function remove() {
    if (!window.confirm(t('removeConfirm', { name: member.fullName }))) return;
    setError(null);
    startTransition(async () => {
      const result = await removeFromGroupAction(member.membershipId);
      if (result.ok) router.refresh();
      else setError(result.reason);
    });
  }

  const save = (field: 'fullName' | 'phone') => async (value: string) => {
    const failure = await saveStudentField(member.id, field, value);
    if (failure === null) router.refresh();
    return failure;
  };

  return (
    <li
      className={
        'space-y-3 rounded-card border bg-surface p-4 transition-colors ' +
        (lit
          ? 'border-primary bg-secondary ring-2 ring-primary'
          : 'border-border')
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <InlineEdit
            id={`name-${member.id}-${groupId}`}
            label={t('fullName')}
            value={member.fullName}
            canWrite={canWrite}
            maxLength={80}
            onSave={save('fullName')}
            display={
              <Link
                href={`/eleves/${member.id}`}
                className="text-base font-semibold text-primary hover:underline"
              >
                {member.fullName}
              </Link>
            }
          />
          {member.note && (
            <p className="mt-1 text-xs text-muted">{member.note}</p>
          )}
        </div>
        <InlineEdit
          id={`phone-${member.id}-${groupId}`}
          label={t('phone')}
          value={member.phone ? member.phone.replace('+216', '') : ''}
          canWrite={canWrite}
          inputType="tel"
          onSave={save('phone')}
          display={<ContactLinks phone={member.phone} />}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-accent">
          {t(`errors.${error}` as 'errors.invalid_name')}
        </p>
      )}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={pending}
            onClick={remove}
          >
            {t('removeFromGroup')}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setDialog('add')}
          >
            {t('addToOtherGroup')}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setDialog('move')}
          >
            {t('moveToOtherGroup')}
          </button>
          <button
            type="button"
            className={secondaryButtonClass + ' !border-accent !text-accent'}
            onClick={() => setDialog('delete')}
          >
            {t('delete')}
          </button>
        </div>
      )}

      {dialog === 'add' && (
        <GroupPickerDialog
          title={t('addToOtherGroup')}
          groups={pickable(false)}
          multiple
          confirmLabel={t('addToGroups')}
          onClose={() => setDialog(null)}
          onConfirm={async (ids) => {
            const result = await addStudentToGroupsAction(member.id, ids);
            if (result.ok) router.refresh();
            return result.ok ? null : result.reason;
          }}
        />
      )}
      {dialog === 'move' && (
        <GroupPickerDialog
          title={t('moveToOtherGroup')}
          groups={pickable(true)}
          multiple={false}
          confirmLabel={t('move')}
          onClose={() => setDialog(null)}
          onConfirm={async (ids) => {
            const result = await moveToGroupAction(member.membershipId, ids[0]);
            if (result.ok) router.refresh();
            return result.ok ? null : result.reason;
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteStudentDialog student={member} onClose={() => setDialog(null)} />
      )}
    </li>
  );
}
