'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { secondaryButtonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import {
  digitsOnly,
  matchesWordStart,
  normalizeSearch,
} from '@/lib/text/normalize';
import { DeleteGroup } from './DeleteGroup';

export type GroupRowData = {
  id: string;
  name: string;
  color: string;
  periodText: string;
  scheduleText: string;
  /** "20.000 DT par séance", or empty when there is no reference price. */
  priceText: string;
  /** The digits of the price, for the search: "20000". */
  priceDigits: string;
};

/**
 * The list of groups with its live search (spec 5.5): one input matches the name (words from
 * their start, accents and Arabic letters handled) and the price, and each result says WHY it
 * matched, so a number that is also part of a price is never ambiguous.
 */
export function GroupList({
  rows,
  readOnly,
}: {
  rows: GroupRowData[];
  readOnly: boolean;
}) {
  const t = useTranslations('groups.list');
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const text = normalizeSearch(query);
    if (text === '')
      return rows.map((row) => ({ row, reasons: [] as string[] }));
    const digits = digitsOnly(query);
    return rows.flatMap((row) => {
      const reasons: string[] = [];
      if (matchesWordStart(query, row.name)) reasons.push('name');
      if (digits !== '' && row.priceDigits.includes(digits))
        reasons.push('price');
      return reasons.length > 0 ? [{ row, reasons }] : [];
    });
  }, [rows, query]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="group-search" className="block text-sm font-medium">
          {t('searchLabel')}
        </label>
        <input
          id="group-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          className="block min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 sm:max-w-sm"
        />
      </div>

      {results.length === 0 ? (
        <p
          role="status"
          className="rounded-card border border-border bg-surface p-4 text-muted"
        >
          {query !== '' ? t('noResults') : t('empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {results.map(({ row, reasons }) => (
            <li
              key={row.id}
              className="rounded-card border border-s-4 border-border bg-surface p-4"
              style={{ borderInlineStartColor: row.color }}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 space-y-1">
                  <h2 className="text-lg font-semibold text-primary">
                    <Link
                      href={`/groupes/${row.id}`}
                      className="hover:underline"
                    >
                      {row.name}
                    </Link>
                  </h2>
                  <p className="text-sm text-muted">{row.periodText}</p>
                  <p className="text-sm">
                    <bdi>{row.scheduleText}</bdi>
                  </p>
                  <p className="text-sm text-muted">
                    {row.priceText || t('noPrice')}
                  </p>
                  <p className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">
                      {t('emptyBadge')}
                    </span>
                    {reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full border border-primary px-2 py-0.5 text-primary"
                      >
                        {t(reason === 'name' ? 'matchName' : 'matchPrice')}
                      </span>
                    ))}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/groupes/${row.id}`}
                    className={secondaryButtonClass}
                  >
                    {t('open')}
                  </Link>
                  {!readOnly && (
                    <Link
                      href={`/groupes/${row.id}/calendrier`}
                      className={secondaryButtonClass}
                    >
                      {t('changeCalendar')}
                    </Link>
                  )}
                  {!readOnly && (
                    <DeleteGroup groupId={row.id} groupName={row.name} />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
