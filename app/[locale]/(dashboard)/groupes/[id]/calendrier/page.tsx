import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ChangeCalendarForm } from '@/components/dashboard/ChangeCalendarForm';
import { GroupSessions } from '@/components/dashboard/GroupSessions';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import { isValidDate, monthOf, tunisNow } from '@/lib/dashboard/dates';
import { getGroup } from '@/lib/dashboard/groups';
import { listGroupSessions } from '@/lib/dashboard/sessions';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function ChangeCalendarPage({
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
  const query = await searchParams;
  setRequestLocale(locale as Locale);
  const { user, access, now } = await requireDashboard(locale as Locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const group = await getGroup(getPool(), user.id, id);
  if (!group) notFound();
  // Nothing can be changed during the read-only period.
  if (access !== 'full')
    redirect({ href: `/groupes/${id}`, locale: locale as Locale });

  const sessions = await listGroupSessions(getPool(), user.id, group.id);
  const td = await getTranslations('dashboard');
  const today = tunisNow(now).date;

  // The session list opens on today's month, or on the nearest month of the group's period.
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
  const flash = query.done
    ? { text: td(`flash.${query.done}` as 'flash.deleted'), error: false }
    : query.error
      ? {
          text: td(`sessionErrors.${query.error}` as 'sessionErrors.invalid'),
          error: true,
        }
      : null;

  return (
    <div>
      <ChangeCalendarForm
        sessions={sessions.map((s) => ({
          id: s.id,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          origin: s.origin,
          originalDate: s.originalDate,
        }))}
        group={{
          id: group.id,
          name: group.name,
          color: group.color,
          startDate: group.startDate,
          endDate: group.endDate,
          rules: group.rules,
        }}
        today={today}
        month={month}
        searched={searched}
      >
        <GroupSessions
          groupId={group.id}
          basePath={`/groupes/${group.id}/calendrier`}
          locale={locale}
          month={month}
          sessions={sessions.filter((s) => s.date.startsWith(month))}
          searched={searched}
          found={
            searched ? sessions.filter((s) => s.date === searched).length : 0
          }
          canWrite
          now={now}
          flash={flash}
        />
      </ChangeCalendarForm>
    </div>
  );
}
