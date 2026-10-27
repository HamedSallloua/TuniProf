import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { numTag } from '@/components/auth/num-tag';
import { buttonClass } from '@/components/auth/styles';
import { CopyButton } from '@/components/billing/CopyButton';
import { Link, redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { getPaymentRequestByReference } from '@/lib/billing/payments';
import { getPlan } from '@/lib/billing/plans';
import { getPaymentSettings, paymentsAvailable } from '@/lib/billing/settings';
import { BRAND_NAME } from '@/lib/brand';
import { getPool } from '@/lib/db/client';
import { formatMillimes } from '@/lib/money';
import { formatNationalPhone } from '@/lib/phone';

export const metadata: Metadata = { robots: { index: false } };

export default async function PaymentInstructionsPage({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { locale, reference } = await params;
  setRequestLocale(locale as Locale);
  const user = await requirePermission('teacher:space', locale as Locale);

  const pool = getPool();
  // Always filtered by the signed-in teacher: someone else's reference finds nothing.
  const request = /^TTP-\d{5}$/.test(reference)
    ? await getPaymentRequestByReference(pool, user.id, reference)
    : null;
  if (!request)
    redirect({
      href: '/espace-professeur/abonnement',
      locale: locale as Locale,
    });
  const req = request!;

  const t = await getTranslations('subscription');
  const ti = await getTranslations('subscription.instructions');
  const [settings, plan] = await Promise.all([
    getPaymentSettings(pool),
    getPlan(pool, req.planId),
  ]);
  const available = paymentsAvailable(settings);

  const amount = formatMillimes(req.amountMillimes, locale);
  const planName = plan ? (locale === 'ar' ? plan.nameAr : plan.nameFr) : '';
  const planLabel =
    req.kind === 'upgrade'
      ? t('request.upgrade')
      : `${planName}${req.withDashboard ? ` (${t('request.withDashboard')})` : ''}`;
  const phone = `+216 ${formatNationalPhone(user.phone)}`;

  // The message the teacher sends with the proof (spec 4.3 step 3).
  const proofMessage = ti('proofMessage', {
    brand: BRAND_NAME,
    phone,
    reference: req.reference,
    plan: planLabel,
    amount,
  });
  const whatsappLink = `https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent(proofMessage)}`;
  const messengerLink = `https://m.me/${encodeURIComponent(settings.messengerPage)}?ref=${encodeURIComponent(req.reference)}`;

  const open = req.status === 'pending' || req.status === 'proof_received';
  const rich = { num: numTag };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/espace-professeur/abonnement"
            className="text-primary underline underline-offset-2"
          >
            {ti('back')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">{ti('title')}</h1>
        <p className="font-medium text-primary">
          {t(`requestStatus.${req.status}`)}
        </p>
      </header>

      {!open && (
        <p className="rounded-card border border-border bg-surface p-5">
          {ti('closed')}
          {req.status === 'rejected' && req.note ? ` ${req.note}` : ''}
        </p>
      )}

      {open && !available && (
        <p className="rounded-card border border-border bg-surface p-5 text-muted">
          {t('errors.unavailable')}
        </p>
      )}

      {open && available && (
        <>
          {!settings.configured && (
            <p
              role="note"
              className="rounded-md border border-dashed border-accent p-3 text-sm text-accent"
            >
              {ti('demo')}
            </p>
          )}

          <section className="space-y-3 rounded-card border border-primary bg-secondary p-5">
            <p className="text-lg">
              {ti.rich('intro', { amount, reference: req.reference, ...rich })}
            </p>
            <p className="text-sm">{ti('referenceNote')}</p>
            <p className="text-sm text-muted">{planLabel}</p>
          </section>

          <section className="space-y-2 rounded-card border border-border bg-surface p-5">
            <h2 className="font-semibold text-primary">
              {t(`methods.${req.method}`)}
            </h2>
            <p>
              {req.method === 'flouci' &&
                ti.rich('flouci', {
                  number: settings.flouciNumber,
                  name: settings.beneficiaryName,
                  ...rich,
                })}
              {req.method === 'd17' &&
                ti.rich('d17', {
                  info: settings.d17Info,
                  name: settings.beneficiaryName,
                  ...rich,
                })}
              {req.method === 'ccp' &&
                ti.rich('ccp', {
                  number: settings.ccpNumber,
                  name: settings.beneficiaryName,
                  ...rich,
                })}
            </p>
            {/* The Arabic helper lines of the owner's brief, word for word. Empty until provided. */}
            {settings.helperLinesAr.length > 0 && (
              <ul
                lang="ar"
                dir="rtl"
                className="space-y-1 border-t border-border pt-3"
              >
                {settings.helperLinesAr.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-card border border-border bg-surface p-5">
            <h2 className="font-semibold text-primary">{ti('proofTitle')}</h2>
            <p>{ti('proofBody')}</p>
            <blockquote className="rounded-md border border-border bg-background p-3 text-sm whitespace-pre-line">
              {proofMessage}
            </blockquote>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass}
              >
                {ti('whatsapp')}
              </a>
              <a
                href={messengerLink}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass}
              >
                {ti('messenger')}
              </a>
              <CopyButton
                text={proofMessage}
                label={ti('copyMessage')}
                copiedLabel={ti('copied')}
              />
            </div>
            <p className="text-sm text-muted">{ti('messengerHint')}</p>
            <p className="text-sm text-muted">
              {ti('hours', { hours: settings.workingHours })}
            </p>
          </section>

          <section className="space-y-1 rounded-card border border-border bg-surface p-5">
            <h2 className="font-semibold text-primary">{ti('nextTitle')}</h2>
            <p>{ti('nextBody')}</p>
          </section>

          <p className="text-sm text-muted">{ti('footer')}</p>
        </>
      )}
    </div>
  );
}
