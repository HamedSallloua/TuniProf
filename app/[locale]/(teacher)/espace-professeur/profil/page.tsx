import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { StatusBanner } from '@/components/profile/StatusBanner';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db/client';
import { formatNationalPhone } from '@/lib/phone';
import { getFormCatalogue, pickName } from '@/lib/profile/catalogue';
import type { ProfileFormValues } from '@/lib/profile/form';
import { loadProfile } from '@/lib/profile/repo';
import { formatMillimesInput } from '@/lib/profile/rules';
import { getStorage } from '@/lib/storage';

export const metadata: Metadata = { robots: { index: false } };

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requirePermission('teacher:space', locale as Locale);

  const t = await getTranslations('profile');
  const ts = await getTranslations('auth.space');
  const pool = getPool();
  const [catalogue, profile] = await Promise.all([
    getFormCatalogue(pool),
    loadProfile(pool, user.id),
  ]);

  // An approved profile with a change waiting shows the proposed values: it is what the
  // teacher last typed, while the old version stays live.
  const waiting =
    profile?.status === 'approved' ? profile.pendingVersion : null;
  const shown = {
    fullName: waiting ? waiting.fullName : (profile?.fullName ?? null),
    bio: waiting ? waiting.bio : (profile?.bio ?? null),
    diploma: waiting ? waiting.diploma : (profile?.diploma ?? null),
    photoKey: waiting ? waiting.photoKey : (profile?.photoKey ?? null),
  };

  const initial: ProfileFormValues = {
    fullName: shown.fullName ?? '',
    diploma: shown.diploma ?? '',
    experience: profile?.experience ?? '',
    bio: shown.bio ?? '',
    governorate: profile?.governorateId ?? '',
    modes: profile?.modes ?? [],
    levels: profile?.levelIds ?? [],
    zones: profile?.zoneIds ?? [],
    subjects: Object.fromEntries(
      (profile?.subjects ?? []).map((s) => [
        s.subjectId,
        formatMillimesInput(s.rateMillimes),
      ]),
    ),
    customName: '',
    customRate: '',
  };

  const storage = getStorage();
  const liveKey = profile?.photoKey ?? null;
  const waitingKey =
    waiting && waiting.photoKey && waiting.photoKey !== liveKey
      ? waiting.photoKey
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/espace-professeur"
            className="text-primary underline underline-offset-2"
          >
            {ts('teacherTitle')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">{t('pageTitle')}</h1>
        <p className="text-muted">{t('intro')}</p>
      </header>

      <StatusBanner profile={profile} />

      <ProfileForm
        version={String(profile?.updatedAt?.getTime() ?? 0)}
        status={profile?.status ?? 'draft'}
        initial={initial}
        phoneDisplay={`+216 ${formatNationalPhone(user.phone)}`}
        governorates={catalogue.governorates.map((g) => ({
          id: g.id,
          name: pickName(g, locale),
        }))}
        delegations={catalogue.delegations.map((d) => ({
          id: d.id,
          governorateId: d.governorateId,
          name: pickName(d, locale),
        }))}
        levels={catalogue.levels.map((l) => ({
          id: l.id,
          cycle: l.cycle,
          name: pickName(l, locale),
        }))}
        subjects={catalogue.subjects.map((s) => ({
          id: s.id,
          name: pickName(s, locale),
        }))}
        waitingSubjects={(profile?.subjects ?? [])
          .filter((s) => s.status === 'pending')
          .map((s) => ({ id: s.subjectId, name: s.nameFr }))}
        rateRange={catalogue.rateRange}
        photo={{
          currentUrl: liveKey ? storage.publicUrl(liveKey) : null,
          waitingUrl: waitingKey ? storage.publicUrl(waitingKey) : null,
        }}
      />
    </div>
  );
}
