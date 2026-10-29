'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** At most this many days are listed in full; with more, the middle ones are folded. */
const FOLD_ABOVE = 5;
const SHOWN_AT_START = 3;

export type GroupDay = { key: string; label: string; times: string };

/**
 * The days of a group in the overview card: all of them up to 5; with more, the first three, a
 * "Afficher plus" button, then the last one (the first and the last day are always visible).
 */
export function GroupDays({ days }: { days: GroupDay[] }) {
  const t = useTranslations('groups.page');
  const [open, setOpen] = useState(false);

  if (days.length === 0)
    return <p className="text-sm text-muted">{t('noDays')}</p>;

  const folded = days.length > FOLD_ABOVE && !open;
  const row = (day: GroupDay) => (
    <li key={day.key} className="flex flex-wrap items-baseline gap-x-3">
      <span className="font-medium first-letter:uppercase">{day.label}</span>
      <bdi dir="ltr" className="text-muted">
        {day.times}
      </bdi>
    </li>
  );

  return (
    <ul className="space-y-1 text-sm">
      {folded ? (
        <>
          {days.slice(0, SHOWN_AT_START).map(row)}
          <li>
            <button
              type="button"
              className="text-primary underline underline-offset-2 hover:text-accent"
              onClick={() => setOpen(true)}
            >
              {t('showMoreDays', { count: days.length - SHOWN_AT_START - 1 })}
            </button>
          </li>
          {row(days[days.length - 1])}
        </>
      ) : (
        <>
          {days.map(row)}
          {days.length > FOLD_ABOVE && (
            <li>
              <button
                type="button"
                className="text-primary underline underline-offset-2 hover:text-accent"
                onClick={() => setOpen(false)}
              >
                {t('showFewerDays')}
              </button>
            </li>
          )}
        </>
      )}
    </ul>
  );
}
