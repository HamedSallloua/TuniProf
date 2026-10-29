import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import { formatDay, monthTitle } from '@/lib/dashboard/format';
import type { SessionRow } from '@/lib/dashboard/sessions';
import { DateSearchForm } from './DateSearchForm';
import { SessionActions } from './SessionActions';

/**
 * The "Séances" list of a group, month by month, with its date search: every session can be
 * moved or deleted from here. It lives in the "Modifier calendrier" page (`basePath`).
 */
export async function GroupSessions({
  groupId,
  basePath,
  locale,
  month,
  sessions,
  searched,
  found,
  canWrite,
  now,
  flash,
}: {
  groupId: string;
  /** "/groupes/{id}/calendrier": where the month arrows and the search lead. */
  basePath: string;
  locale: string;
  /** "2026-09": the month shown. */
  month: string;
  /** The sessions of that month. */
  sessions: SessionRow[];
  searched?: string;
  /** How many sessions the searched date has. */
  found: number;
  canWrite: boolean;
  now: Date;
  flash: { text: string; error: boolean } | null;
}) {
  const t = await getTranslations('groups.page');
  const tr = await getTranslations('calendar.row');
  const tc = await getTranslations('calendar');
  const here = `${basePath}?mois=${month}`;

  return (
    <section aria-labelledby="sessions" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sessions" className="text-lg font-semibold text-primary">
          {t('sessions')}
          <span className="ms-2 text-base font-medium text-muted first-letter:uppercase">
            {monthTitle(month, locale)}
          </span>
        </h2>
      </div>

      <DateSearchForm basePath={basePath} searched={searched}>
        {canWrite && (
          <Link
            href={{
              pathname: '/calendrier/ajouter',
              query: {
                date: searched ?? `${month}-01`,
                retour: here,
                groupe: groupId,
              },
            }}
            className={buttonClass}
          >
            {tc('day.add')}
          </Link>
        )}
      </DateSearchForm>
      {searched && (
        <p
          role="status"
          className={
            'text-sm ' +
            (found === 0 ? 'text-muted' : 'font-medium text-primary')
          }
        >
          {found === 0
            ? t('search.none', {
                date: formatDay(searched, locale, { dateStyle: 'full' }),
              })
            : t('search.found', {
                count: found,
                date: formatDay(searched, locale, { dateStyle: 'full' }),
              })}
        </p>
      )}

      {flash && (
        <p
          role={flash.error ? 'alert' : 'status'}
          className={
            'rounded-md border p-3 text-sm ' +
            (flash.error
              ? 'border-accent bg-secondary text-accent'
              : 'border-primary bg-secondary text-primary')
          }
        >
          {flash.text}
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-muted">
          {t('noSessions')}
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => (
            <li
              key={session.id}
              className={
                'flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-3 ' +
                (session.date === searched ? 'ring-2 ring-primary' : '')
              }
            >
              <div>
                <p className="font-medium">
                  {formatDay(session.date, locale, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </p>
                <p className="text-sm text-muted">
                  <bdi dir="ltr">
                    {session.startTime}-{session.endTime}
                  </bdi>
                  {session.origin === 'moved' && ` · ${tr('moved')}`}
                  {session.origin === 'extra' && ` · ${tr('extra')}`}
                </p>
              </div>
              <SessionActions
                session={session}
                returnTo={here}
                canWrite={canWrite}
                now={now}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
