'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import {
  addStudentsToGroupAction,
  createStudentAction,
} from '@/app/[locale]/(dashboard)/student-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { Link, useRouter } from '@/i18n/navigation';
import type { StudentRow } from '@/lib/dashboard/students';
import { formatNationalPhone, normalizePhone } from '@/lib/phone';
import type { MatchKind } from '@/lib/students/search';
import { useStudentSearch, type StudentResult } from './use-student-search';

const MAX_SUGGESTIONS = 5;

/** One student in a list of results: name, phone, groups, and why it matched. */
export function StudentSummary({
  student,
  match,
}: {
  student: StudentRow;
  match: MatchKind | null;
}) {
  const t = useTranslations('students');
  return (
    <span className="block min-w-0 flex-1 text-start">
      <span className="block font-medium">{student.fullName}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        {student.phone && (
          <bdi dir="ltr">{formatNationalPhone(student.phone)}</bdi>
        )}
        {student.groupNames.length > 0 ? (
          <span>{student.groupNames.join(', ')}</span>
        ) : (
          <span>{t('noGroup')}</span>
        )}
        {match && match !== 'name' && (
          <span className="rounded-full border border-primary px-2 text-primary">
            {t(`match.${match}`)}
          </span>
        )}
      </span>
      {student.note && (
        <span className="block truncate text-xs text-muted">
          {student.note}
        </span>
      )}
    </span>
  );
}

/**
 * "Ajouter élève" (spec 5.6). Two options in one overlay:
 *  1. an existing student: a live search, the students touched are kept as chips while the
 *     search goes on, and "Ajouter les élèves (n)" adds them all at once;
 *  2. a new student: name, then phone and note. Every field is itself a search of the existing
 *     students, and touching a suggestion switches to option 1 with that student selected, so
 *     nobody is created twice. A student with the same name and phone asks for confirmation.
 * Without a group (`groupId` null, from the Élèves section) only option 2 exists, and it
 * creates the student without a group.
 * With `stage` (the page "Modifier liste d'élèves") nothing is saved here: the choices are
 * handed back to the page, which saves everything together.
 */
