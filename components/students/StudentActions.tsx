'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  addStudentToGroupsAction,
  moveToGroupAction,
} from '@/app/[locale]/(dashboard)/student-actions';
import { secondaryButtonClass } from '@/components/auth/styles';
import { Link, useRouter } from '@/i18n/navigation';
import { GroupPickerDialog, type PickableGroup } from './GroupPickerDialog';
import { DeleteStudentDialog } from './StudentDialogs';
import type { GroupMember } from './student-types';

/**
 * The actions of a student that apply at once, without "Enregistrer la liste": add to another
 * group, move to another group, delete for good, and open the student's page.
 */
export function StudentActions({
  member,
  groupId,
  allGroups,
}: {
  member: GroupMember;
  groupId: string;
  allGroups: { id: string; name: string; color: string }[];
}) {
  const t = useTranslations('students');
  const router = useRouter();
  const [dialog, setDialog] = useState<'add' | 'move' | 'delete' | null>(null);

  const inGroups = new Set(member.groups.map((g) => g.groupId));
  const pickable = (excludeCurrent: boolean): PickableGroup[] =>
    allGroups
      .filter((g) => !(excludeCurrent && g.id === groupId))
      .map((g) => ({ ...g, disabled: inGroups.has(g.id) }));

  return (
    <>
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
      <Link href={`/eleves/${member.id}`} className={secondaryButtonClass}>
        {t('open')}
      </Link>

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
    </>
  );
}
