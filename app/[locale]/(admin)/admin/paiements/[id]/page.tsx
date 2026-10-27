import type { Metadata } from 'next';
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
} from '@/components/auth/styles';
import { CopyButton } from '@/components/billing/CopyButton';
import { Link, redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { deriveActivationCode } from '@/lib/billing/codes';
import { getPaymentDetail } from '@/lib/billing/payments';
import { BRAND_NAME } from '@/lib/brand';
import { getPool } from '@/lib/db/client';
import { formatMillimes } from '@/lib/money';
import { formatNationalPhone } from '@/lib/phone';
import {
  issueCodeAction,
  markProofAction,
  rejectRequestAction,
  revokeCodeAction,
} from '../../../payment-actions';

export const metadata: Metadata = { robots: { index: false } };

const FLASH = ['proof', 'issued', 'rejected', 'revoked'];
const ERRORS = [
  'forbidden',
  'not_found',
  'invalid_state',
  'invalid_input',
  'transaction_reused',
];

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

export default async function PaymentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ flash?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  await requirePermission('admin:panel', locale as Locale);
  const { flash, error } = await searchParams;

  if (!z.string().uuid().safeParse(id).success) {
    redirect({ href: '/admin/paiements', locale: locale as Locale });
  }
  const detail = await getPaymentDetail(getPool(), id);
  if (!detail) redirect({ href: '/admin/paiements', locale: locale as Locale });
  const r = detail!;

  const t = await getTranslations('adminPayments');
  const ts = await getTranslations('subscription');
  const tp = await getTranslations('profile.status');
  const format = await getFormatter();
  const open = r.status === 'pending' || r.status === 'proof_received';
  const none = t('detail.none');

  // The code can be recomputed from its id while it is waiting (the database keeps only its
  // hash). The admin needs it to send it, and to send it again if the teacher asks.
  const code =
    r.codeId && r.codeStatus === 'issued'
      ? deriveActivationCode(r.codeId)
      : null;
  const messages = code
    ? await Promise.all(
        (['fr', 'ar'] as const).map(async (lng) => {
          const tl = await getTranslations({
            locale: lng,
            namespace: 'adminPayments.codeBox',
          });
          return {
            lng,
            text: tl('message', {
              reference: r.reference,
              brand: BRAND_NAME,
              code,
            }),
          };
        }),
      )
    : [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/admin/paiements"
            className="text-primary underline underline-offset-2"
          >
            {t('detail.back')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">
          <bdi dir="ltr">{r.reference}</bdi>
        </h1>
        <p className="font-medium text-primary">
          {ts(`requestStatus.${r.status}`)}
        </p>
      </header>

      {flash && FLASH.includes(flash) && (
        <p
          role="status"
          className="rounded-md border border-primary bg-secondary p-3 text-sm text-primary"
        >
          {t(`flash.${flash}` as 'flash.proof')}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-accent bg-secondary p-3 text-sm text-accent"
        >
          {t(
            `errors.${ERRORS.includes(error) ? error : 'generic'}` as 'errors.generic',
          )}
        </p>
      )}

      <section className="rounded-card border border-border bg-surface p-5">
        <dl className="space-y-3">
          <Row label={t('detail.teacher')}>{r.teacherName ?? none}</Row>
          <Row label={t('detail.phone')}>
            <bdi dir="ltr">+216 {formatNationalPhone(r.teacherPhone)}</bdi>
          </Row>
          <Row label={t('detail.profile')}>
            {r.profileStatus ? tp(r.profileStatus as 'draft') : none}
          </Row>
          <Row label={t('detail.plan')}>
            {r.planNameFr}
            {r.withDashboard ? ` (${ts('request.withDashboard')})` : ''} -{' '}
            {t(`kind.${r.kind}`)}
          </Row>
          <Row label={t('detail.amount')}>
            <strong dir="ltr">
              {formatMillimes(r.amountMillimes, locale)}
            </strong>
          </Row>
          <Row label={t('detail.method')}>{ts(`methods.${r.method}`)}</Row>
          <Row label={t('detail.created')}>
            {format.dateTime(r.createdAt, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </Row>
          {r.transactionRef && (
            <Row label={t('detail.transaction')}>
              <bdi dir="ltr">{r.transactionRef}</bdi>
            </Row>
          )}
          {r.note && <Row label={t('detail.note')}>{r.note}</Row>}
          <Row label={t('detail.codeStatus')}>
            {r.codeStatus ? t(`codeStatus.${r.codeStatus}`) : none}
          </Row>
        </dl>
      </section>

      {code && (
        <section className="space-y-3 rounded-card border border-primary bg-secondary p-5">
          <h2 className="font-semibold text-primary">{t('codeBox.title')}</h2>
          <p
            dir="ltr"
            className="text-start font-mono text-2xl font-bold tracking-wider"
          >
            {code}
          </p>
          <p className="text-sm">{t('codeBox.hint')}</p>
          {messages.map((m) => (
            <div key={m.lng} className="space-y-2">
              <p
                lang={m.lng}
                dir={m.lng === 'ar' ? 'rtl' : 'ltr'}
                className="rounded-md border border-border bg-surface p-3 text-sm"
              >
                {m.text}
              </p>
              <CopyButton
                text={m.text}
                label={m.lng.toUpperCase()}
                copiedLabel="OK"
              />
            </div>
          ))}
        </section>
      )}

      {open && (
        <>
          <section className="space-y-2 rounded-card border border-border bg-surface p-5">
            <h2 className="font-semibold text-primary">
              {t('checklist.title')}
            </h2>
            <ol className="list-decimal space-y-1 ps-6 text-sm">
              {(['1', '2', '3', '4', '5', '6'] as const).map((n) => (
                <li key={n}>{t(`checklist.${n}`)}</li>
              ))}
            </ol>
          </section>

          {r.status === 'pending' && (
            <form action={markProofAction}>
              <input type="hidden" name="requestId" value={id} />
              <button type="submit" className={secondaryButtonClass}>
                {t('actions.proof')}
              </button>
            </form>
          )}

          <form
            action={issueCodeAction}
            className="space-y-3 rounded-card border border-border bg-surface p-4"
          >
            <input type="hidden" name="requestId" value={id} />
            <label className="block text-sm font-medium">
              {t('form.transactionRef')}
              <input
                name="transactionRef"
                required
                maxLength={100}
                dir="ltr"
                className={inputClass + ' mt-1 text-start'}
              />
            </label>
            <label className="block text-sm font-medium">
              {t('form.transactionDate')}
              <input
                name="transactionDate"
                type="date"
                required
                dir="ltr"
                className={inputClass + ' mt-1 text-start'}
              />
            </label>
            <label className="block text-sm font-medium">
              {t('form.note')}
              <textarea
                name="note"
                rows={2}
                maxLength={500}
                className={inputClass + ' mt-1'}
              />
            </label>
            <button type="submit" className={buttonClass}>
              {t('actions.issue')}
            </button>
          </form>

          <form
            action={rejectRequestAction}
            className="space-y-2 rounded-card border border-border p-4"
          >
            <input type="hidden" name="requestId" value={id} />
            <label className="block text-sm font-medium">
              {t('form.rejectNote')}
              <textarea
                name="note"
                rows={2}
                required
                maxLength={500}
                className={inputClass + ' mt-1'}
              />
            </label>
            <button type="submit" className={secondaryButtonClass}>
              {t('actions.reject')}
            </button>
          </form>
        </>
      )}

      {code && (
        <form
          action={revokeCodeAction}
          className="space-y-2 rounded-card border border-border p-4"
        >
          <input type="hidden" name="requestId" value={id} />
          <label className="block text-sm font-medium">
            {t('form.revokeReason')}
            <textarea
              name="reason"
              rows={2}
              required
              maxLength={500}
              className={inputClass + ' mt-1'}
            />
          </label>
          <button type="submit" className={secondaryButtonClass}>
            {t('actions.revoke')}
          </button>
        </form>
      )}
    </div>
  );
}
