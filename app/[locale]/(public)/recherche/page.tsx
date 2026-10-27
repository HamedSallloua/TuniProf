import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Pagination } from '@/components/marketplace/Pagination';
import {
  SearchForm,
  type SearchValues,
} from '@/components/marketplace/SearchForm';
import { TeacherCard } from '@/components/marketplace/TeacherCard';
import { buttonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { BRAND_NAME } from '@/lib/brand';
import { getPool } from '@/lib/db/client';
import { toSearchOptions } from '@/lib/marketplace/options';
import { searchTeachers } from '@/lib/marketplace/search';
import {
  buildSearchQuery,
  parseSearchParams,
  type RawParams,
} from '@/lib/marketplace/search-params';
import { getFormCatalogue } from '@/lib/profile/catalogue';
import { alternatesFor } from '@/lib/site-url';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawParams>;
};

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const { locale } = await params;
  const filters = parseSearchParams(await searchParams);
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: 'search',
  });
  return {
    title: t('metaTitle', { brand: BRAND_NAME }),
    description: t('metaDescription'),
    // Only the plain search page is worth indexing; every filter combination is not.
    alternates: alternatesFor(locale, '/recherche'),
    robots:
      buildSearchQuery(filters) === ''
        ? undefined
        : { index: false, follow: true },
  };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const raw = await searchParams;
  const filters = parseSearchParams(raw);
  const t = await getTranslations('search');
  const pool = getPool();

  const [result, catalogue] = await Promise.all([
    searchTeachers(pool, filters),
    getFormCatalogue(pool),
  ]);
  const options = toSearchOptions(catalogue, locale);

  const value = (key: string) => {
    const entry = raw[key];
    return (Array.isArray(entry) ? entry[0] : entry) ?? '';
  };
  const initial: SearchValues = {
    gouvernorat: value('gouvernorat'),
    delegation: value('delegation'),
    niveau: value('niveau'),
    matiere: value('matiere'),
    mode: value('mode'),
    prix_min: value('prix_min'),
    prix_max: value('prix_max'),
    note: value('note'),
    tri: value('tri'),
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold text-primary">{t('title')}</h1>
      <p className="mt-2 max-w-3xl text-muted">{t('intro')}</p>

      <div className="mt-6">
        <SearchForm
          variant="full"
          governorates={options.governorates}
          delegations={options.delegations}
          levels={options.levels}
          subjects={options.subjects}
          initial={initial}
        />
      </div>

      <p role="status" className="mt-8 font-medium text-primary">
        {t('results', { count: result.total })}
      </p>

      {result.cards.length > 0 ? (
        <ul className="mt-4 space-y-4">
          {result.cards.map((card) => (
            <li key={card.userId}>
              <TeacherCard card={card} locale={locale} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-card border border-border bg-surface p-6">
          <p className="font-semibold">{t('empty.title')}</p>
          <p className="mt-1 text-muted">{t('empty.body')}</p>
          <Link href="/recherche" className={buttonClass + ' mt-4'}>
            {t('empty.all')}
          </Link>
        </div>
      )}

      <Pagination
        filters={filters}
        page={result.page}
        pageCount={result.pageCount}
      />

      <p
        role="note"
        className="mt-10 rounded-md border border-border bg-secondary p-3 text-sm text-secondary-foreground"
      >
        {t('safety', { brand: BRAND_NAME })}
      </p>
    </div>
  );
}
