'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonClass, secondaryButtonClass } from '@/components/auth/styles';
import { PhoneIcon } from '@/components/ui/icons';
import { revealAction } from '@/app/[locale]/(public)/contact-actions';
import type { RevealState } from '@/lib/marketplace/action-state';
import { formatNationalPhone } from '@/lib/phone';
import { TurnstileWidget } from './TurnstileWidget';

function RevealButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass + ' gap-2'}>
      <PhoneIcon />
      {label}
    </button>
  );
}

/**
 * "Voir les coordonnées" (spec 3.4). The number is not in the page: it is fetched when the
 * visitor clicks, logged, rate limited, and protected by Turnstile after several reveals.
 */
export function RevealContact({
  slug,
  brand,
  turnstileSiteKey,
}: {
  slug: string;
  brand: string;
  turnstileSiteKey: string | null;
}) {
  const t = useTranslations('publicProfile.reveal');
  const [state, action] = useActionState<RevealState, FormData>(
    revealAction,
    null,
  );

  if (state && 'phone' in state) {
    const digits = state.phone.replace(/\D/g, '');
    const message = encodeURIComponent(t('whatsappText', { brand }));
    return (
      <div className="space-y-3" aria-live="polite">
        <p className="text-sm text-muted">{t('phone')}</p>
        <p dir="ltr" className="text-start text-2xl font-bold text-primary">
          +216 {formatNationalPhone(state.phone)}
        </p>
        <div className="flex flex-wrap gap-3">
          <a href={`tel:${state.phone}`} className={buttonClass + ' gap-2'}>
            <PhoneIcon />
            {t('call')}
          </a>
          <a
            href={`https://wa.me/${digits}?text=${message}`}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryButtonClass}
          >
            {t('whatsapp')}
          </a>
        </div>
      </div>
    );
  }

  const error = state && 'error' in state ? state : null;
  const showCaptcha = Boolean(error?.needsCaptcha) && turnstileSiteKey;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      {showCaptcha && (
        <TurnstileWidget
          siteKey={turnstileSiteKey}
          attempt={error?.nonce ?? ''}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-accent">
          {t(`errors.${error.error}` as 'errors.generic', {
            minutes: error.minutes ?? 0,
          })}
        </p>
      )}
      <RevealButton label={t('button')} />
      <p className="text-sm text-muted">{t('hint')}</p>
    </form>
  );
}
