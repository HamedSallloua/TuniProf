import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { PinIcon } from '@/components/ui/icons';
import { secondaryButtonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import { summarizeLevels } from '@/lib/marketplace/levels';
import type { TeacherCard as Card } from '@/lib/marketplace/search';
import { formatMillimes } from '@/lib/money';
import { pickName } from '@/lib/profile/catalogue';
import { getStorage } from '@/lib/storage';
import { RatingStars } from './RatingStars';

const MAX_ZONES = 2;
const MAX_SUBJECTS = 3;

/** One result of the search (spec 3.3). It never shows a phone number. */
export async function TeacherCard({
  card,
  locale,
}: {
  card: Card;
  locale: string;
}) {
  const t = await getTranslations('card');
  const options = await getTranslations('profile.options');

  const zones = card.zones.map((zone) => pickName(zone, locale));
  const shownZones = zones.slice(0, MAX_ZONES);
  const hiddenZones = zones.length - shownZones.length;
  const subjects = card.subjects.slice(0, MAX_SUBJECTS);
  const hiddenSubjects = card.subjects.length - subjects.length;
  const levels = summarizeLevels(card.levels);
  const governorate = pickName(card.governorate, locale);
  const onlineOnly = card.modes.length === 1 && card.modes[0] === 'online';

  return (
    <article className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 sm:flex-row">
      <div className="shrink-0">
        {card.photoKey ? (
          <Image
            src={getStorage().publicUrl(card.photoKey)}
            alt={t('photoAlt', { name: card.fullName })}
            width={96}
            height={96}
            unoptimized
            className="size-24 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-24 items-center justify-center rounded-full bg-secondary text-3xl font-bold text-primary"
          >
            {card.fullName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="text-lg font-semibold text-primary">
          <Link
            href={`/prof/${card.slug}`}
            className="hover:text-accent hover:underline"
          >
            {card.fullName}
          </Link>
        </h3>

        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
          <PinIcon />
          <span>
            {governorate}
            {shownZones.length > 0 && !onlineOnly && (
              <>
                {' · '}
                {shownZones.join(', ')}
                {hiddenZones > 0 && ` ${t('more', { count: hiddenZones })}`}
              </>
            )}
            {onlineOnly && ` · ${t('onlineOnly')}`}
          </span>
        </p>

        <p className="text-sm">
          {subjects.map((s) => pickName(s, locale)).join(', ')}
          {hiddenSubjects > 0 && ` ${t('more', { count: hiddenSubjects })}`}
        </p>

        <p className="text-sm text-muted">
          {options(`diploma.${card.diploma}` as 'diploma.student')}
          {' · '}
          {t('experience', {
            value: options(
              `experience.${card.experience}` as 'experience.lt_1',
            ),
          })}
        </p>

        {levels.length > 0 && (
          <p className="text-sm text-muted">
            {levels
              .map(
                (group) =>
                  `${options(`cycle.${group.cycle}` as 'cycle.primaire')} ${group.grades}`,
              )
              .join(' · ')}
          </p>
        )}

        <p className="flex items-center gap-2 text-sm">
          {card.ratingCount > 0 ? (
            <>
              <RatingStars
                average={card.ratingAvg}
                label={t('rating', {
                  avg: card.ratingAvg.toFixed(1),
                  count: card.ratingCount,
                })}
              />
              <span>
                {card.ratingAvg.toFixed(1)} ({card.ratingCount})
              </span>
            </>
          ) : (
            <span className="text-muted">{t('noReviews')}</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
        <p className="font-semibold text-primary">
          {t('fromRate', {
            price: formatMillimes(card.fromRateMillimes, locale),
          })}
        </p>
        <Link href={`/prof/${card.slug}`} className={secondaryButtonClass}>
          {t('viewProfile')}
        </Link>
      </div>
    </article>
  );
}
