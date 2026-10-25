import type { Metadata } from 'next';
import Image from 'next/image';
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import { z } from 'zod';
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
} from '@/components/auth/ui';
import { Link, redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db/client';
import { formatNationalPhone } from '@/lib/phone';
import { formatMillimesInput, REJECTION_REASONS } from '@/lib/profile/rules';
import { loadForReview } from '@/lib/profile/review';
import { getStorage } from '@/lib/storage';
import {
  approveProfileAction,
  approveVersionAction,
  rejectProfileAction,
  rejectVersionAction,
  restoreProfileAction,
  suspendProfileAction,
} from '../../../review-actions';

export const metadata: Metadata = { robots: { index: false } };

const FLASH = ['suspended', 'restored'];

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default async function ReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; userId: string }>;
  searchParams: Promise<{ flash?: string; error?: string }>;
}) {
  const { locale, userId } = await params;
  setRequestLocale(locale as Locale);
  await requirePermission('admin:panel', locale as Locale);
  const { flash, error } = await searchParams;

  if (!z.string().uuid().safeParse(userId).success) {
    redirect({ href: '/admin/profils', locale: locale as Locale });
  }
  const detail = await loadForReview(getPool(), userId);
  if (!detail) redirect({ href: '/admin/profils', locale: locale as Locale });
  const { profile, phone, governorateName, zoneNames, levelNames } = detail!;

  const t = await getTranslations('admin');
  const tp = await getTranslations('profile');
  const format = await getFormatter();
  const storage = getStorage();
  const version = profile.status === 'approved' ? profile.pendingVersion : null;

  const dash = t('detail.none');
  const photo = (key: string | null) =>
    key ? (
      <Image
        src={storage.publicUrl(key)}
        alt=""
        width={96}
        height={96}
        unoptimized
        className="size-24 rounded-md border border-border object-cover"
      />
    ) : (
      <span className="text-muted">{t('detail.noPhoto')}</span>
    );
  const diploma = (code: string | null) =>
    code ? tp(`options.diploma.${code}` as 'options.diploma.student') : dash;

  const reasonOptions = (
    <>
      <option value="">{t('actions.chooseReason')}</option>
      {REJECTION_REASONS.map((reason) => (
        <option key={reason} value={reason}>
          {tp(`reasons.${reason}`)}
        </option>
      ))}
    </>
  );

  const rejectForm = (
    action: (formData: FormData) => Promise<void>,
    label: string,
  ) => (
    <form
      action={action}
      className="space-y-2 rounded-card border border-border p-4"
    >
      <input type="hidden" name="userId" value={userId} />
      <label className="block text-sm font-medium">
        {t('actions.reason')}
        <select name="reason" required className={inputClass + ' mt-1'}>
          {reasonOptions}
        </select>
      </label>
      <label className="block text-sm font-medium">
        {t('actions.note')}
        <textarea
          name="note"
          rows={2}
          maxLength={500}
          className={inputClass + ' mt-1'}
        />
      </label>
      <button type="submit" className={secondaryButtonClass}>
        {label}
      </button>
    </form>
  );

  const simpleForm = (
    action: (formData: FormData) => Promise<void>,
    label: string,
  ) => (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" className={buttonClass}>
        {label}
      </button>
    </form>
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/admin/profils"
            className="text-primary underline underline-offset-2"
          >
            {t('detail.back')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">
          {profile.fullName ?? t('unnamed')}
        </h1>
        <p className="text-sm text-muted">
          {t('detail.status')} :{' '}
          <strong>{tp(`status.${profile.status}`)}</strong>
          {profile.submittedAt && (
            <>
              {' - '}
              {t('detail.submittedAt')}{' '}
              {format.dateTime(profile.submittedAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </>
          )}
        </p>
      </header>

      {flash && FLASH.includes(flash) && (
        <p
          role="status"
          className="rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
        >
          {t(`flash.${flash}` as 'flash.suspended')}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
        >
          {t(
            `errors.${['forbidden', 'not_found', 'invalid_state', 'incomplete', 'invalid_reason'].includes(error) ? error : 'generic'}` as 'errors.generic',
          )}
        </p>
      )}

      <section className="space-y-3 rounded-card border border-border bg-surface p-5">
        <dl className="space-y-3">
          <Row label={t('detail.phone')}>
            <bdi dir="ltr">
              +216 {formatNationalPhone(phone.replace('+216', '+216'))}
            </bdi>
          </Row>
          <Row label={t('detail.fullName')}>{profile.fullName ?? dash}</Row>
          <Row label={t('detail.photo')}>{photo(profile.photoKey)}</Row>
          <Row label={t('detail.diploma')}>{diploma(profile.diploma)}</Row>
          <Row label={t('detail.experience')}>
            {profile.experience
              ? tp(
                  `options.experience.${profile.experience}` as 'options.experience.lt_1',
                )
              : dash}
          </Row>
          <Row label={t('detail.bio')}>
            <p className="whitespace-pre-line">{profile.bio ?? dash}</p>
          </Row>
          <Row label={t('detail.modes')}>
            {profile.modes.length
              ? profile.modes.map((m) => tp(`options.mode.${m}`)).join(', ')
              : dash}
          </Row>
          <Row label={t('detail.governorate')}>{governorateName ?? dash}</Row>
          <Row label={t('detail.zones')}>
            {zoneNames.length ? zoneNames.join(', ') : dash}
          </Row>
          <Row label={t('detail.levels')}>
            {levelNames.length ? levelNames.join(', ') : dash}
          </Row>
          <Row label={t('detail.subjects')}>
            {profile.subjects.length ? (
              <ul className="space-y-1">
                {profile.subjects.map((s) => (
                  <li key={s.subjectId}>
                    {s.nameFr} - {formatMillimesInput(s.rateMillimes)} DT
                    {s.status === 'pending' && (
                      <span className="ms-2 text-xs text-accent">
                        ({t('detail.pendingSubject')})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              dash
            )}
          </Row>
          {profile.slug && (
            <Row label={t('detail.address')}>
              <bdi dir="ltr">/prof/{profile.slug}</bdi>
            </Row>
          )}
        </dl>
      </section>

      {version && (
        <section className="space-y-3 rounded-card border border-accent bg-secondary p-5">
          <h2 className="font-semibold text-accent">
            {t('detail.versionTitle')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('detail.current')}</h3>
              <p>{profile.fullName}</p>
              {photo(profile.photoKey)}
              <p>{diploma(profile.diploma)}</p>
              <p className="text-sm whitespace-pre-line">{profile.bio}</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('detail.proposed')}</h3>
              <p>{version.fullName}</p>
              {photo(version.photoKey)}
              <p>{diploma(version.diploma)}</p>
              <p className="text-sm whitespace-pre-line">{version.bio}</p>
            </div>
          </div>
        </section>
      )}

      <div className="space-y-4">
        {profile.status === 'pending' && (
          <>
            {simpleForm(approveProfileAction, t('actions.approve'))}
            {rejectForm(rejectProfileAction, t('actions.reject'))}
          </>
        )}
        {version && (
          <>
            {simpleForm(approveVersionAction, t('actions.approveVersion'))}
            {rejectForm(rejectVersionAction, t('actions.rejectVersion'))}
          </>
        )}
        {profile.status === 'approved' && (
          <form
            action={suspendProfileAction}
            className="space-y-2 rounded-card border border-border p-4"
          >
            <input type="hidden" name="userId" value={userId} />
            <label className="block text-sm font-medium">
              {t('actions.suspendReason')}
              <textarea
                name="reason"
                rows={2}
                maxLength={500}
                required
                className={inputClass + ' mt-1'}
              />
            </label>
            <button type="submit" className={secondaryButtonClass}>
              {t('actions.suspend')}
            </button>
          </form>
        )}
        {profile.status === 'suspended' && (
          <>
            {profile.suspensionReason && (
              <p className="text-sm text-muted">{profile.suspensionReason}</p>
            )}
            {simpleForm(restoreProfileAction, t('actions.restore'))}
          </>
        )}
      </div>
    </div>
  );
}
