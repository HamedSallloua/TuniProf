'use client';

import { useTranslations } from 'next-intl';
import { CalendarIcon, StudentIcon, UsersIcon } from '@/components/ui/icons';
import { Link, usePathname } from '@/i18n/navigation';

// The Dashboard navigation (spec 5.1): a sidebar on a computer, a bar at the bottom of the
// screen on a phone. Statistiques is added to it when that section exists (M10).
const ITEMS = [
  { href: '/groupes', key: 'groups', Icon: UsersIcon },
  { href: '/eleves', key: 'students', Icon: StudentIcon },
  { href: '/calendrier', key: 'calendar', Icon: CalendarIcon },
] as const;

export function DashboardNav() {
  const t = useTranslations('dashboard.nav');
  const pathname = usePathname();

  const linkClass = (active: boolean) =>
    'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium focus-visible:outline-accent ' +
    (active
      ? 'bg-primary text-primary-foreground'
      : 'text-primary hover:bg-secondary');

  return (
    <>
      <nav aria-label={t('label')} className="hidden w-52 shrink-0 md:block">
        <ul className="sticky top-4 space-y-1">
          {ITEMS.map(({ href, key, Icon }) => (
            <li key={key}>
              <Link
                href={href}
                aria-current={pathname.startsWith(href) ? 'page' : undefined}
                className={linkClass(pathname.startsWith(href))}
              >
                <Icon />
                {t(key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav
        aria-label={t('label')}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto flex max-w-md justify-around">
          {ITEMS.map(({ href, key, Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={key} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium focus-visible:outline-accent ' +
                    (active ? 'text-primary' : 'text-muted')
                  }
                >
                  <Icon className={active ? 'size-6' : 'size-5'} />
                  {t(key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
