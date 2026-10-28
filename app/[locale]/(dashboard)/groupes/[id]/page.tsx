import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';
import { DeleteGroup } from '@/components/dashboard/DeleteGroup';
import { SessionActions } from '@/components/dashboard/SessionActions';
import {
  archiveGroupAction,
  restoreGroupAction,
} from '../../dashboard-actions';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import {
  addMonths,
  endOfMonth,
  monthOf,
  startOfMonth,
  tunisNow,
} from '@/lib/dashboard/dates';
import { formatDay, monthTitle, scheduleText } from '@/lib/dashboard/format';
import { getGroup } from '@/lib/dashboard/groups';
import { listSessions } from '@/lib/dashboard/sessions';
import { getPool } from '@/lib/db/client';
import { formatMillimes } from '@/lib/money';

export const metadata: Metadata = { robots: { index: false } };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ mois?: string; done?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const { user, access, now } = await requireDashboard(locale as Locale);
  const query = await searchParams;

  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const group = await getGroup(getPool(), user.id, id);
  if (!group) notFound();

  const t = await getTranslations('groups.page');
  const tl = await getTranslations('groups.list');
  const tr = await getTranslations('calendar.row');
  const td = await getTranslations('dashboard');

  const today = tunisNow(now).date;
  // Opens on today's month, or on the nearest month of the group's own period.
  const defaultMonth = monthOf(
    today < group.startDate
      ? group.startDate
      : today > group.endDate
        ? group.endDate
        : today,
  );
  const month =
    query.mois && MONTH.test(query.mois) ? query.mois : defaultMonth;

  const sessions = await listSessions(
    getPool(),
    user.id,
    startOfMonth(`${month}-01`),
    endOfMonth(`${month}-01`),
    { groupId: group.id },
  );
  const canWrite = access === 'full';
  const here = `/groupes/${group.id}?mois=${month}`;

  const prev = monthOf(addMonths(`${month}-01`, -1));
  const next = monthOf(addMonths(`${month}-01`, 1));

  const flash = query.done
    ? { text: td(`flash.${query.done}` as 'flash.cancelled'), error: false }
    : query.error
      ? {
          text: td(`sessionErrors.${query.error}` as 'sessionErrors.invalid'),
          error: true,
        }
      : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm">
          <Link
            href={
              group.status === 'archived'
                ? { pathname: '/groupes', query: { onglet: 'archives' } }
                : '/groupes'
            }
            className="text-primary underline underline-offset-2"
          >
            {t('back')}
          </Link>
        </p>
        <h1 className="flex items-center gap-3 text-2xl font-bold text-primary">
          <span
            aria-hidden="true"
            className="inline-block size-4 rounded-full"
            style={{ backgroundColor: group.color }}
          />
          {group.name}
          {group.status === 'archived' && (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted">
              {t('archivedBadge')}
            </span>
          )}
        </h1>
      </header>

      <dl className="grid gap-1 rounded-card border border-border bg-surface p-4 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="font-medium">{t('period')}</dt>
        <dd>
          {formatDay(group.startDate, locale, { dateStyle: 'medium' })} →{' '}
          {formatDay(group.endDate, locale, { dateStyle: 'medium' })}
        </dd>
        <dt className="font-medium">{t('schedule')}</dt>
        <dd>
          <bdi>{scheduleText(group.rules, locale)}</bdi>
        </dd>
        <dt className="font-medium">{t('price')}</dt>
        <dd>
          {group.referencePriceMillimes === null
            ? tl('noPrice')
            : tl(
                group.pricingModel === 'per_session'
                  ? 'priceSession'
                  : 'priceMonth',
                {
                  price: formatMillimes(group.referencePriceMillimes, locale),
                },
              )}
        </dd>
      </dl>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          {group.status === 'active' ? (
            <>
              <Link
                href={`/groupes/${group.id}/calendrier`}
                className={buttonClass}
              >
                {tl('changeCalendar')}
              </Link>
              <form action={archiveGroupAction}>
                <input type="hidden" name="groupId" value={group.id} />
                <button type="submit" className={secondaryButtonClass}>
                  {tl('archive')}
                </button>
              </form>
            </>
          ) : (
            <form action={restoreGroupAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <button type="submit" className={buttonClass}>
                {tl('restore')}
              </button>
            </form>
          )}
          <DeleteGroup groupId={group.id} groupName={group.name} />
        </div>
      )}

      <section
        aria-labelledby="students"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 id="students" className="font-semibold text-primary">
          {t('students')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('noStudents')}</p>
      </section>

      <section aria-labelledby="sessions" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="sessions" className="text-lg font-semibold text-primary">
            {t('sessions')}
          </h2>
          <nav aria-label={t('monthNav')} className="flex items-center gap-2">
            <Link
              href={`/groupes/${group.id}?mois=${prev}`}
              className={secondaryButtonClass}
              aria-label={t('previousMonth')}
            >
              ‹
            </Link>
            <span className="inline-block min-w-36 text-center font-medium first-letter:uppercase">
              {monthTitle(month, locale)}
            </span>
            <Link
              href={`/groupes/${group.id}?mois=${next}`}
              className={secondaryButtonClass}
              aria-label={t('nextMonth')}
            >
              ›
            </Link>
          </nav>
        </div>

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
                  (session.status === 'cancelled' ? 'opacity-60' : '')
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
                    {session.status === 'cancelled' && ` · ${tr('cancelled')}`}
                    {session.origin === 'moved' && ` · ${tr('moved')}`}
                    {session.origin === 'extra' && ` · ${tr('extra')}`}
                  </p>
                </div>
                <SessionActions
                  session={session}
                  returnTo={here}
                  canWrite={canWrite && group.status === 'active'}
                  now={now}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
