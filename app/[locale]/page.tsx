import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('home');

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="max-w-2xl text-3xl font-bold text-primary sm:text-5xl">
        {t('title')}
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">{t('subtitle')}</p>

      <section className="mt-10 max-w-xl rounded-card border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-accent">
          {t('statusTitle')}
        </h2>
        <p className="mt-1 text-muted">{t('statusBody')}</p>
      </section>
    </div>
  );
}
