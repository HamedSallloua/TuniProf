import type { Metadata } from 'next';
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import { numTag } from '@/components/auth/num-tag';
import { buttonClass } from '@/components/auth/styles';
import { CopyButton } from '@/components/billing/CopyButton';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requirePermission } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db/client';
import { listPendingWhatsApp } from '@/lib/notifications/deliver';
import { renderNotification } from '@/lib/notifications/render';
import { formatNationalPhone } from '@/lib/phone';
import { markWhatsAppSentAction } from '../../notification-actions';

export const metadata: Metadata = { robots: { index: false } };

const whatsAppLink = (phone: string, text: string) =>
  `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

// Messages to send by hand from the WhatsApp Business app (spec 8.5, 9): copy, send, tick.
export default async function WhatsAppQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  await requirePermission('admin:panel', locale as Locale);
  const { done, error } = await searchParams;

  const t = await getTranslations('adminNotifications');
  const format = await getFormatter();
  const items = await listPendingWhatsApp(getPool());

  const flashKey = done ?? error;
  const flash = flashKey ? t(`flash.${flashKey}` as 'flash.sent') : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-1">
        <p className="text-sm">
          <Link
            href="/admin"
            className="text-primary underline underline-offset-2"
          >
            {t('back')}
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-primary">
          {t('title')} ({items.length})
        </h1>
        <p className="text-muted">{t('intro')}</p>
      </header>

      {flash && (
        <p
          role={error ? 'alert' : 'status'}
          className={
            'rounded-md border p-3 text-sm ' +
            (error
              ? 'border-accent bg-secondary text-accent'
              : 'border-primary bg-secondary text-primary')
          }
        >
          {flash}
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-muted">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-6">
          {items.map((item) => {
            const title = renderNotification(
              item.kind,
              item.params,
              locale === 'ar' ? 'ar' : 'fr',
            ).title;
            const paymentId =
              item.kind === 'code_issued' &&
              typeof item.params.paymentId === 'string'
                ? item.params.paymentId
                : null;
            return (
              <li
                key={item.id}
                className="space-y-4 rounded-card border border-border bg-surface p-4"
              >
                <div>
                  <h2 className="font-semibold text-primary">{title}</h2>
                  <p className="text-sm text-muted">
                    {t('to')} :{' '}
                    {item.params.name ? `${item.params.name} · ` : ''}
                    {numTag(`+216 ${formatNationalPhone(item.phone)}`)}
                    {' · '}
                    {t('createdOn', {
                      date: format.dateTime(item.createdAt, {
                        dateStyle: 'long',
                      }),
                    })}
                  </p>
                </div>

                {paymentId && (
                  <p className="rounded-md border border-accent bg-secondary p-3 text-sm">
                    {t('codeNote')}{' '}
                    <Link
                      href={`/admin/paiements/${paymentId}`}
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      {t('codeLink')}
                    </Link>
                  </p>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">{t('french')}</h3>
                    <p
                      lang="fr"
                      dir="ltr"
                      className="rounded-md border border-border p-3 text-sm whitespace-pre-line"
                    >
                      {item.textFr}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <CopyButton
                        text={item.textFr}
                        label={t('copyFr')}
                        copiedLabel={t('copied')}
                      />
                      <a
                        href={whatsAppLink(item.phone, item.textFr)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
                      >
                        {t('openFr')}
                      </a>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">{t('arabic')}</h3>
                    <p
                      lang="ar"
                      dir="rtl"
                      className="rounded-md border border-border p-3 text-sm whitespace-pre-line"
                    >
                      {item.textAr}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <CopyButton
                        text={item.textAr}
                        label={t('copyAr')}
                        copiedLabel={t('copied')}
                      />
                      <a
                        href={whatsAppLink(item.phone, item.textAr)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
                      >
                        {t('openAr')}
                      </a>
                    </div>
                  </div>
                </div>

                <form action={markWhatsAppSentAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <button type="submit" className={buttonClass}>
                    {t('markSent')}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
