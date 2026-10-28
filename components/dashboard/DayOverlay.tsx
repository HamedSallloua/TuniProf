import { getTranslations } from 'next-intl/server';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';
import { PlusIcon } from '@/components/ui/icons';
import { Link } from '@/i18n/navigation';
import { isPast } from '@/lib/dashboard/dates';
import { formatDay } from '@/lib/dashboard/format';
import type { SessionRow } from '@/lib/dashboard/sessions';
import { DayTimeline } from './DayTimeline';
import { SessionActions } from './SessionActions';

/**
 * The day overlay (spec 5.4), opened by a day of the calendar: the hourly timeline of every
 * group that day, then one row per session with "Supprimer" and "Modifier date", and
 * "Ajouter une séance" at the bottom. Cancelled sessions are greyed with "Restaurer".
 */
export async function DayOverlay({
  date,
  sessions,
  locale,
  closeHref,
  addHref,
  returnTo,
  canWrite,
  now,
}: {
  date: string;
  sessions: SessionRow[];
  locale: string;
  closeHref: string;
  addHref: string;
  returnTo: string;
  canWrite: boolean;
  now: Date;
}) {
  const t = await getTranslations('calendar.day');
  const tr = await getTranslations('calendar.row');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={formatDay(date, locale, { dateStyle: 'full' })}
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <div className="max-h-[88dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-card bg-surface p-4 sm:rounded-card">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-primary first-letter:uppercase">
            {formatDay(date, locale, { dateStyle: 'full' })}
          </h2>
          <Link href={closeHref} className={secondaryButtonClass} autoFocus>
            {t('close')}
          </Link>
        </div>

        {sessions.length === 0 ? (
          <p className="text-muted">{t('empty')}</p>
        ) : (
          <>
            <DayTimeline
              ariaLabel={t('timeline')}
              items={sessions.map((s) => ({
                id: s.id,
                label: s.groupName,
                startTime: s.startTime,
                endTime: s.endTime,
                color: s.groupColor,
                muted: s.status === 'cancelled',
              }))}
            />
            <ul className="space-y-2">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className={
                    'flex flex-wrap items-center justify-between gap-2 rounded-md border border-s-4 border-border p-3 ' +
                    (session.status === 'cancelled' ? 'opacity-60' : '')
                  }
                  style={{ borderInlineStartColor: session.groupColor }}
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      <Link
                        href={`/groupes/${session.groupId}`}
                        className="hover:underline"
                      >
                        {session.groupName}
                      </Link>
                    </p>
                    <p className="text-sm text-muted">
                      <bdi dir="ltr">
                        {session.startTime}-{session.endTime}
                      </bdi>
                      {session.status === 'cancelled' &&
                        ` · ${tr('cancelled')}`}
                      {session.origin === 'moved' && ` · ${tr('moved')}`}
                      {session.origin === 'extra' && ` · ${tr('extra')}`}
                      {isPast(session, now) &&
                        session.status === 'scheduled' &&
                        ` · ${tr('locked')}`}
                    </p>
                  </div>
                  <SessionActions
                    session={session}
                    returnTo={returnTo}
                    canWrite={canWrite}
                    now={now}
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        {canWrite && (
          <Link href={addHref} className={buttonClass + ' gap-2'}>
            <PlusIcon />
            {t('add')}
          </Link>
        )}
      </div>
    </div>
  );
}