export function AddStudentOverlay({
  groupId,
  groupName,
  students,
  serverMode,
  memberIds,
  stage,
  onClose,
}: {
  groupId: string | null;
  groupName: string;
  /** Every student (or the first ones, in server mode). */
  students: StudentRow[];
  serverMode: boolean;
  /** The students already in this group: shown, not selectable. */
  memberIds: string[];
  /** Prepare only: hand back the students chosen and the new student typed. */
  stage?: {
    onAddExisting: (students: StudentRow[]) => void;
    onAddNew: (student: {
      fullName: string;
      phone: string;
      note: string;
    }) => void;
  };
  onClose: () => void;
}) {
  const t = useTranslations('students');
  const router = useRouter();
  const members = useMemo(() => new Set(memberIds), [memberIds]);

  const [mode, setMode] = useState<'existing' | 'new'>(
    groupId === null ? 'new' : 'existing',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ------------------------------------------------------------ option 1: existing students
  const [selected, setSelected] = useState<StudentRow[]>([]);
  const [query, setQuery] = useState('');
  const found = useStudentSearch({ students, serverMode, query });

  const isSelected = (id: string) => selected.some((s) => s.id === id);
  const toggle = (student: StudentRow) =>
    setSelected((current) =>
      current.some((s) => s.id === student.id)
        ? current.filter((s) => s.id !== student.id)
        : [...current, student],
    );

  function addSelected() {
    if (groupId === null) return;
    if (stage) {
      stage.onAddExisting(selected);
      onClose();
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addStudentsToGroupAction(
        groupId,
        selected.map((s) => s.id),
      );
      if (result.ok) {
        router.push(
          `/groupes/${groupId}?nouveaux=${selected.map((s) => s.id).join(',')}`,
        );
        router.refresh();
        onClose();
      } else setError(result.reason);
    });
  }

  // ---------------------------------------------------------------- option 2: a new student
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [duplicate, setDuplicate] = useState<StudentRow | null>(null);
  // Every field is a search: the name in step 1, the phone in step 2.
  const suggestions = useStudentSearch({
    students,
    serverMode,
    query: step === 1 ? name : phone,
  });
  const showSuggestions: StudentResult[] = (
    step === 1 ? name.trim().length >= 2 : phone.trim().length >= 2
  )
    ? suggestions.results.slice(0, MAX_SUGGESTIONS)
    : [];

  /** "Use this student": option 1 with them selected (or their page, from the Élèves section). */
  function chooseExisting(student: StudentRow) {
    if (groupId === null) {
      router.push(`/eleves/${student.id}`);
      onClose();
      return;
    }
    setSelected((current) =>
      current.some((s) => s.id === student.id)
        ? current
        : [...current, student],
    );
    // The new-student form starts afresh: nobody is created by tapping a suggestion.
    setDuplicate(null);
    setError(null);
    setStep(1);
    setName('');
    setPhone('');
    setNote('');
    setQuery('');
    setMode('existing');
  }

  function create(force: boolean) {
    setError(null);
    if (stage) {
      // Nothing is created yet: the page checks the phone now and saves everything later.
      if (phone.trim() !== '' && normalizePhone(phone) === null) {
        setError('invalid_phone');
        return;
      }
      stage.onAddNew({ fullName: name, phone, note });
      onClose();
      return;
    }
    startTransition(async () => {
      const result = await createStudentAction({
        fullName: name,
        phone,
        note,
        groupId,
        force,
      });
      if (result.ok && 'studentId' in result) {
        router.push(
          groupId === null
            ? `/eleves?nouveau=${result.studentId}`
            : `/groupes/${groupId}?nouveaux=${result.studentId}`,
        );
        router.refresh();
        onClose();
      } else if (
        !result.ok &&
        result.reason === 'duplicate' &&
        'existing' in result
      ) {
        setDuplicate(result.existing);
      } else if (!result.ok) {
        if (result.reason === 'invalid_name') setStep(1);
        setError(result.reason);
      }
    });
  }

  const title =
    groupId === null ? t('newStudent') : t('addTitle', { group: groupName });
  const tab = (active: boolean) =>
    'min-h-11 flex-1 rounded-md border px-3 text-sm font-medium ' +
    (active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border text-primary hover:bg-secondary');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-card bg-surface sm:rounded-card">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <h2 className="text-lg font-semibold text-primary">{title}</h2>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={onClose}
            autoFocus
          >
            {t('close')}
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {groupId !== null && (
            <div className="flex gap-2" role="group" aria-label={title}>
              <button
                type="button"
                className={tab(mode === 'existing')}
                aria-pressed={mode === 'existing'}
                onClick={() => setMode('existing')}
              >
                {t('optionExisting')}
              </button>
              <button
                type="button"
                className={tab(mode === 'new')}
                aria-pressed={mode === 'new'}
                onClick={() => setMode('new')}
              >
                {t('optionNew')}
              </button>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
            >
              {t(`errors.${error}` as 'errors.invalid_name')}
            </p>
          )}

          {/* ------------------------------------------------ option 1: existing students */}
          {mode === 'existing' && (
            <>
              <div className="space-y-1">
                <label
                  htmlFor="student-search"
                  className="block text-sm font-medium"
                >
                  {t('searchLabel')}
                </label>
                <input
                  id="student-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className={inputClass}
                />
              </div>

              {selected.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label={t('selected')}>
                  {selected.map((student) => (
                    <li
                      key={student.id}
                      className="inline-flex items-center gap-1 rounded-full bg-primary py-1 ps-3 pe-1 text-sm text-primary-foreground"
                    >
                      {student.fullName}
                      <button
                        type="button"
                        onClick={() => toggle(student)}
                        aria-label={t('unselect', { name: student.fullName })}
                        className="flex size-7 items-center justify-center rounded-full hover:bg-white/20"
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {students.length === 0 ? (
                <p className="rounded-card border border-border p-3 text-sm text-muted">
                  {t('noStudentsYet')}
                </p>
              ) : found.results.length === 0 && !found.loading ? (
                <p role="status" className="text-sm text-muted">
                  {t('noResults')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {found.results.map(({ student, match }) => {
                    const already = members.has(student.id);
                    const chosen = isSelected(student.id);
                    return (
                      <li key={student.id}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={chosen}
                          disabled={already}
                          onClick={() => toggle(student)}
                          className={
                            'flex min-h-11 w-full items-center gap-3 rounded-md border p-2 ' +
                            (chosen
                              ? 'border-primary bg-secondary'
                              : 'border-border') +
                            (already ? ' opacity-60' : ' hover:bg-secondary')
                          }
                        >
                          <span
                            aria-hidden="true"
                            className={
                              'flex size-6 shrink-0 items-center justify-center rounded border text-sm ' +
                              (chosen
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border')
                            }
                          >
                            {chosen ? '✓' : ''}
                          </span>
                          <StudentSummary student={student} match={match} />
                          {already && (
                            <span className="text-xs text-muted">
                              {t('alreadyInGroup')}
                            </span>
                          )}
                        </button>
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
            </>
          )}

          {/* --------------------------------------------------- option 2: a new student */}
          {mode === 'new' && (
            <div className="space-y-4">
              {duplicate ? (
                <div
                  role="alert"
                  className="space-y-3 rounded-md border border-accent bg-secondary p-3 text-sm"
                >
                  <p className="font-medium text-accent">
                    {t('duplicateWarning', { name: duplicate.fullName })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => chooseExisting(duplicate)}
                    >
                      {t('useExisting')}
                    </button>
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={pending}
                      onClick={() => create(true)}
                    >
                      {t('createAnyway')}
                    </button>
                  </div>
                </div>
              ) : step === 1 ? (
                <div className="space-y-1">
                  <label
                    htmlFor="new-name"
                    className="block text-sm font-medium"
                  >
                    {t('fullName')}
                  </label>
                  <input
                    id="new-name"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClass}
                    autoComplete="off"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label
                      htmlFor="new-phone"
                      className="block text-sm font-medium"
                    >
                      {t('phoneOptional')}
                    </label>
                    <input
                      id="new-phone"
                      type="tel"
                      dir="ltr"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={inputClass + ' text-start'}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="new-note"
                      className="block text-sm font-medium"
                    >
                      {t('noteOptional')}
                    </label>
                    <textarea
                      id="new-note"
                      value={note}
                      maxLength={300}
                      rows={2}
                      onChange={(e) => setNote(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              {!duplicate && showSuggestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('suggestionsTitle')}</p>
                  <ul className="space-y-2">
                    {showSuggestions.map(({ student, match }) => (
                      <li key={student.id}>
                        {groupId !== null && members.has(student.id) ? (
                          <span className="flex items-center gap-3 rounded-md border border-border p-2 opacity-60">
                            <StudentSummary student={student} match={match} />
                            <span className="text-xs text-muted">
                              {t('alreadyInGroup')}
                            </span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => chooseExisting(student)}
                            className="flex min-h-11 w-full items-center gap-3 rounded-md border border-border p-2 hover:bg-secondary"
                          >
                            <StudentSummary student={student} match={match} />
                            <span className="text-xs font-medium text-primary">
                              {t('useThisStudent')}
                            </span>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {suggestions.hasMore && groupId === null && (
                    <Link
                      href="/eleves"
                      className="text-sm text-primary underline underline-offset-2"
                    >
                      {t('seeAll')}
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- the bottom button */}
        <div className="flex flex-wrap gap-2 border-t border-border p-4">
          {mode === 'existing' && (
            <button
              type="button"
              className={buttonClass + ' w-full sm:w-auto'}
              disabled={selected.length === 0 || pending}
              onClick={addSelected}
            >
              {t('addSelected', { count: selected.length })}
            </button>
          )}
          {mode === 'new' && !duplicate && step === 1 && (
            <button
              type="button"
              className={buttonClass}
              disabled={name.trim().length < 2}
              onClick={() => setStep(2)}
            >
              {t('next')}
            </button>
          )}
          {mode === 'new' && !duplicate && step === 2 && (
            <>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={pending}
                onClick={() => setStep(1)}
              >
                {t('back')}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={pending}
                onClick={() => create(false)}
              >
                {phone.trim() === '' ? t('skipAndConfirm') : t('confirm')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The "Ajouter élève" button with its overlay (groups list and group page). */
export function AddStudentButton({
  groupId,
  groupName,
  students,
  serverMode,
  memberIds,
  className,
  label,
}: {
  groupId: string | null;
  groupName: string;
  students: StudentRow[];
  serverMode: boolean;
  memberIds: string[];
  className: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <AddStudentOverlay
          groupId={groupId}
          groupName={groupName}
          students={students}
          serverMode={serverMode}
          memberIds={memberIds}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
