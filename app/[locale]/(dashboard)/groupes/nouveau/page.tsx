import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { GroupWizard } from '@/components/dashboard/GroupWizard';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import { tunisNow } from '@/lib/dashboard/dates';
import { redirect } from '@/i18n/navigation';

export const metadata: Metadata = { robots: { index: false } };

export default async function NewGroupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const { access, now } = await requireDashboard(locale as Locale);
  // The read-only period allows looking, not creating.
  if (access !== 'full')
    redirect({ href: '/groupes', locale: locale as Locale });

  return <GroupWizard today={tunisNow(now).date} />;
}
