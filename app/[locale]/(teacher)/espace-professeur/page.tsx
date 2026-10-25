import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { numTag } from '@/components/auth/num-tag';
import { buttonClass, secondaryButtonClass } from '@/components/auth/ui';
import { StatusBanner } from '@/components/profile/StatusBanner';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db/client';
import { formatNationalPhone } from '@/lib/phone';
import { loadProfile } from '@/lib/profile/repo';
import { listMissingFields } from '@/lib/profile/rules';
import { logoutAction } from '../../(account)/actions';
import { toggleListingAction } from '../profile-actions';

export const metadata: Metadata = { robots: { index: false } };

export default async function TeacherHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requirePermission('teacher:space', locale as Locale);
  const { submitted } = await searchParams;

  const t = await getTranslations('profile');
  const ta = await getTranslations('auth.space');
  const profile = await loadProfile(getPool(), user.id);
  const status = profile?.status ?? 'draft';

  const missing = profile
    ? listMissingFields({
        fullName: profile.fullName,
        diploma: profile.diploma,
        experience: profile.experience,
        bio: profile.bio,
        governorateId: profile.governorateId,
        modes: profile.modes,
        levelCount: profile.levelIds.length,
        subjectCount: profile.subjects.length,
        zoneCount: profile.zoneIds.length,
        phoneVerified: profile.phoneVerified,
      })
    : ([
        'fullName',
        'diploma',
        'experience',
        'bio',
        'governorate',
        'modes',
        'levels',
        'subjects',
      ] as const);

  const editLabel =
    status === 'draft'
      ? t('home.completeProfile')
      : status === 'rejected'
        ? t('home.fixProfile')
        : t('home.editProfile');

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-bold text-primary">
          {ta('teacherTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {ta.rich('hello', {
            phone: `+216 ${formatNationalPhone(user.phone)}`,
            num: numTag,
          })}
        </p>
      </header>

      {submitted === '1' && (
        <p
          role="status"
          className="rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
        >
          {t('notices.submitted')}
        </p>
      )}

      <StatusBanner profile={profile} />

      {(status === 'draft' || status === 'rejected') && missing.length > 0 && (
        <section className="rounded-card border border-border bg-surface p-4">
          <h2 className="font-semibold text-primary">
            {t('home.missingTitle')}
          </h2>
          <ul className="mt-2 list-disc space-y-1 ps-6 text-sm">
            {missing.map((field) => (
              <li key={field}>{t(`missing.${field}`)}</li>
            ))}
          </ul>
        </section>
      )}

      {status !== 'suspended' && (
        <p>
          <Link href="/espace-professeur/profil" className={buttonClass}>
            {editLabel}
          </Link>
        </p>
      )}

      {status === 'approved' && profile && (
        <section className="rounded-card border border-border bg-surface p-4">
          <h2 className="font-semibold text-primary">
            {t('home.listingTitle')}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {profile.isListed ? t('home.listingOn') : t('home.listingOff')}
          </p>
          <form action={toggleListingAction} className="mt-3">
            <input
              type="hidden"
              name="listed"
              value={profile.isListed ? 'false' : 'true'}
            />
            <button type="submit" className={secondaryButtonClass}>
              {profile.isListed
                ? t('home.listingPause')
                : t('home.listingResume')}
            </button>
          </form>
          <p className="mt-3 text-sm text-muted">
            {t('home.subscriptionSoon')}
          </p>
        </section>
      )}

      <form action={logoutAction}>
        <button type="submit" className={secondaryButtonClass}>
          {ta('logout')}
        </button>
      </form>
    </div>
  );
}
