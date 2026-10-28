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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ onglet?: string; message?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const { user, access } = await requireDashboard(locale as Locale);
  const { onglet, message } = await searchParams;
  const archived = onglet === 'archives';

  const t = await getTranslations('groups.list');
  const groups = await listGroups(
    getPool(),
    user.id,
    archived ? 'archived' : 'active',
  );

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

  const tab = (active: boolean) =>
    'inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium ' +
    (active
      ? 'bg-primary text-primary-foreground'
      : 'border border-border bg-surface text-primary hover:bg-secondary');

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

      {message && (
        <p
          role={['error', 'name_taken'].includes(message) ? 'alert' : 'status'}
          className="rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
        >
          {t(`flash.${message}` as 'flash.archived')}
        </p>
      )}

      <nav aria-label={t('tabs')} className="flex gap-2">
        <Link
          href="/groupes"
          className={tab(!archived)}
          aria-current={archived ? undefined : 'page'}
        >
          {t('active')}
        </Link>
        <Link
          href={{ pathname: '/groupes', query: { onglet: 'archives' } }}
          className={tab(archived)}
          aria-current={archived ? 'page' : undefined}
        >
          {t('archived')}
        </Link>
      </nav>

      <GroupList
        key={archived ? 'a' : 'b'}
        rows={rows}
        archived={archived}
        readOnly={access !== 'full'}
      />
    </div>
  );
}
