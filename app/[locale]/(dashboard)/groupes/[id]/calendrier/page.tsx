import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ChangeCalendarForm } from '@/components/dashboard/ChangeCalendarForm';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import { tunisNow } from '@/lib/dashboard/dates';
import { getGroup } from '@/lib/dashboard/groups';
import { listGroupSessions } from '@/lib/dashboard/sessions';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

export default async function ChangeCalendarPage({
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
  // Nothing can be changed during the read-only period.
  if (access !== 'full')
    redirect({ href: `/groupes/${id}`, locale: locale as Locale });

  const sessions = await listGroupSessions(getPool(), user.id, group.id);

  return (
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
      today={tunisNow(now).date}
    />
  );
}
