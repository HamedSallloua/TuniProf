import type { Metadata } from 'next';
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import {
  PlanForm,
  RedeemForm,
  UpgradeForm,
  type PlanCard,
} from '@/components/billing/BillingForms';
import { secondaryButtonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { findIssuedCodeForTeacher } from '@/lib/billing/codes';
import {
  dashboardAccess,
  daysLeft,
  getEntitlements,
  GRACE_DAYS,
  DAY_MS,
} from '@/lib/billing/entitlements';
import { getFoundingSlots } from '@/lib/billing/founding';
import {
  getUpgradeOffer,
  listPaymentRequestsForTeacher,
} from '@/lib/billing/payments';
import {
  listActivePlans,
  planPrice,
  pricePerMonth,
  savingPercent,
} from '@/lib/billing/plans';
import { getPaymentSettings, paymentsAvailable } from '@/lib/billing/settings';
import { getPool } from '@/lib/db/client';
import { formatMillimes } from '@/lib/money';
import { loadProfile } from '@/lib/profile/repo';
import { cancelRequestAction } from '../../billing-actions';

export const metadata: Metadata = { robots: { index: false } };

export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requirePermission('teacher:space', locale as Locale);

  const t = await getTranslations('subscription');
  const ta = await getTranslations('auth.space');
  const format = await getFormatter();
  const pool = getPool();
  const now = new Date();

  const [
    profile,
    entitlements,
    plans,
    requests,
    issued,
    payments,
    founding,
    upgrade,
  ] = await Promise.all([
    loadProfile(pool, user.id),
    getEntitlements(pool, user.id),
    listActivePlans(pool),
    listPaymentRequestsForTeacher(pool, user.id),
    findIssuedCodeForTeacher(pool, user.id, now),
    getPaymentSettings(pool),
    getFoundingSlots(pool),
    getUpgradeOffer(pool, user.id, now),
  ]);
  const open = requests.find(
    (r) => r.status === 'pending' || r.status === 'proof_received',
  );
  const planName = (id: string) => {
    const plan = plans.find((p) => p.id === id);
    return plan ? (locale === 'ar' ? plan.nameAr : plan.nameFr) : '';
  };
  const date = (value: Date) => format.dateTime(value, { dateStyle: 'long' });

  // The monthly plan is the reference for the "savings" of longer plans.
  const monthly = [...plans].sort((a, b) => a.durationDays - b.durationDays)[0];
  const cards: PlanCard[] = plans.map((plan) => {
    const make = (withDashboard: boolean) => {
      const price = planPrice(plan, withDashboard);
      return {
        price: formatMillimes(price, locale),
        perMonth: formatMillimes(
          pricePerMonth(price, plan.durationDays),
          locale,
        ),
        saving: monthly
          ? savingPercent(
              price,
              plan.durationDays,
              planPrice(monthly, withDashboard),
            )
          : 0,
      };
    };
    return {
      id: plan.id,
      name: locale === 'ar' ? plan.nameAr : plan.nameFr,
      days: plan.durationDays,
      visibility: make(false),
      bundle: make(true),
    };
  });

  const visibilityUntil = entitlements?.visibilityUntil ?? null;
  const dashboardUntil = entitlements?.dashboardUntil ?? null;
  const access = dashboardAccess(dashboardUntil, now);

  const visibilityText = !visibilityUntil
    ? t('status.none')
    : visibilityUntil > now
      ? `${t('status.until', { date: date(visibilityUntil) })} (${t('status.daysLeft', { days: daysLeft(visibilityUntil, now) })})`
      : t('status.expired', { date: date(visibilityUntil) });
  const dashboardText = !dashboardUntil
    ? t('status.none')
    : access === 'full'
      ? t('status.until', { date: date(dashboardUntil) })
      : access === 'read_only'
        ? t('status.readOnly', {
            date: date(
              new Date(dashboardUntil.getTime() + GRACE_DAYS * DAY_MS),
            ),
          })
        : t('status.expired', { date: date(dashboardUntil) });

  const foundingOffer =
    profile?.status !== 'approved' && founding.left > 0 && !visibilityUntil;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/espace-professeur"
            className="text-primary underline underline-offset-2"
          >
            {ta('teacherTitle')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
      </header>

      <section className="space-y-2 rounded-card border border-border bg-surface p-5">
        <dl className="space-y-2">
          <div>
            <dt className="text-sm font-medium text-muted">
              {t('status.visibility')}
            </dt>
            <dd className="font-semibold">{visibilityText}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted">
              {t('status.dashboard')}
            </dt>
            <dd className="font-semibold">{dashboardText}</dd>
          </div>
        </dl>
        {entitlements && entitlements.pendingVisibilityDays > 0 && (
          <p className="text-sm text-primary">
            {t('status.creditVisibility', {
              days: entitlements.pendingVisibilityDays,
            })}
          </p>
        )}
        {entitlements && entitlements.pendingDashboardDays > 0 && (
          <p className="text-sm text-primary">
            {t('status.creditDashboard', {
              days: entitlements.pendingDashboardDays,
            })}
          </p>
        )}
        {foundingOffer && (
          <p className="text-sm text-primary">{t('status.founding')}</p>
        )}
      </section>

      {issued && (
        <section className="space-y-2 rounded-card border border-primary bg-secondary p-5">
          <h2 className="font-semibold text-primary">{t('code.yours')}</h2>
          <p className="text-sm">{t('code.yoursHint')}</p>
          <p
            dir="ltr"
            className="text-start font-mono text-2xl font-bold tracking-wider"
          >
            {issued.code}
          </p>
          <p className="text-sm text-muted">
            {t('code.expires', { date: date(issued.expiresAt) })}
          </p>
        </section>
      )}

      <section className="space-y-3 rounded-card border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-primary">
          {t('code.title')}
        </h2>
        <RedeemForm defaultCode={issued?.code} />
      </section>

      {open ? (
        <section className="space-y-3 rounded-card border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold text-primary">
            {t('request.title')}
          </h2>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted">{t('request.reference')}</dt>
              <dd dir="ltr" className="text-start font-semibold">
                {open.reference}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t('request.amount')}</dt>
              <dd dir="ltr" className="text-start font-semibold">
                {formatMillimes(open.amountMillimes, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t('request.plan')}</dt>
              <dd>
                {open.kind === 'upgrade'
                  ? t('request.upgrade')
                  : `${planName(open.planId)}${open.withDashboard ? ` (${t('request.withDashboard')})` : ''}`}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t('request.method')}</dt>
              <dd>{t(`methods.${open.method}`)}</dd>
            </div>
          </dl>
          <p className="font-medium text-primary">
            {t(`requestStatus.${open.status}`)}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/espace-professeur/abonnement/${open.reference}`}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-accent"
            >
              {t('request.viewInstructions')}
            </Link>
            {open.status === 'pending' && (
              <form action={cancelRequestAction}>
                <input type="hidden" name="requestId" value={open.id} />
                <button type="submit" className={secondaryButtonClass}>
                  {t('request.cancel')}
                </button>
              </form>
            )}
          </div>
        </section>
      ) : paymentsAvailable(payments) ? (
        <>
          {upgrade && (
            <section className="space-y-3 rounded-card border border-border bg-surface p-5">
              <h2 className="text-lg font-semibold text-primary">
                {t('upgrade.title')}
              </h2>
              <UpgradeForm
                days={upgrade.days}
                price={formatMillimes(upgrade.amountMillimes, locale)}
              />
            </section>
          )}
          <section className="rounded-card border border-border bg-surface p-5">
            <PlanForm
              plans={cards}
              defaultPlanId={
                (plans.find((p) => p.slug === 'trimestriel') ?? plans[0])?.id ??
                ''
              }
            />
          </section>
        </>
      ) : (
        <p className="rounded-card border border-border bg-surface p-5 text-muted">
          {t('errors.unavailable')}
        </p>
      )}

      {requests.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold text-primary">{t('request.history')}</h2>
          <ul className="divide-y divide-border rounded-card border border-border bg-surface">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <span dir="ltr" className="font-medium">
                  {r.reference}
                </span>
                <span>
                  {r.kind === 'upgrade'
                    ? t('request.upgrade')
                    : planName(r.planId)}{' '}
                  -{' '}
                  <bdi dir="ltr">
                    {formatMillimes(r.amountMillimes, locale)}
                  </bdi>
                </span>
                <span className="text-muted">
                  {t(`requestStatus.${r.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
