'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { saveGroupStudentsAction } from '@/app/[locale]/(dashboard)/student-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { Link, useRouter } from '@/i18n/navigation';
import type { StudentRow } from '@/lib/dashboard/students';
import { formatNationalPhone } from '@/lib/phone';
import { cleanStudent } from '@/lib/students/clean';
import { AddStudentOverlay } from './AddStudentOverlay';
import { ContactLinks } from './ContactLinks';
import { StudentActions } from './StudentActions';
import type { GroupMember } from './student-types';
import { useStudentSearch } from './use-student-search';

/** What is typed for one student; the phone without +216, as when it is edited. */
type Draft = { fullName: string; phone: string; note: string };
type NewRow = Draft & { key: number };

const originalOf = (member: StudentRow): Draft => ({
  fullName: member.fullName,
  phone: member.phone?.replace('+216', '') ?? '',
  note: member.note ?? '',
});
const sameDraft = (a: Draft, b: Draft) =>
  a.fullName === b.fullName && a.phone === b.phone && a.note === b.note;

/** The first problem of what is typed (name, phone, note), or null. */
const problemOf = (draft: Draft) => {
  const result = cleanStudent(draft);
  return result.ok ? null : result.reason;
};

/**
 * "Modifier liste d'élèves" of a group (owner request after M9), like "Modifier calendrier": the
 * students are edited here, nothing is saved before "Enregistrer la liste", and everything is
 * saved in one step (all or nothing). The teacher can change a student's name, phone and note,
 * take students out of the group, add existing students and create new ones.
 */
