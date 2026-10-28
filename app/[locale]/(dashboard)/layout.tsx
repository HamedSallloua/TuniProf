import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';

// Everything under the Dashboard: only a teacher with an active Dashboard, or in the 30 days of
// read-only access after it ended (spec 2.5, 5.11). The pages and actions check it again.
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const context = await requireDashboard(locale as Locale);

  const t = await getTranslations('dashboard');
  const format = await getFormatter();

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 pt-6 pb-24 sm:px-6 md:pb-10">
      <DashboardNav />
      <div className="min-w-0 flex-1 space-y-4">
        {context.access === 'read_only' && context.readOnlyUntil && (
          <p
            role="status"
            className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
          >
            {t('readOnly', {
              date: format.dateTime(context.readOnlyUntil, {
                dateStyle: 'long',
              }),
            })}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
