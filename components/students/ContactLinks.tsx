import { useTranslations } from 'next-intl';
import { PhoneIcon } from '@/components/ui/icons';
import { formatNationalPhone } from '@/lib/phone';

/**
 * A student's phone number with the Call and WhatsApp icons (spec 5.6). The number is always
 * written left to right, also inside Arabic text.
 */
export function ContactLinks({ phone }: { phone: string | null }) {
  const t = useTranslations('students');
  if (phone === null)
    return <span className="text-sm text-muted">{t('noPhone')}</span>;

  const link =
    'inline-flex size-9 items-center justify-center rounded-md border border-border text-primary hover:bg-secondary';
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <bdi dir="ltr" className="text-sm font-medium">
        {formatNationalPhone(phone)}
      </bdi>
      <a href={`tel:${phone}`} className={link} aria-label={t('call')}>
        <PhoneIcon />
      </a>
      <a
        href={`https://wa.me/${phone.replace('+', '')}`}
        target="_blank"
        rel="noopener noreferrer"
        className={link + ' text-xs font-semibold'}
        aria-label={t('whatsapp')}
      >
        WA
      </a>
    </span>
  );
}
