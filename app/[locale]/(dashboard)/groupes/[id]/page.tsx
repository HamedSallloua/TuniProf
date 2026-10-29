import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';
import { DeleteGroup } from '@/components/dashboard/DeleteGroup';
import { EditGroupPrice } from '@/components/dashboard/EditGroupPrice';
import { GroupCalendarPreview } from '@/components/dashboard/GroupCalendarPreview';
import { GroupDays } from '@/components/dashboard/GroupDays';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import { monthOf, tunisNow } from '@/lib/dashboard/dates';
import { formatDay } from '@/lib/dashboard/format';
import { getGroup } from '@/lib/dashboard/groups';
import { countByDate } from '@/lib/dashboard/schedule';
import { listGroupSessions } from '@/lib/dashboard/sessions';
import { listGroupMembers } from '@/lib/dashboard/students';
import { getPool } from '@/lib/db/client';
import { formatMillimes } from '@/lib/money';

export const metadata: Metadata = { robots: { index: false } };

/** A card that only shows information, with its edit button underneath. */
const cardClass =
  'space-y-2 rounded-card border border-border bg-surface p-4 text-start';

export default async function GroupPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const { user, access, now } = await requireDashboard(locale as Locale);

  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const group = await getGroup(getPool(), user.id, id);
  if (!group) notFound();

  const t = await getTranslations('groups.page');
  const tl = await getTranslations('groups.list');
  const tp = await getTranslations('groups.preview');
  const tcal = await getTranslations('calendar');

  const today = tunisNow(now).date;
  const canWrite = access === 'full';
  const allSessions = await listGroupSessions(getPool(), user.id, group.id);
  const members = await listGroupMembers(getPool(), user.id, group.id);

  const counts = Object.fromEntries(countByDate(allSessions));
  // Only the months that have sessions get a card.
  const previewMonths = [
    ...new Set(allSessions.map((s) => monthOf(s.date))),
  ].sort();
  const days = allSessions.map((s) => ({
    key: s.id,
    label: formatDay(s.date, locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    times: `${s.startTime}-${s.endTime}`,
  }));

  return (
    <div className="space-y-8">
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

      {/* ------------------------------------------------------- the calendar, centred */}
      <section aria-labelledby="preview" className="space-y-3">
        <div className="text-center">
          <h2 id="preview" className="text-lg font-semibold text-primary">
            {tp('title')}
          </h2>
          <p className="text-sm text-muted">{tp('hint')}</p>
        </div>
        {previewMonths.length === 0 && (
          <p className="text-center text-sm text-muted">{tp('empty')}</p>
        )}
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

      <div className="mx-auto max-w-2xl space-y-8">
        {/* ------------------------------- card 1: the period and the days, then its button */}
        <section aria-labelledby="overview-days" className="space-y-3">
          <div className={cardClass}>
            <h2
              id="overview-days"
              className="text-lg font-semibold text-primary"
            >
              {t('overviewDays')}
            </h2>
            <p className="text-sm">
              <span className="font-medium">{t('period')} : </span>
              <bdi>
                {formatDay(group.startDate, locale, { dateStyle: 'medium' })} →{' '}
                {formatDay(group.endDate, locale, { dateStyle: 'medium' })}
              </bdi>
            </p>
            <p className="text-sm font-medium">{t('days')}</p>
            <GroupDays days={days} />
          </div>
          {canWrite && (
            <Link
              href={`/groupes/${group.id}/calendrier`}
              className={buttonClass}
            >
              {tl('changeCalendar')}
            </Link>
          )}
        </section>

        {/* ---------------------------------- card 2: the students' names, then its button */}
        <section aria-labelledby="overview-students" className="space-y-3">
          <div className={cardClass}>
            <h2
              id="overview-students"
              className="text-lg font-semibold text-primary"
            >
              {t('students')}
              {members.length > 0 && (
                <span className="ms-2 text-sm font-normal text-muted">
                  ({members.length})
                </span>
              )}
            </h2>
            {members.length === 0 ? (
              <p className="text-sm text-muted">{t('noStudents')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {members.map((member) => (
                  <li
                    key={member.id}
                    className="rounded-full bg-secondary px-3 py-1 text-secondary-foreground"
                  >
                    {member.fullName}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canWrite && (
            <Link
              href={`/groupes/${group.id}/eleves`}
              className={secondaryButtonClass}
            >
              {t('editStudents')}
            </Link>
          )}
        </section>

        {/* ------------------------------------- card 3: the price, then its button */}
        <section aria-labelledby="overview-price" className="space-y-3">
          <div className={cardClass}>
            <h2
              id="overview-price"
              className="text-lg font-semibold text-primary"
            >
              {t('price')}
            </h2>
            <p className="text-sm">
              {group.referencePriceMillimes === null
                ? tl('noPrice')
                : tl(
                    group.pricingModel === 'per_session'
                      ? 'priceSession'
                      : 'priceMonth',
                    {
                      price: formatMillimes(
                        group.referencePriceMillimes,
                        locale,
                      ),
                    },
                  )}
            </p>
          </div>
          {canWrite && (
            <EditGroupPrice
              groupId={group.id}
              pricingModel={group.pricingModel}
              referencePriceMillimes={group.referencePriceMillimes}
            />
          )}
        </section>

        {canWrite && (
          <div className="border-t border-border pt-6">
            <DeleteGroup groupId={group.id} groupName={group.name} />
          </div>
        )}
      </div>
    </div>
  );
}
