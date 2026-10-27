import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';

// Shown when a page decides the address does not exist (an unknown teacher, a hidden
// profile, an unknown city). It lives inside the language layout, so it is in the visitor's
// language with the normal header and footer. Addresses that match no page at all use
// app/global-not-found.tsx (French and Arabic together).
export default async function NotFound() {
  const t = await getTranslations('notFound');

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold text-primary">{t('title')}</h1>
      <p className="mt-2 text-muted">{t('body')}</p>
      <Link href="/" className={buttonClass + ' mt-5'}>
        {t('backHome')}
      </Link>
    </div>
  );
}
