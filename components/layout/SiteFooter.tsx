import { getTranslations } from 'next-intl/server';
import { BRAND_NAME } from '@/lib/brand';

export async function SiteFooter() {
  const t = await getTranslations('footer');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-secondary text-secondary-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-6 text-sm sm:px-6">
        <p className="font-medium">{t('tagline')}</p>
        <p>{t('copyright', { year, brand: BRAND_NAME })}</p>
      </div>
    </footer>
  );
}