export function EditGroupStudents({
  group,
  members,
  students,
  serverMode,
  allGroups,
}: {
  group: { id: string; name: string; color: string };
  members: GroupMember[];
  /** For the "Ajouter des élèves" overlay: every student (or the first ones, in server mode). */
  students: StudentRow[];
  serverMode: boolean;
  /** For "Déplacer" and "Ajouter à un autre groupe" on the student cards. */
  allGroups: { id: string; name: string; color: string }[];
}) {
  const t = useTranslations('students');
  const router = useRouter();

  const [removed, setRemoved] = useState<string[]>([]); // membership ids
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); // student id -> typed values
  const [added, setAdded] = useState<StudentRow[]>([]);
  const [fresh, setFresh] = useState<NewRow[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [query, setQuery] = useState('');
  const [overlay, setOverlay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the server said about one row: `edited:<student id>` or `new:<key>`.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<Record<number, StudentRow>>({});
  const [pending, startTransition] = useTransition();

  const draftOf = (member: StudentRow) =>
    drafts[member.id] ?? originalOf(member);
  const isRemoved = (member: GroupMember) =>
    removed.includes(member.membershipId);
  const changed = members.filter(
    (m) =>
      !isRemoved(m) && drafts[m.id] && !sameDraft(drafts[m.id], originalOf(m)),
  );
  const dirty =
    removed.length > 0 ||
    changed.length > 0 ||
    added.length > 0 ||
    fresh.length > 0;

  const problems =
    changed.some((m) => problemOf(drafts[m.id]) !== null) ||
    fresh.some((row) => problemOf(row) !== null);

  // The browser's own warning when the page is closed with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // The search works on what is typed now, so a name just changed is found by its new name.
  const searchable = useMemo(
    () =>
      members.map((m) => {
        const d = drafts[m.id];
        return d ? { ...m, fullName: d.fullName, note: d.note || null } : m;
      }),
    [members, drafts],
  );
  const found = useStudentSearch({
    students: searchable,
    serverMode: false,
    query,
  });
  const memberById = new Map(members.map((m) => [m.id, m]));

  const setDraft = (member: StudentRow, patch: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [member.id]: { ...draftOf(member), ...patch },
    }));
  const stagedChange = () => {
    setError(null);
    setRowErrors({});
    setDuplicates({});
  };

  function save(rows: NewRow[] = fresh) {
    setError(null);
    setRowErrors({});
    setDuplicates({});
    startTransition(async () => {
      const result = await saveGroupStudentsAction(group.id, {
        removeMembershipIds: removed,
        addStudentIds: added.map((s) => s.id),
        newStudents: rows.map((r) => ({
          fullName: r.fullName,
          phone: r.phone,
          note: r.note,
        })),
        editedStudents: changed.map((m) => ({
          studentId: m.id,
          ...drafts[m.id],
        })),
      });
      if (result.ok && 'created' in result) {
        router.push(`/groupes/${group.id}`);
        router.refresh();
        return;
      }
      if (result.ok) return;
      if (result.reason === 'duplicate' && 'existing' in result) {
        if (result.list === 'new') {
          const row = rows[result.index];
          if (row) setDuplicates({ [row.key]: result.existing });
        } else {
          setRowErrors({
            [`edited:${changed[result.index]?.id}`]: 'duplicate',
          });
        }
        return;
      }
      if ('list' in result && result.list && typeof result.index === 'number') {
        const key =
          result.list === 'new'
            ? `new:${rows[result.index]?.key}`
            : `edited:${changed[result.index]?.id}`;
        setRowErrors({ [key]: result.reason });
        return;
      }
      setError(result.reason);
    });
  }

  function takeExisting(row: NewRow, existing: StudentRow) {
    // The student already exists: take them instead of creating a second one.
    setFresh((current) => current.filter((r) => r.key !== row.key));
    const inGroup =
      members.some((m) => m.id === existing.id) ||
      added.some((a) => a.id === existing.id);
    if (!inGroup) setAdded((current) => [...current, existing]);
    stagedChange();
  }

  function reset() {
    setRemoved([]);
    setDrafts({});
    setAdded([]);
    setFresh([]);
    stagedChange();
  }

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: { type?: 'tel'; max?: number; multiline?: boolean } = {},
  ) => (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      {options.multiline ? (
        <textarea
          id={id}
          value={value}
          rows={2}
          maxLength={options.max}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      ) : (
        <input
          id={id}
          type={options.type ?? 'text'}
          dir={options.type === 'tel' ? 'ltr' : undefined}
          value={value}
          maxLength={options.max}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass + (options.type === 'tel' ? ' text-start' : '')}
        />
      )}
    </div>
  );
  const problemText = (code: string | null | undefined) =>
    code ? (
      <p role="alert" className="text-sm text-accent">
        {t(`errors.${code}` as 'errors.invalid_name')}
      </p>
    ) : null;

  const counts = {
    added: added.length,
    created: fresh.length,
    removed: removed.length,
    edited: changed.length,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm">
          <Link
            href={`/groupes/${group.id}`}
            className="text-primary underline underline-offset-2"
          >
            {t('backToGroup')}
          </Link>
        </p>
        <h1 className="flex items-center gap-3 text-2xl font-bold text-primary">
          <span
            aria-hidden="true"
            className="inline-block size-4 rounded-full"
            style={{ backgroundColor: group.color }}
          />
          {t('editListTitle', { group: group.name })}
        </h1>
        <p className="text-muted">{t('editListIntro')}</p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
        >
          {t(`errors.${error}` as 'errors.invalid_name')}
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        {members.length > 1 ? (
          <div className="min-w-0 flex-1 space-y-1 sm:max-w-sm">
            <label
              htmlFor="edit-list-search"
              className="block text-sm font-medium"
            >
              {t('searchInGroup')}
            </label>
            <input
              id="edit-list-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className={inputClass}
            />
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          className={buttonClass}
          onClick={() => setOverlay(true)}
        >
          {t('addStudents')}
        </button>
      </div>

      {/* ------------------------------------------------------ the students of the group */}
      <section aria-labelledby="current-students" className="space-y-3">
        <h2
          id="current-students"
          className="text-lg font-semibold text-primary"
        >
          {t('currentStudents')}
          <span className="ms-2 text-sm font-normal text-muted">
            ({members.length})
          </span>
        </h2>
        {members.length > 0 && (
          <p className="text-sm text-muted">{t('rowActionsHint')}</p>
        )}
        {members.length === 0 ? (
          <p className="rounded-card border border-border bg-surface p-4 text-muted">
            {t('noStudentsInGroup')}
          </p>
        ) : found.results.length === 0 ? (
          <p
            role="status"
            className="rounded-card border border-border bg-surface p-4 text-muted"
          >
            {t('noResults')}
          </p>
        ) : (
          <ul className="space-y-3">
            {found.results.map(({ student }) => {
              const member = memberById.get(student.id) as GroupMember;
              const draft = draftOf(member);
              const gone = isRemoved(member);
              const edited = changed.some((m) => m.id === member.id);
              const serverProblem = rowErrors[`edited:${member.id}`];
              return (
                <li
                  key={member.membershipId}
                  className={
                    'space-y-3 rounded-card border bg-surface p-4 ' +
                    (gone
                      ? 'border-dashed border-border bg-secondary'
                      : edited
                        ? 'border-primary'
                        : 'border-border')
                  }
                >
                  {gone ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p>
                        <span className="font-medium line-through">
                          {member.fullName}
                        </span>{' '}
                        <span className="text-sm text-accent">
                          {t('willBeRemoved')}
                        </span>
                      </p>
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        onClick={() => {
                          setRemoved((c) =>
                            c.filter((id) => id !== member.membershipId),
                          );
                          stagedChange();
                        }}
                      >
                        {t('undoRemove')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {field(
                          `ed-name-${member.id}`,
                          t('fullName'),
                          draft.fullName,
                          (v) => {
                            setDraft(member, { fullName: v });
                            stagedChange();
                          },
                          { max: 80 },
                        )}
                        {field(
                          `ed-phone-${member.id}`,
                          t('phone'),
                          draft.phone,
                          (v) => {
                            setDraft(member, { phone: v });
                            stagedChange();
                          },
                          { type: 'tel' },
                        )}
                        {field(
                          `ed-note-${member.id}`,
                          t('note'),
                          draft.note,
                          (v) => {
                            setDraft(member, { note: v });
                            stagedChange();
                          },
                          { multiline: true, max: 300 },
                        )}
                      </div>
                      {problemText(edited ? problemOf(draft) : null)}
                      {problemText(serverProblem)}
                      <div className="flex flex-wrap items-center gap-3">
                        <ContactLinks phone={member.phone} />
                        {edited && (
                          <span className="rounded-full border border-primary px-2 py-0.5 text-xs text-primary">
                            {t('changedBadge')}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          onClick={() => {
                            setRemoved((c) => [...c, member.membershipId]);
                            stagedChange();
                          }}
                        >
                          {t('removeFromGroup')}
                        </button>
                        <StudentActions
                          member={member}
                          groupId={group.id}
                          allGroups={allGroups}
                        />
                      </div>
                    </>
                  )}
                </li>
              );
            })}
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
      </section>

      {/* ----------------------------------------------- existing students to be added */}
      {added.length > 0 && (
        <section aria-labelledby="added-students" className="space-y-3">
          <h2
            id="added-students"
            className="text-lg font-semibold text-primary"
          >
            {t('addedStudents')}
          </h2>
          <ul className="space-y-2">
            {added.map((student) => (
              <li
                key={student.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-primary bg-surface p-3"
              >
                <p>
                  <span className="font-medium">{student.fullName}</span>
                  {student.phone && (
                    <span className="ms-3 text-sm text-muted">
                      <bdi dir="ltr">{formatNationalPhone(student.phone)}</bdi>
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => {
                    setAdded((c) => c.filter((s) => s.id !== student.id));
                    stagedChange();
                  }}
                >
                  {t('unstage')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------- new students */}
      {fresh.length > 0 && (
        <section aria-labelledby="new-students" className="space-y-3">
          <h2 id="new-students" className="text-lg font-semibold text-primary">
            {t('newStudents')}
          </h2>
          <ul className="space-y-3">
            {fresh.map((row) => {
              const update = (patch: Partial<Draft>) => {
                setFresh((c) =>
                  c.map((r) => (r.key === row.key ? { ...r, ...patch } : r)),
                );
                stagedChange();
              };
              const duplicate = duplicates[row.key];
              return (
                <li
                  key={row.key}
                  className="space-y-3 rounded-card border border-primary bg-surface p-4"
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    {field(
                      `new-name-${row.key}`,
                      t('fullName'),
                      row.fullName,
                      (v) => update({ fullName: v }),
                      { max: 80 },
                    )}
                    {field(
                      `new-phone-${row.key}`,
                      t('phoneOptional'),
                      row.phone,
                      (v) => update({ phone: v }),
                      { type: 'tel' },
                    )}
                    {field(
                      `new-note-${row.key}`,
                      t('noteOptional'),
                      row.note,
                      (v) => update({ note: v }),
                      { multiline: true, max: 300 },
                    )}
                  </div>
                  {problemText(problemOf(row))}
                  {problemText(rowErrors[`new:${row.key}`])}
                  {duplicate && (
                    <div
                      role="alert"
                      className="space-y-2 rounded-md border border-accent bg-secondary p-3 text-sm"
                    >
                      <p className="font-medium text-accent">
                        {t('duplicateWarning', { name: duplicate.fullName })}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => takeExisting(row, duplicate)}
                        >
                          {t('useExisting')}
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => {
                      setFresh((c) => c.filter((r) => r.key !== row.key));
                      stagedChange();
                    }}
                  >
                    {t('unstage')}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ---------------------------------------------------------------- the buttons */}
      {dirty && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p role="status">{t('listSummary', counts)}</p>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={reset}
          >
            {t('adjustReset')}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={!dirty || problems || pending}
          onClick={() => save()}
        >
          {pending ? t('savingList') : t('saveList')}
        </button>
        <Link href={`/groupes/${group.id}`} className={secondaryButtonClass}>
          {t('back')}
        </Link>
      </div>

      {overlay && (
        <AddStudentOverlay
          groupId={group.id}
          groupName={group.name}
          students={students}
          serverMode={serverMode}
          memberIds={[...members.map((m) => m.id), ...added.map((a) => a.id)]}
          stage={{
            onAddExisting: (chosen) => {
              setAdded((current) => [
                ...current,
                ...chosen.filter((s) => !current.some((c) => c.id === s.id)),
              ]);
              stagedChange();
            },
            onAddNew: (input) => {
              setFresh((current) => [...current, { ...input, key: nextKey }]);
              setNextKey((n) => n + 1);
              stagedChange();
            },
          }}
          onClose={() => setOverlay(false)}
        />
      )}
    </div>
  );
}
