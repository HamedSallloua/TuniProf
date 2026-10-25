import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthCard } from '@/components/auth/AuthCard';
import { NewPasswordForm } from '@/components/auth/forms';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getDeviceContext } from '@/lib/auth/device';
import { getChallengeView } from '@/lib/auth/verification';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

export default async function NewPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const { c } = await searchParams;

  // Only the browser that did the WhatsApp check, with a verified reset challenge.
  const device = await getDeviceContext({ create: false });
  const view =
    device && c
      ? await getChallengeView(getPool(), c, device.deviceHash)
      : null;
  if (!view || view.purpose !== 'reset' || view.status !== 'verified') {
    redirect({ href: '/mot-de-passe-oublie', locale: locale as Locale });
  }

  const t = await getTranslations('auth.reset');
  return (
    <AuthCard title={t('newTitle')} intro={t('newIntro')}>
      <NewPasswordForm challengeId={view!.id} />
    </AuthCard>
  );
}
