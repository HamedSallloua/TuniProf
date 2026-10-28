import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buttonClass } from '@/components/auth/styles';
import { GroupList, type GroupRowData } from '@/components/dashboard/GroupList';
import { PlusIcon } from '@/components/ui/icons';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getPool } from '@/lib/db/client';
import { requireDashboard } from '@/lib/dashboard/context';
import { formatDay, scheduleText } from '@/lib/dashboard/format';
import { listGroups, type Group } from '@/lib/dashboard/groups';
import { formatMillimes } from '@/lib/money';

export const metadata: Metadata = { robots: { index: false } };

export default async function GroupsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const { user, access } = await requireDashboard(locale as Locale);

  const t = await getTranslations('groups.list');
  const groups = await listGroups(getPool(), user.id);

  const rows: GroupRowData[] = groups.map((group: Group) => ({
    id: group.id,
    name: group.name,
    color: group.color,
    periodText: `${formatDay(group.startDate, locale, { dateStyle: 'medium' })} → ${formatDay(group.endDate, locale, { dateStyle: 'medium' })}`,
    scheduleText: scheduleText(group.rules, locale),
    priceText:
      group.referencePriceMillimes === null
        ? ''
        : t(
            group.pricingModel === 'per_session'
              ? 'priceSession'
              : 'priceMonth',
            {
              price: formatMillimes(group.referencePriceMillimes, locale),
            },
          ),
    priceDigits:
      group.referencePriceMillimes === null
        ? ''
        : String(group.referencePriceMillimes),
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
        {access === 'full' && (
          <Link href="/groupes/nouveau" className={buttonClass + ' gap-2'}>
            <PlusIcon />
            {t('create')}
          </Link>
        )}
      </header>

      <GroupList rows={rows} readOnly={access !== 'full'} />
    </div>
  );
}
