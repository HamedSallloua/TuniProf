import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BRAND_NAME } from '@/lib/brand';

const LINKS = [
  { href: '/recherche', key: 'search' },
  { href: '/devenir-professeur', key: 'becomeTeacher' },
  { href: '/comment-payer', key: 'howToPay' },
  { href: '/conditions', key: 'terms' },
  { href: '/confidentialite', key: 'privacy' },
  { href: '/contact', key: 'contact' },
] as const;

export async function SiteFooter() {
  const t = await getTranslations('footer');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-secondary text-secondary-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm sm:px-6">
        <nav aria-label={t('linksLabel')}>
          <ul className="flex flex-wrap gap-x-5">
            {LINKS.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-accent"
                >
                  {t(link.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="font-medium">{t('tagline')}</p>
        <p>{t('copyright', { year, brand: BRAND_NAME })}</p>
      </div>
    </footer>
  );
}
