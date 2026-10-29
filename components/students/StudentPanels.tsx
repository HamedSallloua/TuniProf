'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import {
  addStudentToGroupsAction,
  moveToGroupAction,
  removeFromGroupAction,
} from '@/app/[locale]/(dashboard)/student-actions';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';
import { Link, useRouter } from '@/i18n/navigation';
import { formatDay } from '@/lib/dashboard/format';
import type { MembershipHistory, StudentRow } from '@/lib/dashboard/students';
import { ContactLinks } from './ContactLinks';
import { GroupPickerDialog, type PickableGroup } from './GroupPickerDialog';
import { DeleteStudentDialog } from './StudentDialogs';
import { InlineEdit } from './InlineEdit';
import { saveStudentField } from './save-student-field';

type GroupOption = { id: string; name: string; color: string };

/** The information of a student (spec 5.7): name, phone and note, each with its own "Modifier". */
export function StudentInfo({
  student,
  canWrite,
}: {
  student: StudentRow;
  canWrite: boolean;
}) {
  const t = useTranslations('students');
  const router = useRouter();
  const save =
    (field: 'fullName' | 'phone' | 'note') => async (value: string) => {
      const failure = await saveStudentField(student.id, field, value);
      if (failure === null) router.refresh();
      return failure;
    };

  return (
    <section
      aria-labelledby="student-info"
      className="space-y-4 rounded-card border border-border bg-surface p-4"
    >
      <h2 id="student-info" className="font-semibold text-primary">
        {t('information')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <InlineEdit
          id="info-name"
          label={t('fullName')}
          value={student.fullName}
          canWrite={canWrite}
          maxLength={80}
          onSave={save('fullName')}
          display={<span className="font-semibold">{student.fullName}</span>}
        />
        <InlineEdit
          id="info-phone"
          label={t('phone')}
          value={student.phone ? student.phone.replace('+216', '') : ''}
          canWrite={canWrite}
          inputType="tel"
          onSave={save('phone')}
          display={<ContactLinks phone={student.phone} />}
        />
        <div className="sm:col-span-2">
          <InlineEdit
            id="info-note"
            label={t('note')}
            value={student.note ?? ''}
            canWrite={canWrite}
            multiline
            maxLength={300}
            onSave={save('note')}
            display={
              student.note ? (
                <span className="text-sm whitespace-pre-line">
                  {student.note}
                </span>
              ) : (
                <span className="text-sm text-muted">{t('noNote')}</span>
              )
            }
          />
        </div>
      </div>
    </section>
  );
}

/**
 * The groups of a student (spec 5.7): one card per current membership with Retirer du groupe and
 * Déplacer vers un autre groupe, "Ajouter à un groupe", and the history of the past
 * memberships. (The month block of each card, with the counter and the amounts, and the total of
 * the month come with the billing, M10.)
 */
export function StudentGroups({
  student,
  history,
  groups,
  canWrite,
}: {
  student: StudentRow;
  history: MembershipHistory[];
  groups: GroupOption[];
  canWrite: boolean;
}) {
  const t = useTranslations('students');
  const locale = useLocale();
  const router = useRouter();
  const [dialog, setDialog] = useState<
    | { kind: 'add' }
    | { kind: 'move'; membershipId: string; groupId: string }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inGroups = new Set(student.groups.map((g) => g.groupId));
  const pickable = (excludeId?: string): PickableGroup[] =>
    groups
      .filter((g) => g.id !== excludeId)
      .map((g) => ({ ...g, disabled: inGroups.has(g.id) }));
  const past = history.filter((h) => h.leftOn !== null);
  const day = (value: string) =>
    formatDay(value, locale, { dateStyle: 'medium' });

  function remove(membershipId: string) {
    if (!window.confirm(t('removeConfirm', { name: student.fullName }))) return;
    setError(null);
    startTransition(async () => {
      const result = await removeFromGroupAction(membershipId);
      if (result.ok) router.refresh();
      else setError(result.reason);
    });
  }

  return (
    <section aria-labelledby="student-groups" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="student-groups" className="text-lg font-semibold text-primary">
          {t('groupsTitle')}
        </h2>
        {canWrite && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => setDialog({ kind: 'add' })}
          >
            {t('addToGroup')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-accent">
          {t(`errors.${error}` as 'errors.invalid_name')}
        </p>
      )}

      {student.groups.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-muted">
          {t('noGroup')}
        </p>
      ) : (
        <ul className="space-y-3">
          {student.groups.map((g) => (
            <li
              key={g.membershipId}
              className="space-y-2 rounded-card border border-s-4 border-border bg-surface p-4"
              style={{ borderInlineStartColor: g.groupColor }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-primary">
                  <Link
                    href={`/groupes/${g.groupId}`}
                    className="hover:underline"
                  >
                    {g.groupName}
                  </Link>
                </h3>
                <span className="text-xs text-muted">
                  {t('since', { date: day(g.joinedOn) })}
                </span>
              </div>
              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    disabled={pending}
                    onClick={() => remove(g.membershipId)}
                  >
                    {t('removeFromGroup')}
                  </button>
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() =>
                      setDialog({
                        kind: 'move',
                        membershipId: g.membershipId,
                        groupId: g.groupId,
                      })
                    }
                  >
                    {t('moveToOtherGroup')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold text-primary">{t('history')}</h3>
          <ul className="space-y-1 text-sm">
            {past.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-3 text-muted">
                <span className="font-medium text-foreground">
                  {h.groupName}
                </span>
                <span>
                  {day(h.joinedOn)} → {h.leftOn ? day(h.leftOn) : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dialog?.kind === 'add' && (
        <GroupPickerDialog
          title={t('addToGroup')}
          groups={pickable()}
          multiple
          confirmLabel={t('addToGroups')}
          onClose={() => setDialog(null)}
          onConfirm={async (ids) => {
            const result = await addStudentToGroupsAction(student.id, ids);
            if (result.ok) router.refresh();
            return result.ok ? null : result.reason;
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <GroupPickerDialog
          title={t('moveToOtherGroup')}
          groups={pickable(dialog.groupId)}
          multiple={false}
          confirmLabel={t('move')}
          onClose={() => setDialog(null)}
          onConfirm={async (ids) => {
            const result = await moveToGroupAction(dialog.membershipId, ids[0]);
            if (result.ok) router.refresh();
            return result.ok ? null : result.reason;
          }}
        />
      )}
    </section>
  );
}

/**
 * "Supprimer": permanent, so the name of the student must be typed (spec 5.7, invariant 15). The
 * warning about recorded payments comes with the billing (M10).
 */
export function StudentDanger({
  student,
  canWrite,
}: {
  student: StudentRow;
  canWrite: boolean;
}) {
  const t = useTranslations('students');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!canWrite) return null;

  return (
    <section
      aria-labelledby="student-danger"
      className="space-y-3 rounded-card border border-border bg-surface p-4"
    >
      <h2 id="student-danger" className="font-semibold text-primary">
        {t('dangerTitle')}
      </h2>
      <button
        type="button"
        className={secondaryButtonClass + ' !border-accent !text-accent'}
        onClick={() => setOpen(true)}
      >
        {t('delete')}
      </button>
      {open && (
        <DeleteStudentDialog
          student={student}
          onClose={() => setOpen(false)}
          onDeleted={() => {
            router.push('/eleves');
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
