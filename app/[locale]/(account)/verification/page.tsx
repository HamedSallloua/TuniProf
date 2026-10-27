import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard } from '@/components/auth/AuthCard';
import { numTag } from '@/components/auth/num-tag';
import {
  AutoRefresh,
  AutoSubmitForm,
} from '@/components/auth/VerificationHelpers';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';
import { SubmitButton } from '@/components/auth/ui';
import { Link, redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getDeviceContext } from '@/lib/auth/device';
import { getChallengeView } from '@/lib/auth/verification';
import { BRAND_NAME } from '@/lib/brand';
import { getPool } from '@/lib/db/client';
import { formatNationalPhone } from '@/lib/phone';
import { getVerificationProvider } from '@/lib/verification-provider';
import { finishVerificationAction, simulateWhatsAppAction } from '../actions';

export const metadata: Metadata = { robots: { index: false } };

// Where to start again, depending on what the person was doing.
const RESTART_PATH = {
  signup: '/inscription',
  reset: '/mot-de-passe-oublie',
  visitor_login: '/connexion-avis',
} as const;

export default async function VerificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { locale: rawLocale } = await params;
  setRequestLocale(rawLocale as Locale);
  const locale = rawLocale as Locale;
  const { c } = await searchParams;

  const device = await getDeviceContext({ create: false });
  const view =
    device && c
      ? await getChallengeView(getPool(), c, device.deviceHash)
      : null;
  if (!view || view.status === 'consumed') {
    redirect({ href: '/connexion', locale });
  }
  const challenge = view!;

  // Password reset: the next screen asks for the new password.
  if (challenge.status === 'verified' && challenge.purpose === 'reset') {
    redirect({
      href: {
        pathname: '/mot-de-passe-oublie/nouveau',
        query: { c: challenge.id },
      },
      locale,
    });
  }

  const t = await getTranslations('auth.verify');
  const provider = getVerificationProvider();
  const phone = `+216 ${formatNationalPhone(challenge.phone)}`;

  return (
    <AuthCard title={t('title')}>
      {challenge.status === 'pending' && challenge.code && (
        <div className="space-y-5">
          <AutoRefresh />
          <p>
            {t.rich('intro', {
              phone,
              num: numTag,
            })}
          </p>
          <p className="text-sm text-muted">{t('codeLabel')}</p>
          <p
            dir="ltr"
            className="rounded-card border border-primary bg-secondary py-4 text-center font-mono text-3xl font-bold tracking-widest text-primary"
          >
            {challenge.code}
          </p>
          <a
            href={provider.buildWaLink(
              t('message', { brand: BRAND_NAME, code: challenge.code }),
            )}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass + ' w-full'}
          >
            {t('openWhatsApp')}
          </a>
          <p className="text-sm text-muted">
            {t.rich('orManual', {
              number: `+${provider.platformNumber()}`,
              num: numTag,
            })}
          </p>
          <p className="text-sm text-muted">{t('validFor')}</p>
          <p role="status" aria-live="polite" className="text-sm font-medium">
            {t('waiting')}
          </p>

          {provider.name === 'dev-stub' && (
            <form
              action={simulateWhatsAppAction}
              className="space-y-2 rounded-card border border-dashed border-accent p-4"
            >
              <p className="font-semibold text-accent">{t('devTitle')}</p>
              <p className="text-sm text-muted">{t('devText')}</p>
              <input type="hidden" name="challenge" value={challenge.id} />
              <button type="submit" className={secondaryButtonClass}>
                {t('devButton')}
              </button>
            </form>
          )}
        </div>
      )}

      {challenge.status === 'verified' && (
        <AutoSubmitForm action={finishVerificationAction}>
          <input type="hidden" name="challenge" value={challenge.id} />
          <p role="status" className="mb-4 font-medium text-primary">
            {t('verified')}
          </p>
          <SubmitButton>{t('continue')}</SubmitButton>
        </AutoSubmitForm>
      )}

      {(challenge.status === 'expired' || challenge.status === 'locked') && (
        <div className="space-y-4">
          <p role="alert" className="text-accent">
            {challenge.status === 'expired' ? t('expired') : t('locked')}
          </p>
          <Link
            href={RESTART_PATH[challenge.purpose]}
            className={secondaryButtonClass}
          >
            {t('restart')}
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
