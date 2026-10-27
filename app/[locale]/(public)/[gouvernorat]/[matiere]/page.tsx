import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { buttonClass } from '@/components/auth/styles';
import { TeacherCard } from '@/components/marketplace/TeacherCard';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { BRAND_NAME } from '@/lib/brand';
import { getPool } from '@/lib/db/client';
import { getSitemapData } from '@/lib/marketplace/profile';
import { countLocalTeachers, searchTeachers } from '@/lib/marketplace/search';
import {
  buildSearchQuery,
  parseSearchParams,
} from '@/lib/marketplace/search-params';
import { pickName } from '@/lib/profile/catalogue';
import { alternatesFor } from '@/lib/site-url';

// Indexable landing pages such as /sfax/mathematiques (spec 3.1, 3.6).

type Props = {
  params: Promise<{ locale: string; gouvernorat: string; matiere: string }>;
};

async function loadPage(governorateSlug: string, subjectSlug: string) {
  const pool = getPool();
  const [governorate, subject] = await Promise.all([
    pool.query(
      'SELECT id, slug, name_fr, name_ar FROM governorates WHERE slug = $1 AND is_active',
      [governorateSlug],
    ),
    pool.query(
      `SELECT id, slug, name_fr, name_ar FROM subjects
        WHERE slug = $1 AND is_active AND status = 'approved'`,
      [subjectSlug],
    ),
  ]);
  if (!governorate.rows[0] || !subject.rows[0]) return null;
  const named = (row: {
    id: string;
    slug: string;
    name_fr: string;
    name_ar: string | null;
  }) => ({
    id: row.id,
    slug: row.slug,
    nameFr: row.name_fr,
    nameAr: row.name_ar,
  });
  const g = named(governorate.rows[0]);
  const s = named(subject.rows[0]);
  const local = await countLocalTeachers(pool, g.id, s.id);
  return { governorate: g, subject: s, local };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, gouvernorat, matiere } = await params;
  const page = await loadPage(gouvernorat, matiere);
  if (!page) return { robots: { index: false } };

  const t = await getTranslations({
    locale: locale as Locale,
    namespace: 'landing',
  });
  const values = {
    subject: pickName(page.subject, locale),
    governorate: pickName(page.governorate, locale),
    brand: BRAND_NAME,
  };
  return {
    title: t('metaTitle', values),
    description: t('metaDescription', values),
    alternates: alternatesFor(locale, `/${gouvernorat}/${matiere}`),
    // A page with nobody living in the city would only repeat the online teachers.
    robots: page.local === 0 ? { index: false, follow: true } : undefined,
  };
}

export default async function LandingPage({ params }: Props) {
  const { locale, gouvernorat, matiere } = await params;
  setRequestLocale(locale as Locale);

  const page = await loadPage(gouvernorat, matiere);
  if (!page) notFound();

  const t = await getTranslations('landing');
  const ts = await getTranslations('search');
  const filters = parseSearchParams({ gouvernorat, matiere });
  const [result, sitemap] = await Promise.all([
    searchTeachers(getPool(), filters),
    getSitemapData(getPool()),
  ]);
  const values = {
    subject: pickName(page.subject, locale),
    governorate: pickName(page.governorate, locale),
  };

  // Links to the sister pages that really have teachers (also good for search engines).
  const catalogue = await getPool().query<{
    slug: string;
    name_fr: string;
    name_ar: string | null;
    kind: 'governorate' | 'subject';
  }>(
    `SELECT slug, name_fr, name_ar, 'governorate' AS kind FROM governorates WHERE is_active
     UNION ALL
     SELECT slug, name_fr, name_ar, 'subject' FROM subjects WHERE is_active AND status = 'approved'`,
  );
  const nameOf = (kind: 'governorate' | 'subject', slug: string) => {
    const row = catalogue.rows.find((r) => r.kind === kind && r.slug === slug);
    return row
      ? pickName({ nameFr: row.name_fr, nameAr: row.name_ar }, locale)
      : slug;
  };
  const otherCities = sitemap.landings.filter(
    (l) => l.subject === matiere && l.governorate !== gouvernorat,
  );
  const otherSubjects = sitemap.landings.filter(
    (l) => l.governorate === gouvernorat && l.subject !== matiere,
  );
  const linkClass =
    'inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm font-medium text-primary hover:bg-secondary';

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold text-primary">{t('title', values)}</h1>
      <p className="mt-2 max-w-3xl text-muted">{t('intro', values)}</p>

      <p role="status" className="mt-6 font-medium text-primary">
        {ts('results', { count: result.total })}
      </p>
      {page.local === 0 && result.total > 0 && (
        <p className="mt-1 text-muted">{t('noLocal', values)}</p>
      )}

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
          <p className="font-semibold">{ts('empty.title')}</p>
          <p className="mt-1 text-muted">{ts('empty.body')}</p>
        </div>
      )}

      <Link
        href={`/recherche${buildSearchQuery(filters)}`}
        className={buttonClass + ' mt-6'}
      >
        {t('refine')}
      </Link>

      {otherCities.length > 0 && (
        <section className="mt-10" aria-labelledby="other-cities">
          <h2 id="other-cities" className="text-lg font-semibold text-primary">
            {t('otherCities', { subject: values.subject })}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-3">
            {otherCities.map((l) => (
              <li key={l.governorate}>
                <Link
                  href={`/${l.governorate}/${l.subject}`}
                  className={linkClass}
                >
                  {nameOf('governorate', l.governorate)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherSubjects.length > 0 && (
        <section className="mt-8" aria-labelledby="other-subjects">
          <h2
            id="other-subjects"
            className="text-lg font-semibold text-primary"
          >
            {t('otherSubjects', { governorate: values.governorate })}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-3">
            {otherSubjects.map((l) => (
              <li key={l.subject}>
                <Link
                  href={`/${l.governorate}/${l.subject}`}
                  className={linkClass}
                >
                  {nameOf('subject', l.subject)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p
        role="note"
        className="mt-10 rounded-md border border-border bg-secondary p-3 text-sm text-secondary-foreground"
      >
        {ts('safety', { brand: BRAND_NAME })}
      </p>
    </div>
  );
}
