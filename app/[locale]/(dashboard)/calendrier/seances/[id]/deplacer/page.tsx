import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { MoveSessionForm } from '@/components/dashboard/MoveSessionForm';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard, safeReturnPath } from '@/lib/dashboard/context';
import { isPast, tunisNow } from '@/lib/dashboard/dates';
import { getSession } from '@/lib/dashboard/sessions';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

export default async function MoveSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ retour?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const { user, access, now } = await requireDashboard(locale as Locale);
  const returnTo = safeReturnPath((await searchParams).retour, '/calendrier');

  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const session = await getSession(getPool(), user.id, id);
  if (!session) notFound();
  // Only a session that is still to come, in a fully active Dashboard.
  if (access !== 'full' || isPast(session, now))
    redirect({ href: returnTo, locale: locale as Locale });

  return (
    <MoveSessionForm
      session={{
        id: session.id,
        groupName: session.groupName,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
      }}
      returnTo={returnTo}
      today={tunisNow(now).date}
    />
  );
}
