import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { BRAND_NAME } from '@/lib/brand';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: 'pages.privacy',
  });
  // A stub with no real text yet: nothing to index until the owner sends the policy (M12).
  return {
    title: t('metaTitle', { brand: BRAND_NAME }),
    robots: { index: false },
  };
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('pages.privacy');

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-primary">{t('title')}</h1>
      <p className="mt-4 text-muted">{t('stub')}</p>
    </div>
  );
}
