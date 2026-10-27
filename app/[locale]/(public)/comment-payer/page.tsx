import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buttonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { BRAND_NAME } from '@/lib/brand';
import { getPaymentSettings, paymentsAvailable } from '@/lib/billing/settings';
import { getPool } from '@/lib/db/client';
import { alternatesFor } from '@/lib/site-url';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: 'pages.howToPay',
  });
  return {
    title: t('metaTitle', { brand: BRAND_NAME }),
    description: t('metaDescription'),
    alternates: alternatesFor(locale, '/comment-payer'),
  };
}

export default async function HowToPayPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('pages.howToPay');
  const payment = await getPaymentSettings(getPool());
  const available = paymentsAvailable(payment);

  const methods = [
    { key: 'flouci', value: payment.flouciNumber },
    { key: 'd17', value: payment.d17Info },
    { key: 'ccp', value: payment.ccpNumber },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-10 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-3xl font-bold text-primary">{t('title')}</h1>
        <p className="mt-3 text-lg text-muted">{t('intro')}</p>
      </header>

      <section aria-labelledby="steps">
        <h2 id="steps" className="text-xl font-semibold text-primary">
          {t('stepsTitle')}
        </h2>
        <ol className="mt-4 space-y-3">
          {(['step1', 'step2', 'step3', 'step4', 'step5'] as const).map(
            (key, index) => (
              <li key={key} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
                >
                  {index + 1}
                </span>
                <span className="pt-0.5">{t(key)}</span>
              </li>
            ),
          )}
        </ol>
      </section>

      <section aria-labelledby="methods">
        <h2 id="methods" className="text-xl font-semibold text-primary">
          {t('methodsTitle')}
        </h2>

        {available ? (
          <div className="mt-4 space-y-4">
            {!payment.configured && (
              <p
                role="note"
                className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
              >
                {t('devPlaceholder')}
              </p>
            )}
            <dl className="divide-y divide-border rounded-card border border-border bg-surface">
              <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
                <dt className="font-medium">{t('beneficiary')}</dt>
                <dd>{payment.beneficiaryName}</dd>
              </div>
              {methods.map((method) => (
                <div
                  key={method.key}
                  className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]"
                >
                  <dt className="font-medium">{t(method.key)}</dt>
                  <dd dir="ltr" className="text-start">
                    {method.value}
                  </dd>
                </div>
              ))}
              {payment.workingHours && (
                <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
                  <dt className="font-medium">{t('hours')}</dt>
                  <dd>
                    {payment.workingHours}
                    <span className="block text-sm text-muted">
                      {t('responseTime')}
                    </span>
                  </dd>
                </div>
              )}
            </dl>

            {/* The owner's Arabic lines, word for word; empty until they are provided. */}
            {locale === 'ar' && payment.helperLinesAr.length > 0 && (
              <div className="space-y-1 rounded-card border border-border bg-surface p-4">
                {payment.helperLinesAr.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-muted">{t('notConfigured')}</p>
        )}
      </section>

      <p
        role="note"
        className="rounded-md bg-secondary p-3 text-secondary-foreground"
      >
        {t('note')}
      </p>

      <Link href="/espace-professeur/abonnement" className={buttonClass}>
        {t('cta')}
      </Link>
    </div>
  );
}
