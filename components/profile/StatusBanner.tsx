import { getTranslations } from 'next-intl/server';
import { isRejectionReason } from '@/lib/profile/rules';
import type { TeacherProfile } from '@/lib/profile/repo';

// The status banner of the teacher home (spec 4.4): where the profile stands, and why.

type Tone = 'info' | 'success' | 'warning';

const TONE_CLASS: Record<Tone, string> = {
  info: 'border-border bg-surface',
  success: 'border-primary bg-secondary',
  warning: 'border-accent bg-secondary',
};

function Banner({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-card border p-4 ${TONE_CLASS[tone]}`}
    >
      <h2 className="font-semibold text-primary">{title}</h2>
      <div className="mt-1 space-y-1 text-sm">{children}</div>
    </section>
  );
}

export async function StatusBanner({
  profile,
}: {
  profile: TeacherProfile | null;
}) {
  const t = await getTranslations('profile');
  const status = profile?.status ?? 'draft';

  /** Template reason in the page language, plus the admin's note. */
  const reasonText = (reason: string | null, note: string | null) => (
    <>
      {reason && (
        <p className="font-medium">
          {isRejectionReason(reason)
            ? t(`reasons.${reason}`)
            : t('reasons.other')}
        </p>
      )}
      {note && <p>{note}</p>}
    </>
  );

  return (
    <div className="space-y-3">
      {status === 'draft' && (
        <Banner tone="info" title={t('banner.draft.title')}>
          <p>{t('banner.draft.body')}</p>
        </Banner>
      )}
      {status === 'pending' && (
        <Banner tone="info" title={t('banner.pending.title')}>
          <p>{t('banner.pending.body')}</p>
        </Banner>
      )}
      {status === 'rejected' && profile && (
        <Banner tone="warning" title={t('banner.rejected.title')}>
          <p>{t('banner.rejected.body')}</p>
          <p className="text-muted">{t('banner.rejected.reasonLabel')} :</p>
          {reasonText(profile.rejectionReason, profile.rejectionNote)}
        </Banner>
      )}
      {status === 'approved' && (
        <Banner tone="success" title={t('banner.approved.title')}>
          <p>{t('banner.approved.body')}</p>
        </Banner>
      )}
      {status === 'suspended' && profile && (
        <Banner tone="warning" title={t('banner.suspended.title')}>
          <p>{t('banner.suspended.body')}</p>
          {profile.suspensionReason && (
            <p>
              <span className="text-muted">
                {t('banner.suspended.reasonLabel')} :{' '}
              </span>
              {profile.suspensionReason}
            </p>
          )}
        </Banner>
      )}

      {status === 'approved' && profile?.pendingVersion && (
        <Banner tone="info" title={t('banner.versionPending.title')}>
          <p>{t('banner.versionPending.body')}</p>
        </Banner>
      )}
      {status === 'approved' && profile?.versionRejectionReason && (
        <Banner tone="warning" title={t('banner.versionRejected.title')}>
          <p>{t('banner.versionRejected.body')}</p>
          <p className="text-muted">
            {t('banner.versionRejected.reasonLabel')} :
          </p>
          {reasonText(
            profile.versionRejectionReason,
            profile.versionRejectionNote,
          )}
        </Banner>
      )}
    </div>
  );
}
