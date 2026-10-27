import { getTranslations } from 'next-intl/server';
import { logoutAction } from '@/app/[locale]/(account)/actions';
import { Link } from '@/i18n/navigation';
import { getCurrentUser } from '@/lib/auth/current-user';
import { BRAND_NAME } from '@/lib/brand';
import { LanguageSwitcher } from './LanguageSwitcher';

const navLinkClass =
  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-white/10 focus-visible:outline-secondary';

export async function SiteHeader() {
  const t = await getTranslations('header');
  const user = await getCurrentUser();
  const isAdmin =
    user?.role === 'admin_super' || user?.role === 'admin_support';

  return (
    <header className="bg-primary text-primary-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 px-4 py-1 sm:px-6">
        <Link
          href="/"
          aria-label={t('homeLabel', { brand: BRAND_NAME })}
          className="inline-flex min-h-11 items-center text-xl font-bold tracking-tight focus-visible:outline-secondary"
        >
          {BRAND_NAME}
        </Link>

        <nav
          aria-label={t('nav')}
          className="order-last flex w-full flex-wrap items-center sm:order-none sm:w-auto"
        >
          <Link href="/recherche" className={navLinkClass}>
            {t('search')}
          </Link>
          <Link href="/devenir-professeur" className={navLinkClass}>
            {t('becomeTeacher')}
          </Link>
          {user?.role === 'teacher' && (
            <Link href="/espace-professeur" className={navLinkClass}>
              {t('mySpace')}
            </Link>
          )}
          {isAdmin && (
            <Link href="/admin" className={navLinkClass}>
              {t('admin')}
            </Link>
          )}
          {user ? (
            <form action={logoutAction}>
              <button type="submit" className={navLinkClass}>
                {t('logout')}
              </button>
            </form>
          ) : (
            <Link href="/connexion" className={navLinkClass}>
              {t('login')}
            </Link>
          )}
        </nav>

        <LanguageSwitcher />
      </div>
    </header>
  );
}
