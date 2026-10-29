'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { addSessionsAction } from '@/app/[locale]/(dashboard)/dashboard-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { Link, useRouter } from '@/i18n/navigation';
import {
  addDays,
  isValidDate,
  isValidTime,
  monthOf,
  timeToMinutes,
} from '@/lib/dashboard/dates';
import { formatDay } from '@/lib/dashboard/format';
import { MAX_ADDED_SESSIONS } from '@/lib/dashboard/schedule';
import { ConflictList, type ConflictLine } from './ConflictList';
import { DayPicker } from './DayPicker';
import { conflictLinesFor } from './MoveSessionForm';

type Row = { key: number; date: string; startTime: string; endTime: string };

function rowIsValid(row: Row): boolean {
  return (
    isValidDate(row.date) &&
    isValidTime(row.startTime) &&
    isValidTime(row.endTime) &&
    timeToMinutes(row.endTime) > timeToMinutes(row.startTime)
  );
}

/**
 * "Ajouter une séance" (spec 5.3): extra sessions of one group. Each row is one day with its
 * times; "Ajouter un autre jour" adds a row, and "Ajouter" saves all the rows in one step (all
 * or nothing, an overlap is refused with the row it belongs to).
 */
export function AddSessionForm({
  groups,
  defaultGroupId,
  defaultDate,
  returnTo,
  today,
}: {
  groups: { id: string; name: string }[];
  defaultGroupId?: string;
  defaultDate: string;
  returnTo: string;
  today: string;
}) {
  const t = useTranslations('calendar.add');
  const td = useTranslations('dashboard');
  const router = useRouter();
  const locale = useLocale();

  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? '');
  const [rows, setRows] = useState<Row[]>([
    { key: 1, date: defaultDate, startTime: '08:00', endTime: '10:00' },
  ]);
  const [nextKey, setNextKey] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const [lines, setLines] = useState<ConflictLine[]>([]);
  const [conflictRows, setConflictRows] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();

  const valid = groupId !== '' && rows.every(rowIsValid);

  function patchRow(key: number, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    // The new row starts the day after the last one, with the same hours.
    const last = rows[rows.length - 1];
    const date = isValidDate(last.date) ? addDays(last.date, 1) : today;
    setRows((current) => [
      ...current,
      { key: nextKey, date, startTime: last.startTime, endTime: last.endTime },
    ]);
    setNextKey(nextKey + 1);
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function save() {
    setError(null);
    setErrorRow(null);
    setLines([]);
    setConflictRows(new Set());
    startTransition(async () => {
      const result = await addSessionsAction({
        groupId,
        sessions: rows.map(({ date, startTime, endTime }) => ({
          date,
          startTime,
          endTime,
        })),
      });
      if (result.ok) {
        const url = new URL(returnTo, 'http://local');
        url.searchParams.set('done', rows.length > 1 ? 'added_many' : 'added');
        router.push(`${url.pathname}${url.search}`);
        router.refresh();
        return;
      }
      if (
        result.reason === 'conflict' &&
        'conflicts' in result &&
        result.conflicts?.length
      ) {
        const found = result.conflicts;
        setLines(
          found.flatMap(({ index, with: other }) =>
            rows[index] ? conflictLinesFor(rows[index], [other]) : [],
          ),
        );
        setConflictRows(new Set(found.map((c) => rows[c.index]?.key)));
      }
      if ('index' in result && typeof result.index === 'number')
        setErrorRow(rows[result.index]?.key ?? null);
      setError(result.reason);
    });
  }

  if (groups.length === 0)
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
        <p className="rounded-card border border-border bg-surface p-4 text-muted">
          {t('noGroup')}
        </p>
        <Link href="/groupes/nouveau" className={buttonClass}>
          {t('createGroup')}
        </Link>
      </div>
    );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
        <p className="text-muted">{t('intro')}</p>
      </header>

      {error && error !== 'conflict' && (
        <p
          role="alert"
          className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
        >
          {td(`sessionErrors.${error}` as 'sessionErrors.invalid')}
        </p>
      )}
      <ConflictList lines={lines} />

      <div className="space-y-1">
        <label htmlFor="add-group" className="block font-medium">
          {t('group')}
        </label>
        <select
          id="add-group"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className={inputClass}
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </div>

      <ul className="space-y-3">
        {rows.map((row, index) => {
          const flagged = conflictRows.has(row.key) || errorRow === row.key;
          return (
            <li
              key={row.key}
              className={
                'rounded-card border bg-surface p-3 ' +
                (flagged ? 'border-accent' : 'border-border')
              }
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-medium">
                  {t('rowTitle', { n: index + 1 })}
                </h2>
                {rows.length > 1 && (
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => removeRow(row.key)}
                    disabled={pending}
                  >
                    {t('removeRow')}
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1 sm:col-span-3 md:col-span-1">
                  <p className="font-medium">
                    {t('date')}
                    {isValidDate(row.date) &&
                      ` : ${formatDay(row.date, locale, { dateStyle: 'medium' })}`}
                  </p>
                  <DayPicker
                    initialMonth={monthOf(
                      isValidDate(row.date) ? row.date : today,
                    )}
                    minMonth={monthOf(today)}
                    isSelected={(date) => date === row.date}
                    isDisabled={(date) => date < today}
                    onPick={(date) => patchRow(row.key, { date })}
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor={`add-start-${row.key}`}
                    className="block font-medium"
                  >
                    {t('start')}
                  </label>
                  <input
                    id={`add-start-${row.key}`}
                    type="time"
                    dir="ltr"
                    value={row.startTime}
                    onChange={(e) =>
                      patchRow(row.key, { startTime: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor={`add-end-${row.key}`}
                    className="block font-medium"
                  >
                    {t('end')}
                  </label>
                  <input
                    id={`add-end-${row.key}`}
                    type="time"
                    dir="ltr"
                    value={row.endTime}
                    onChange={(e) =>
                      patchRow(row.key, { endTime: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
              {!rowIsValid(row) && (
                <p role="alert" className="mt-2 text-sm text-accent">
                  {td('sessionErrors.invalid')}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={addRow}
          disabled={pending || rows.length >= MAX_ADDED_SESSIONS}
        >
          {t('addRow')}
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={!valid || pending}
          onClick={save}
        >
          {rows.length > 1
            ? t('confirmMany', { count: rows.length })
            : t('confirm')}
        </button>
        <Link href={returnTo} className={secondaryButtonClass}>
          {t('back')}
        </Link>
      </div>
    </div>
  );
}
