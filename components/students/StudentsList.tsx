'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  addStudentToGroupsAction,
  updateStudentAction,
} from '@/app/[locale]/(dashboard)/student-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { Link, useRouter } from '@/i18n/navigation';
import type { StudentRow } from '@/lib/dashboard/students';
import { AddStudentButton } from './AddStudentOverlay';
import { ContactLinks } from './ContactLinks';
import { GroupPickerDialog, type PickableGroup } from './GroupPickerDialog';
import { DeleteStudentDialog, MoveStudentDialog } from './StudentDialogs';
import { useHighlight } from './StudentRowCard';
import { useStudentSearch } from './use-student-search';

type GroupOption = { id: string; name: string; color: string };

/**
 * One student of the list: summary and the actions Modifier, Ajouter à un groupe, Déplacer,
 * Supprimer and Ouvrir (so a student can be changed without opening their page).
 */
function StudentListRow({
  student,
  match,
  groups,
  canWrite,
  highlight,
}: {
  student: StudentRow;
  match: string | null;
  groups: GroupOption[];
  canWrite: boolean;
  highlight: boolean;
}) {
  const t = useTranslations('students');
  const router = useRouter();
  const lit = useHighlight(highlight);
  const ref = useRef<HTMLLIElement>(null);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<'add' | 'move' | 'delete' | null>(null);
  const [fullName, setFullName] = useState(student.fullName);
  const [phone, setPhone] = useState(student.phone?.replace('+216', '') ?? '');
  const [note, setNote] = useState(student.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center' });
  }, [highlight]);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateStudentAction(student.id, {
        fullName,
        phone,
        note,
      });
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else setError(result.reason);
    });
  }

  const inGroups = new Set(student.groups.map((g) => g.groupId));
  const pickable: PickableGroup[] = groups.map((g) => ({
    ...g,
    disabled: inGroups.has(g.id),
  }));

  return (
    <li
      ref={ref}
      className={
        'space-y-3 rounded-card border bg-surface p-4 transition-colors ' +
        (lit
          ? 'border-primary bg-secondary ring-2 ring-primary'
          : 'border-border')
      }
    >
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="space-y-1">
            <label
              htmlFor={`n-${student.id}`}
              className="block text-sm font-medium"
            >
              {t('fullName')}
            </label>
            <input
              id={`n-${student.id}`}
              value={fullName}
              maxLength={80}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`p-${student.id}`}
              className="block text-sm font-medium"
            >
              {t('phone')}
            </label>
            <input
              id={`p-${student.id}`}
              type="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass + ' text-start'}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`o-${student.id}`}
              className="block text-sm font-medium"
            >
              {t('note')}
            </label>
            <textarea
              id={`o-${student.id}`}
              value={note}
              maxLength={300}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
            />
          </div>
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
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-primary">
              <Link href={`/eleves/${student.id}`} className="hover:underline">
                {student.fullName}
              </Link>
            </h2>
            <ContactLinks phone={student.phone} />
            {student.note && (
              <p className="text-xs text-muted">{student.note}</p>
            )}
            <p className="flex flex-wrap gap-2 text-xs">
              {student.groups.length === 0 ? (
                <span className="rounded-full bg-secondary px-2 py-0.5">
                  {t('noGroup')}
                </span>
              ) : (
                student.groups.map((g) => (
                  <Link
                    key={g.membershipId}
                    href={`/groupes/${g.groupId}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-secondary"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: g.groupColor }}
                    />
                    {g.groupName}
                  </Link>
                ))
              )}
              {match && match !== 'name' && (
                <span className="rounded-full border border-primary px-2 py-0.5 text-primary">
                  {t(`match.${match}` as 'match.phone')}
                </span>
              )}
            </p>
            <p className="text-xs text-muted">
              {t('groupsSummary', { count: student.groups.length })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setEditing(true)}
              >
                {t('edit')}
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setDialog('add')}
              >
                {t('addToGroup')}
              </button>
            )}
            {canWrite && student.groups.length > 0 && (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setDialog('move')}
              >
                {t('move')}
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                className={
                  secondaryButtonClass + ' !border-accent !text-accent'
                }
                onClick={() => setDialog('delete')}
              >
                {t('delete')}
              </button>
            )}
            <Link
              href={`/eleves/${student.id}`}
              className={secondaryButtonClass}
            >
              {t('open')}
            </Link>
          </div>
        </div>
      )}
      {dialog === 'add' && (
        <GroupPickerDialog
          title={t('addToGroup')}
          groups={pickable}
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
      {dialog === 'move' && (
        <MoveStudentDialog
          student={student}
          groups={groups}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'delete' && (
        <DeleteStudentDialog
          student={student}
          onClose={() => setDialog(null)}
        />
      )}
    </li>
  );
}

/**
 * The Élèves list (spec 5.7): the shared live search (name, phone, note, group name), filters by
 * group, 20 students at a time. The payment-status filter and the month
 * summary come with the billing (M10).
 */
export function StudentsList({
  students,
  serverMode,
  total,
  groups,
  canWrite,
  highlightId,
}: {
  students: StudentRow[];
  serverMode: boolean;
  total: number;
  groups: GroupOption[];
  canWrite: boolean;
  /** The student just created: scrolled to and highlighted. */
  highlightId: string | null;
}) {
  const t = useTranslations('students');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [offer, setOffer] = useState(highlightId !== null);

  const filter = useCallback(
    (student: StudentRow) =>
      groupFilter === 'all'
        ? true
        : groupFilter === 'none'
          ? student.groups.length === 0
          : student.groups.some((g) => g.groupId === groupFilter),
    [groupFilter],
  );
  const found = useStudentSearch({
    students,
    serverMode,
    query,
    filter,
  });
  const justAdded = highlightId
    ? students.find((s) => s.id === highlightId)
    : undefined;
  const [pickFor, setPickFor] = useState(false);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
        {canWrite && (
          <AddStudentButton
            groupId={null}
            groupName=""
            students={students}
            serverMode={serverMode}
            memberIds={[]}
            className={buttonClass + ' gap-2'}
            label={t('addStudent')}
          />
        )}
      </header>

      {offer && justAdded && canWrite && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
        >
          {t('studentAdded', { name: justAdded.fullName })}
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setPickFor(true)}
          >
            {t('addToGroup')}
          </button>
        </p>
      )}
      {pickFor && justAdded && (
        <GroupPickerDialog
          title={t('addToGroup')}
          groups={groups.map((g) => ({
            ...g,
            disabled: justAdded.groups.some((x) => x.groupId === g.id),
          }))}
          multiple
          confirmLabel={t('addToGroups')}
          onClose={() => {
            setPickFor(false);
            setOffer(false);
          }}
          onConfirm={async (ids) => {
            const result = await addStudentToGroupsAction(justAdded.id, ids);
            if (result.ok) router.refresh();
            return result.ok ? null : result.reason;
          }}
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1 sm:max-w-sm">
          <label
            htmlFor="students-search"
            className="block text-sm font-medium"
          >
            {t('searchLabel')}
          </label>
          <input
            id="students-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="students-group" className="block text-sm font-medium">
            {t('filterGroup')}
          </label>
          <select
            id="students-group"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className={inputClass + ' !w-auto'}
          >
            <option value="all">{t('allGroups')}</option>
            <option value="none">{t('noGroup')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p role="status" className="text-sm text-muted">
        {found.loading
          ? t('searching')
          : t('resultCount', { count: found.total, all: total })}
      </p>

      {found.results.length === 0 && !found.loading ? (
        <p className="rounded-card border border-border bg-surface p-4 text-muted">
          {total === 0 ? t('empty') : t('noResults')}
        </p>
      ) : (
        <ul className="space-y-3">
          {found.results.map(({ student, match }) => (
            <StudentListRow
              key={student.id}
              student={student}
              match={match}
              groups={groups}
              canWrite={canWrite}
              highlight={student.id === highlightId}
            />
          ))}
        </ul>
      )}
      {found.hasMore && (
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={found.showMore}
        >
          {t('showMore')}
        </button>
      )}
    </div>
  );
}
