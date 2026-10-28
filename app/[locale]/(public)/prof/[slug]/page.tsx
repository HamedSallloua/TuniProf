import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/marketplace/JsonLd';
import { RatingStars } from '@/components/marketplace/RatingStars';
import { ReportForm } from '@/components/marketplace/ReportForm';
import { RevealContact } from '@/components/marketplace/RevealContact';
import { ReviewSection } from '@/components/reviews/ReviewSection';
import { ArrowIcon, PinIcon } from '@/components/ui/icons';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { BRAND_NAME } from '@/lib/brand';
import { getPool } from '@/lib/db/client';
import { getSiteUrl, getTurnstileConfig } from '@/lib/env';
import { inGovernorate } from '@/lib/marketplace/french';
import { summarizeLevels } from '@/lib/marketplace/levels';
import { getPublicProfile } from '@/lib/marketplace/profile';
import { formatMillimes } from '@/lib/money';
import { pickName } from '@/lib/profile/catalogue';
import { alternatesFor, pageUrl } from '@/lib/site-url';
import { getStorage } from '@/lib/storage';

type Props = { params: Promise<{ locale: string; slug: string }> };

function excerpt(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const profile = await getPublicProfile(getPool(), slug);
  // A hidden profile has no page: the page answers 404 and must not be indexed.
  if (!profile) return { robots: { index: false } };

  const t = await getTranslations({
    locale: locale as Locale,
    namespace: 'publicProfile',
  });
  return {
    title: t('metaTitle', {
      name: profile.fullName,
      governorateIn: inGovernorate(
        pickName(profile.governorate, locale),
        locale,
      ),
      brand: BRAND_NAME,
    }),
    description: excerpt(profile.bio),
    alternates: alternatesFor(locale, `/prof/${profile.slug}`),
  };
}

export default async function ProfilePage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);

  const profile = await getPublicProfile(getPool(), slug);
  if (!profile) notFound();

  const t = await getTranslations('publicProfile');
  const options = await getTranslations('profile.options');
  const governorate = pickName(profile.governorate, locale);
  const levels = summarizeLevels(profile.levels);
  const onlineOnly =
    profile.modes.length === 1 && profile.modes[0] === 'online';
  const onlineToo = profile.modes.includes('online');
  const ratingLabel = t('rating', {
    avg: profile.ratingAvg.toFixed(1),
    count: profile.ratingCount,
  });
  const photoUrl = profile.photoKey
    ? getStorage().publicUrl(profile.photoKey)
    : null;

  // schema.org (spec 3.6). Never the phone number; the rating only when real reviews exist.
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    name: profile.fullName,
    description: excerpt(profile.bio, 300),
    url: pageUrl(locale, `/prof/${profile.slug}`),
    areaServed: { '@type': 'AdministrativeArea', name: governorate },
    address: {
      '@type': 'PostalAddress',
      addressRegion: governorate,
      addressCountry: 'TN',
    },
    ...(photoUrl
      ? {
          image: photoUrl.startsWith('http')
            ? photoUrl
            : `${getSiteUrl()}${photoUrl}`,
        }
      : {}),
    ...(profile.ratingCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: profile.ratingAvg.toFixed(1),
            reviewCount: profile.ratingCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  const sectionTitle = 'text-lg font-semibold text-primary';

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <JsonLd data={jsonLd} />

      <Link
        href="/recherche"
        className="inline-flex min-h-11 items-center gap-2 text-primary underline underline-offset-2 hover:text-accent"
      >
        <ArrowIcon className="size-4 rotate-180 rtl:rotate-0" />
        {t('back')}
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {photoUrl ? (
              <Image
                src={photoUrl}
                alt={profile.fullName}
                width={160}
                height={160}
                unoptimized
                priority
                className="size-32 rounded-full object-cover sm:size-40"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex size-32 items-center justify-center rounded-full bg-secondary text-5xl font-bold text-primary sm:size-40"
              >
                {profile.fullName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-primary">
                {profile.fullName}
              </h1>
              <p className="flex flex-wrap items-center gap-x-1.5 text-muted">
                <PinIcon />
                <span>
                  {governorate}
                  {!onlineOnly &&
                    profile.zones.length > 0 &&
                    ` · ${profile.zones.map((z) => pickName(z, locale)).join(', ')}`}
                </span>
              </p>
              <p className="text-muted">
                {options(`diploma.${profile.diploma}` as 'diploma.student')}
                {' · '}
                {t('experience', {
                  value: options(
                    `experience.${profile.experience}` as 'experience.lt_1',
                  ),
                })}
              </p>
              <p className="flex items-center gap-2">
                {profile.ratingCount > 0 ? (
                  <>
                    <RatingStars
                      average={profile.ratingAvg}
                      label={ratingLabel}
                    />
                    <span>
                      {profile.ratingAvg.toFixed(1)} ({profile.ratingCount})
                    </span>
                  </>
                ) : (
                  <span className="text-muted">{t('noRating')}</span>
                )}
              </p>
            </div>
          </header>

          <section aria-labelledby="about">
            <h2 id="about" className={sectionTitle}>
              {t('about')}
            </h2>
            {/* React escapes the text: a bio can never inject markup. */}
            <p className="mt-2 whitespace-pre-line">{profile.bio}</p>
          </section>

          <section aria-labelledby="subjects">
            <h2 id="subjects" className={sectionTitle}>
              {t('subjects')}
            </h2>
            <div className="mt-2 overflow-x-auto rounded-card border border-border bg-surface">
              <table className="w-full text-start">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-2 text-start font-medium"
                    >
                      {t('subject')}
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-start font-medium"
                    >
                      {t('rate')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {profile.subjects.map((subject) => (
                    <tr key={subject.slug} className="border-t border-border">
                      <td className="px-4 py-2">{pickName(subject, locale)}</td>
                      <td className="px-4 py-2">
                        {t('perHour', {
                          price: formatMillimes(subject.rateMillimes, locale),
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="levels">
            <h2 id="levels" className={sectionTitle}>
              {t('levels')}
            </h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {levels.map((group) => (
                <li
                  key={group.cycle}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-sm"
                >
                  {options(`cycle.${group.cycle}` as 'cycle.primaire')}{' '}
                  <bdi dir="ltr">{group.grades}</bdi>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="modes">
            <h2 id="modes" className={sectionTitle}>
              {t('modes')}
            </h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {profile.modes.map((mode) => (
                <li
                  key={mode}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-sm"
                >
                  {options(`mode.${mode}` as 'mode.online')}
                </li>
              ))}
            </ul>
            {onlineToo && (
              <p className="mt-2 text-sm text-muted">{t('onlineEverywhere')}</p>
            )}
          </section>

          <section aria-labelledby="reviews">
            <h2 id="reviews" className={sectionTitle}>
              {t('reviews')}
            </h2>
            <ReviewSection
              teacherId={profile.userId}
              slug={profile.slug}
              noReviewsLabel={t('noReviews')}
            />
          </section>

          <ReportForm slug={profile.slug} />
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="space-y-4 rounded-card border border-border bg-surface p-5">
            <h2 className={sectionTitle}>{t('contactTitle')}</h2>
            <RevealContact
              slug={profile.slug}
              brand={BRAND_NAME}
              turnstileSiteKey={getTurnstileConfig()?.siteKey ?? null}
            />
            <p
              role="note"
              className="rounded-md bg-secondary p-3 text-sm text-secondary-foreground"
            >
              {t('safety', { brand: BRAND_NAME })}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
