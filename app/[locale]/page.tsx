import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { buttonClass } from '@/components/auth/styles';
import { SearchForm } from '@/components/marketplace/SearchForm';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { getFoundingSlots } from '@/lib/billing/founding';
import { getPool } from '@/lib/db/client';
import { toSearchOptions } from '@/lib/marketplace/options';
import { getFormCatalogue } from '@/lib/profile/catalogue';
import { alternatesFor } from '@/lib/site-url';

type Props = {
  params: Promise<{ locale: string }>;
};

// The cities to start with (spec 11: Sfax, Tunis and Sousse first, then the big suburbs).
const FEATURED_CITIES = [
  'tunis',
  'sfax',
  'sousse',
  'ariana',
  'ben-arous',
  'nabeul',
];
const FEATURED_SUBJECTS = 8;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: alternatesFor(locale, '/') };
}

const chipClass =
  'inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm font-medium text-primary hover:bg-secondary';

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const pool = getPool();
  const [catalogue, founding] = await Promise.all([
    getFormCatalogue(pool),
    getFoundingSlots(pool),
  ]);
  const options = toSearchOptions(catalogue, locale);
  const cities = FEATURED_CITIES.flatMap((slug) =>
    options.governorates.filter((g) => g.value === slug),
  );

  return (
    <>
      <section className="bg-secondary text-secondary-foreground">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
          <h1 className="max-w-3xl text-3xl font-bold text-primary sm:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-4 max-w-2xl text-lg">{t('subtitle')}</p>

          <div className="mt-8 rounded-card border border-border bg-surface p-4 text-foreground sm:p-6">
            <h2 className="mb-4 text-lg font-semibold text-primary">
              {t('searchTitle')}
            </h2>
            <SearchForm
              variant="hero"
              governorates={options.governorates}
              delegations={options.delegations}
              levels={options.levels}
              subjects={options.subjects}
            />
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-10 sm:px-6">
        <section aria-labelledby="home-subjects">
          <h2 id="home-subjects" className="text-xl font-semibold text-primary">
            {t('subjectsTitle')}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-3">
            {options.subjects.slice(0, FEATURED_SUBJECTS).map((subject) => (
              <li key={subject.value}>
                <Link
                  href={`/recherche?matiere=${subject.value}`}
                  className={chipClass}
                >
                  {subject.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="home-cities">
          <h2 id="home-cities" className="text-xl font-semibold text-primary">
            {t('citiesTitle')}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-3">
            {cities.map((city) => (
              <li key={city.value}>
                <Link
                  href={`/recherche?gouvernorat=${city.value}`}
                  className={chipClass}
                >
                  {city.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="home-teacher"
          className="rounded-card border border-border bg-surface p-6"
        >
          <h2 id="home-teacher" className="text-xl font-semibold text-primary">
            {t('teacherTitle')}
          </h2>
          <p className="mt-2 max-w-2xl text-muted">{t('teacherBody')}</p>
          {founding.left > 0 && (
            <p
              role="note"
              className="mt-4 max-w-2xl rounded-md border border-primary bg-secondary p-3 text-sm font-medium text-primary"
            >
              <strong>{t('foundingTitle')}.</strong>{' '}
              {t('foundingBody', {
                total: founding.total,
                count: founding.left,
              })}
            </p>
          )}
          <Link href="/devenir-professeur" className={buttonClass + ' mt-5'}>
            {t('teacherCta')}
          </Link>
        </section>
      </div>
    </>
  );
}
