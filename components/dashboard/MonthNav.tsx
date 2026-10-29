import { useLocale, useTranslations } from 'next-intl';
import { secondaryButtonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import { addMonths, monthOf } from '@/lib/dashboard/dates';
import { monthTitle } from '@/lib/dashboard/format';

/**
 * The month arrows of a group's "Modifier calendrier" page, centred above the calendar. They
 * change the month of the calendar AND of the sessions list below it (both follow `?mois=`).
 */
export function MonthNav({
  basePath,
  month,
}: {
  basePath: string;
  month: string;
}) {
  const t = useTranslations('groups.page');
  const locale = useLocale();
  const prev = monthOf(addMonths(`${month}-01`, -1));
  const next = monthOf(addMonths(`${month}-01`, 1));

  return (
    <nav
      aria-label={t('monthNav')}
      className="flex items-center justify-center gap-2"
    >
      <Link
        href={`${basePath}?mois=${prev}`}
        className={secondaryButtonClass}
        aria-label={t('previousMonth')}
      >
        ‹
      </Link>
      <span className="inline-block min-w-36 text-center font-medium first-letter:uppercase">
        {monthTitle(month, locale)}
      </span>
      <Link
        href={`${basePath}?mois=${next}`}
        className={secondaryButtonClass}
        aria-label={t('nextMonth')}
      >
        ›
      </Link>
    </nav>
  );
}
