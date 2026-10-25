import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BRAND_NAME } from '@/lib/brand';
import { LanguageSwitcher } from './LanguageSwitcher';

export async function SiteHeader() {
  const t = await getTranslations('header');

  return (
    <header className="bg-primary text-primary-foreground">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
        <Link
          href="/"
          aria-label={t('homeLabel', { brand: BRAND_NAME })}
          className="inline-flex min-h-11 items-center text-xl font-bold tracking-tight focus-visible:outline-secondary"
        >
          {BRAND_NAME}
        </Link>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
