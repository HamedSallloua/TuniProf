import { getTranslations } from 'next-intl/server';
import { deleteSessionAction } from '@/app/[locale]/(dashboard)/dashboard-actions';
import { secondaryButtonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import { isPast } from '@/lib/dashboard/dates';
import type { SessionRow } from '@/lib/dashboard/sessions';
import { DeleteSessionForm } from './DeleteSessionForm';

/**
 * The buttons of one session: "Supprimer" (for good, after a confirmation) and
 * "Modifier date" (spec 5.3). A session that is over is locked: no buttons, and in the
 * read-only period nobody can change anything.
 */
export async function SessionActions({
  session,
  returnTo,
  canWrite,
  now,
}: {
  session: SessionRow;
  /** The page to come back to after the action, e.g. /calendrier?vue=mois&jour=2026-09-14 */
  returnTo: string;
  canWrite: boolean;
  now: Date;
}) {
  const t = await getTranslations('calendar.row');
  if (!canWrite) return null;
  if (isPast(session, now))
    return <span className="text-xs text-muted">{t('locked')}</span>;

  return (
    <div className="flex flex-wrap gap-2">
      <DeleteSessionForm
        action={deleteSessionAction}
        sessionId={session.id}
        returnTo={returnTo}
        label={t('delete')}
        confirmText={t('deleteConfirm')}
      />
      <Link
        href={{
          pathname: `/calendrier/seances/${session.id}/deplacer`,
          query: { retour: returnTo },
        }}
        className={secondaryButtonClass}
      >
        {t('move')}
      </Link>
    </div>
  );
}
