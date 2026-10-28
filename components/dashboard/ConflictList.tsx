import { useLocale, useTranslations } from 'next-intl';
import { shortDay } from '@/lib/dashboard/format';

export type ConflictLine = {
  date: string;
  startTime: string;
  endTime: string;
  groupName: string;
  otherStart: string;
  otherEnd: string;
};

/**
 * "Lun. 14 sept. 08:00-10:00 chevauche Groupe B 09:00-11:00" (spec 5.2, acceptance test 1):
 * what is in the way, one line each. Used by the wizard, the calendar change, and the screens
 * that move or add a session.
 */
export function ConflictList({ lines }: { lines: ConflictLine[] }) {
  const t = useTranslations('dashboard.conflict');
  const locale = useLocale();
  if (lines.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
    >
      <p className="font-semibold">{t('title', { count: lines.length })}</p>
      <ul className="mt-1 list-disc space-y-0.5 ps-5">
        {lines.map((line, index) => (
          <li key={`${line.date}-${line.startTime}-${index}`}>
            {t('line', {
              day: shortDay(line.date, locale),
              time: `${line.startTime}-${line.endTime}`,
              group: line.groupName,
              existing: `${line.otherStart}-${line.otherEnd}`,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
