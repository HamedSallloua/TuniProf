'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { inputClass, secondaryButtonClass } from '@/components/auth/styles';
import { Link, useRouter } from '@/i18n/navigation';
import { isValidDate } from '@/lib/dashboard/dates';

/**
 * The date search of a group's sessions list. It goes to the page of that date's month without
 * reloading the page, so the changes prepared in "Modifier calendrier" are not lost. `children`
 * are extra buttons drawn next to "Rechercher".
 */
export function DateSearchForm({
  basePath,
  searched,
  children,
}: {
  basePath: string;
  searched?: string;
  children?: ReactNode;
}) {
  const t = useTranslations('groups.page.search');
  const router = useRouter();
  const [date, setDate] = useState(searched ?? '');

  return (
    <form
      role="search"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (isValidDate(date)) router.push(`${basePath}?chercher=${date}`);
      }}
    >
      <div className="space-y-1">
        <label htmlFor="date-search" className="block text-xs">
          {t('label')}
        </label>
        <input
          id="date-search"
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={inputClass + ' !w-auto'}
        />
      </div>
      <button type="submit" className={secondaryButtonClass}>
        {t('button')}
      </button>
      {children}
      {searched && (
        <Link href={basePath} className={secondaryButtonClass}>
          {t('clear')}
        </Link>
      )}
    </form>
  );
}
