'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

// Each language is always written in its own language.
const LANGUAGE_NAMES = { fr: 'Français', ar: 'العربية' } as const;

export function LanguageSwitcher() {
  const currentLocale = useLocale();
  const pathname = usePathname();
  const t = useTranslations('language');

  return (
    <nav aria-label={t('label')}>
      <ul className="flex items-center gap-1">
        {routing.locales.map((locale) => {
          const isCurrent = locale === currentLocale;
          return (
            <li key={locale}>
              <Link
                href={pathname}
                locale={locale}
                lang={locale}
                hrefLang={locale}
                aria-current={isCurrent ? 'true' : undefined}
                className={
                  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus-visible:outline-secondary ' +
                  (isCurrent
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-primary-foreground hover:bg-white/10')
                }
              >
                {LANGUAGE_NAMES[locale]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
