import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buttonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { BRAND_NAME } from '@/lib/brand';
import { getFoundingSlots } from '@/lib/billing/founding';
import { listActivePlans, planPrice } from '@/lib/billing/plans';
import { getPool } from '@/lib/db/client';
import { formatMillimes } from '@/lib/money';
import { alternatesFor } from '@/lib/site-url';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: 'pages.becomeTeacher',
  });
  return {
    title: t('metaTitle', { brand: BRAND_NAME }),
    description: t('metaDescription'),
    alternates: alternatesFor(locale, '/devenir-professeur'),
  };
}

export default async function BecomeTeacherPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('pages.becomeTeacher');
  const pool = getPool();
  const [plans, founding] = await Promise.all([
    listActivePlans(pool),
    getFoundingSlots(pool),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-10 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-3xl font-bold text-primary">
          {t('title', { brand: BRAND_NAME })}
        </h1>
        <p className="mt-3 text-lg text-muted">
          {t('intro', { brand: BRAND_NAME })}
        </p>
      </header>

      <section aria-labelledby="steps">
        <h2 id="steps" className="text-xl font-semibold text-primary">
          {t('stepsTitle')}
        </h2>
        <ol className="mt-4 space-y-3">
          {(['step1', 'step2', 'step3', 'step4'] as const).map((key, index) => (
            <li key={key} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
              >
                {index + 1}
              </span>
              <span className="pt-0.5">{t(key)}</span>
            </li>
          ))}
        </ol>
      </section>

      {plans.length > 0 && (
        <section aria-labelledby="plans">
          <h2 id="plans" className="text-xl font-semibold text-primary">
            {t('plansTitle')}
          </h2>
          <p className="mt-2 text-muted">{t('plansIntro')}</p>
          <div className="mt-4 overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full text-start">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  {(
                    [
                      'colPlan',
                      'colDays',
                      'colVisibility',
                      'colBundle',
                    ] as const
                  ).map((key) => (
                    <th
                      key={key}
                      scope="col"
                      className="px-4 py-2 text-start font-medium"
                    >
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="border-t border-border">
                    <th
                      scope="row"
                      className="px-4 py-2 text-start font-medium"
                    >
                      {locale === 'ar' ? plan.nameAr : plan.nameFr}
                    </th>
                    <td className="px-4 py-2">
                      {t('days', { count: plan.durationDays })}
                    </td>
                    <td className="px-4 py-2" dir="ltr">
                      {formatMillimes(planPrice(plan, false), locale)}
                    </td>
                    <td className="px-4 py-2" dir="ltr">
                      {formatMillimes(planPrice(plan, true), locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {founding.left > 0 && (
        <p
          role="note"
          className="rounded-md border border-primary bg-secondary p-3 font-medium text-primary"
        >
          {t('founding', { count: founding.left })}
        </p>
      )}

      <Link href="/inscription" className={buttonClass}>
        {t('cta')}
      </Link>
    </div>
  );
}
