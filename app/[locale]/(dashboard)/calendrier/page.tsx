import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/styles';
import {
  calendarUrl,
  type CalendarView,
} from '@/components/dashboard/calendar-url';
import { DayOverlay } from '@/components/dashboard/DayOverlay';
import { MonthView } from '@/components/dashboard/MonthView';
import { WeekView } from '@/components/dashboard/WeekView';
import { YearView } from '@/components/dashboard/YearView';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import {
  addDays,
  addMonths,
  endOfMonth,
  isValidDate,
  startOfMonth,
  startOfWeek,
  tunisNow,
} from '@/lib/dashboard/dates';
import { formatDay, monthTitle } from '@/lib/dashboard/format';
import { listGroups } from '@/lib/dashboard/groups';
import { countByDate } from '@/lib/dashboard/schedule';
import { listSessions, upcomingSessions } from '@/lib/dashboard/sessions';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

const VIEWS: CalendarView[] = ['semaine', 'mois', 'annee'];

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    vue?: string;
    date?: string;
    groupe?: string;
    jour?: string;
    /** A date typed in the search bar: the calendar opens on it, with its day open. */
    chercher?: string;
    done?: string;
    error?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const { user, access, now } = await requireDashboard(locale as Locale);
  const query = await searchParams;

  const t = await getTranslations('calendar');
  const td = await getTranslations('dashboard');
  const pool = getPool();

  const today = tunisNow(now).date;
  const vue: CalendarView = VIEWS.includes(query.vue as CalendarView)
    ? (query.vue as CalendarView)
    : 'semaine';
  const searched = isValidDate(query.chercher) ? query.chercher : undefined;
  const date = searched ?? (isValidDate(query.date) ? query.date : today);
  const groups = await listGroups(pool, user.id);
  const groupId = groups.some((g) => g.id === query.groupe)
    ? query.groupe
    : undefined;
  const jour = searched ?? (isValidDate(query.jour) ? query.jour : undefined);
  const canWrite = access === 'full';

  const url = (patch: {
    vue?: CalendarView;
    date?: string;
    jour?: string | null;
  }) =>
    calendarUrl({
      vue: patch.vue ?? vue,
      date: patch.date ?? date,
      groupe: groupId,
      jour: patch.jour === null ? undefined : (patch.jour ?? undefined),
    });

  // What to load depends on the view.
  const weekStart = startOfWeek(date);
  const range =
    vue === 'semaine'
      ? { from: weekStart, to: addDays(weekStart, 6) }
      : vue === 'mois'
        ? { from: startOfMonth(date), to: endOfMonth(date) }
        : vue === 'annee'
          ? {
              from: `${date.slice(0, 4)}-01-01`,
              to: `${date.slice(0, 4)}-12-31`,
            }
          : null;
  const shown = range
    ? await listSessions(pool, user.id, range.from, range.to, { groupId })
    : [];

  const daySessions = jour ? await listSessions(pool, user.id, jour, jour) : [];
  const upcoming = await upcomingSessions(pool, user.id, now);

  // The title and the previous / next dates of the view.
  const step =
    vue === 'semaine'
      ? { prev: addDays(date, -7), next: addDays(date, 7) }
      : vue === 'mois'
        ? {
            prev: addMonths(startOfMonth(date), -1),
            next: addMonths(startOfMonth(date), 1),
          }
        : { prev: addMonths(date, -12), next: addMonths(date, 12) };
  const title =
    vue === 'semaine'
      ? t('weekOf', {
          date: formatDay(weekStart, locale, { dateStyle: 'long' }),
        })
      : vue === 'mois'
        ? monthTitle(date.slice(0, 7), locale)
        : date.slice(0, 4);

  const flash = query.done
    ? { text: td(`flash.${query.done}` as 'flash.deleted'), error: false }
    : query.error
      ? {
          text: td(`sessionErrors.${query.error}` as 'sessionErrors.invalid'),
          error: true,
        }
      : null;

  const tab = (active: boolean) =>
    'inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium ' +
    (active
      ? 'bg-primary text-primary-foreground'
      : 'border border-border bg-surface text-primary hover:bg-secondary');

  const overlayReturn = url({ jour });
  const dayLabel = (d: string) =>
    d === today ? t('upcoming.today') : t('upcoming.tomorrow');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
        {canWrite && (
          <Link
            href={{
              pathname: '/calendrier/ajouter',
              query: { date: jour ?? date, retour: url({}) },
            }}
            className={buttonClass}
          >
            {t('day.add')}
          </Link>
        )}
      </header>

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

      <section
        aria-labelledby="upcoming"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 id="upcoming" className="font-semibold text-primary">
          {t('upcoming.title')}
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{t('upcoming.empty')}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {upcoming.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3">
                <span className="w-24 font-medium">{dayLabel(s.date)}</span>
                <bdi dir="ltr">
                  {s.startTime}-{s.endTime}
                </bdi>
                <span className="inline-flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: s.groupColor }}
                  />
                  {s.groupName}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t('views.label')} className="flex gap-2">
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={url({ vue: v, jour: null })}
              className={tab(v === vue)}
              aria-current={v === vue ? 'page' : undefined}
            >
              {t(`views.${v}`)}
            </Link>
          ))}
        </nav>

        <form
          method="get"
          action={locale === 'ar' ? '/ar/calendrier' : '/calendrier'}
          className="flex items-end gap-2"
        >
          <input type="hidden" name="vue" value={vue} />
          <input type="hidden" name="date" value={date} />
          <div className="space-y-1">
            <label htmlFor="group-filter" className="block text-xs">
              {t('filter')}
            </label>
            <select
              id="group-filter"
              name="groupe"
              defaultValue={groupId ?? ''}
              className={inputClass + ' !w-auto'}
            >
              <option value="">{t('allGroups')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={secondaryButtonClass}>
            {t('apply')}
          </button>
        </form>
      </div>

      <form
        method="get"
        action={locale === 'ar' ? '/ar/calendrier' : '/calendrier'}
        role="search"
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="vue" value={vue} />
        {groupId && <input type="hidden" name="groupe" value={groupId} />}
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
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          className="text-lg font-semibold text-primary first-letter:uppercase"
          aria-live="polite"
        >
          {title}
        </h2>
        <div className="flex items-center gap-2">
          <Link
            href={url({ date: step.prev, jour: null })}
            className={secondaryButtonClass}
            aria-label={t('previous')}
          >
            ‹
          </Link>
          <Link
            href={url({ date: today, jour: null })}
            className={secondaryButtonClass}
          >
            {t('todayButton')}
          </Link>
          <Link
            href={url({ date: step.next, jour: null })}
            className={secondaryButtonClass}
            aria-label={t('next')}
          >
            ›
          </Link>
        </div>
      </div>

      {vue === 'semaine' && (
        <WeekView
          weekStart={weekStart}
          sessions={shown}
          locale={locale}
          today={today}
          hrefFor={(d) => url({ jour: d })}
          ariaLabel={t('views.semaine')}
        />
      )}
      {vue === 'mois' && (
        <MonthView
          month={date.slice(0, 7)}
          counts={countByDate(shown)}
          locale={locale}
          today={today}
          hrefFor={(d) => url({ jour: d })}
          sessionsLabel={(count) => t('sessionsCount', { count })}
        />
      )}
      {vue === 'annee' && (
        <YearView
          year={Number(date.slice(0, 4))}
          locale={locale}
          today={today}
          counts={countByDate(shown)}
          sessionsLabel={(count) => t('sessionsCount', { count })}
          monthHref={(month) =>
            url({ vue: 'mois', date: `${month}-01`, jour: null })
          }
          dayHref={(d) => url({ vue: 'semaine', date: d, jour: null })}
        />
      )}

      {jour && (
        <DayOverlay
          date={jour}
          sessions={daySessions}
          locale={locale}
          closeHref={url({ jour: null })}
          addHref={`/calendrier/ajouter?date=${jour}&retour=${encodeURIComponent(overlayReturn)}`}
          returnTo={overlayReturn}
          canWrite={canWrite}
          now={now}
        />
      )}
    </div>
  );
}
