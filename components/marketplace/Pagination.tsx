import { getTranslations } from 'next-intl/server';
import { secondaryButtonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import {
  buildSearchQuery,
  type SearchFilters,
} from '@/lib/marketplace/search-params';

/** Previous / next links that keep every filter (plain links: they work without JavaScript). */
export async function Pagination({
  filters,
  page,
  pageCount,
}: {
  filters: SearchFilters;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const t = await getTranslations('search.pagination');
  const href = (target: number) =>
    `/recherche${buildSearchQuery({ ...filters, page: target })}`;

  return (
    <nav
      aria-label={t('label')}
      className="mt-8 flex flex-wrap items-center justify-between gap-3"
    >
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={secondaryButtonClass}>
          {t('previous')}
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-muted">{t('page', { page, pageCount })}</p>
      {page < pageCount ? (
        <Link href={href(page + 1)} rel="next" className={secondaryButtonClass}>
          {t('next')}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
