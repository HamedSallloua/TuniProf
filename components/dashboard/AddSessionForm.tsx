'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { addSessionAction } from '@/app/[locale]/(dashboard)/dashboard-actions';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { Link, useRouter } from '@/i18n/navigation';
import { isValidDate, isValidTime, timeToMinutes } from '@/lib/dashboard/dates';
import { ConflictList, type ConflictLine } from './ConflictList';
import { conflictLinesFor } from './MoveSessionForm';

/** "Ajouter une séance" (spec 5.3): one extra session of one group, on a date and a time. */
export function AddSessionForm({
  groups,
  defaultDate,
  returnTo,
  today,
}: {
  groups: { id: string; name: string }[];
  defaultDate: string;
  returnTo: string;
  today: string;
}) {
  const t = useTranslations('calendar.add');
  const td = useTranslations('dashboard');
  const router = useRouter();

  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [slot, setSlot] = useState({
    date: defaultDate,
    startTime: '08:00',
    endTime: '10:00',
  });
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ConflictLine[]>([]);
  const [pending, startTransition] = useTransition();

  const valid =
    groupId !== '' &&
    isValidDate(slot.date) &&
    isValidTime(slot.startTime) &&
    isValidTime(slot.endTime) &&
    timeToMinutes(slot.endTime) > timeToMinutes(slot.startTime);

  function save() {
    setError(null);
    setLines([]);
    startTransition(async () => {
      const result = await addSessionAction({ groupId, ...slot });
      if (result.ok) {
        const url = new URL(returnTo, 'http://local');
        url.searchParams.set('done', 'added');
        router.push(`${url.pathname}${url.search}`);
        router.refresh();
        return;
      }
      if (
        result.reason === 'conflict' &&
        'conflicts' in result &&
        result.conflicts?.length
      )
        setLines(conflictLinesFor(slot, result.conflicts));
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
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
        <div className="space-y-1">
          <label htmlFor="add-date" className="block font-medium">
            {t('date')}
          </label>
          <input
            id="add-date"
            type="date"
            min={today}
            value={slot.date}
            onChange={(e) =>
              setSlot((current) => ({ ...current, date: e.target.value }))
            }
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="add-start" className="block font-medium">
              {t('start')}
            </label>
            <input
              id="add-start"
              type="time"
              dir="ltr"
              value={slot.startTime}
              onChange={(e) =>
                setSlot((current) => ({
                  ...current,
                  startTime: e.target.value,
                }))
              }
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="add-end" className="block font-medium">
              {t('end')}
            </label>
            <input
              id="add-end"
              type="time"
              dir="ltr"
              value={slot.endTime}
              onChange={(e) =>
                setSlot((current) => ({ ...current, endTime: e.target.value }))
              }
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={!valid || pending}
          onClick={save}
        >
          {t('confirm')}
        </button>
        <Link href={returnTo} className={secondaryButtonClass}>
          {t('back')}
        </Link>
      </div>
    </div>
  );
}
