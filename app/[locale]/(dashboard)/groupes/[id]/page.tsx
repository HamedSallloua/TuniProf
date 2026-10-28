import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import { DeleteGroup } from '@/components/dashboard/DeleteGroup';
import { GroupCalendarPreview } from '@/components/dashboard/GroupCalendarPreview';
import { SessionActions } from '@/components/dashboard/SessionActions';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import {
  addMonths,
  isValidDate,
  monthOf,
  monthsBetween,
  tunisNow,
} from '@/lib/dashboard/dates';
import { formatDay, monthTitle, scheduleText } from '@/lib/dashboard/format';
import { getGroup } from '@/lib/dashboard/groups';
import { countByDate } from '@/lib/dashboard/schedule';
import { listGroupSessions } from '@/lib/dashboard/sessions';
import { getPool } from '@/lib/db/client';
import { formatMillimes } from '@/lib/money';

export const metadata: Metadata = { robots: { index: false } };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{
    mois?: string;
    chercher?: string;
    done?: string;
    error?: string;
  }>;
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
  // A date typed in the search bar opens that date's month and marks its sessions.
  const searched = isValidDate(query.chercher) ? query.chercher : undefined;
  const month = searched
    ? monthOf(searched)
    : query.mois && MONTH.test(query.mois)
      ? query.mois
      : defaultMonth;

  const allSessions = await listGroupSessions(getPool(), user.id, group.id);
  const sessions = allSessions.filter((s) => s.date.startsWith(month));
  const found = searched
    ? allSessions.filter((s) => s.date === searched).length
    : 0;
  const counts = Object.fromEntries(countByDate(allSessions));
  const previewMonths = monthsBetween(
    [group.startDate, allSessions[0]?.date].filter(Boolean).sort()[0] as string,
    [group.endDate, allSessions.at(-1)?.date]
      .filter(Boolean)
      .sort()
      .at(-1) as string,
  );
  const tp = await getTranslations('groups.preview');
  const tcal = await getTranslations('calendar');
  const canWrite = access === 'full';
  const here = `/groupes/${group.id}?mois=${month}`;

  const prev = monthOf(addMonths(`${month}-01`, -1));
  const next = monthOf(addMonths(`${month}-01`, 1));

  const flash = query.done
    ? { text: td(`flash.${query.done}` as 'flash.deleted'), error: false }
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
            href="/groupes"
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
          {group.rules.length === 0 ? (
            t('manualSchedule')
          ) : (
            <bdi>{scheduleText(group.rules, locale)}</bdi>
          )}
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
          <Link
            href={`/groupes/${group.id}/calendrier`}
            className={buttonClass}
          >
            {tl('changeCalendar')}
          </Link>
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

        <form
          method="get"
          action={`${locale === 'ar' ? '/ar' : ''}/groupes/${group.id}`}
          role="search"
          className="flex flex-wrap items-end gap-2"
        >
          <div className="space-y-1">
            <label htmlFor="date-search" className="block text-xs">
              {t('search.label')}
            </label>
            <input
              id="date-search"
              type="date"
              name="chercher"
              required
              defaultValue={searched ?? ''}
              className={inputClass + ' !w-auto'}
            />
          </div>
          <button type="submit" className={secondaryButtonClass}>
            {t('search.button')}
          </button>
          {searched && (
            <Link
              href={`/groupes/${group.id}`}
              className={secondaryButtonClass}
            >
              {t('search.clear')}
            </Link>
          )}
        </form>
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

      <section aria-labelledby="preview" className="space-y-3">
        <div>
          <h2 id="preview" className="text-lg font-semibold text-primary">
            {tp('title')}
          </h2>
          <p className="text-sm text-muted">{tp('hint')}</p>
        </div>
        <GroupCalendarPreview
          months={previewMonths}
          counts={counts}
          color={group.color}
          locale={locale}
          today={today}
          labels={{
            sessions: (count) => tcal('sessionsCount', { count }),
            legendSessions: tp('legend'),
          }}
        />
      </section>
    </div>
  );
}
