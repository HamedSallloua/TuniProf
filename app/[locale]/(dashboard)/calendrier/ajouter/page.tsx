import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { AddSessionForm } from '@/components/dashboard/AddSessionForm';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard, safeReturnPath } from '@/lib/dashboard/context';
import { isValidDate, tunisNow } from '@/lib/dashboard/dates';
import { listGroups } from '@/lib/dashboard/groups';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

export default async function AddSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string; retour?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const { user, access, now } = await requireDashboard(locale as Locale);
  const query = await searchParams;
  const returnTo = safeReturnPath(query.retour, '/calendrier');
  if (access !== 'full') redirect({ href: returnTo, locale: locale as Locale });

  const today = tunisNow(now).date;
  const groups = await listGroups(getPool(), user.id);
  const defaultDate =
    isValidDate(query.date) && query.date >= today ? query.date : today;

  return (
    <AddSessionForm
      groups={groups.map((g) => ({ id: g.id, name: g.name }))}
      defaultDate={defaultDate}
      returnTo={returnTo}
      today={today}
    />
  );
}
