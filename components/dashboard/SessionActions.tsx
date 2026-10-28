import { getTranslations } from 'next-intl/server';
import {
  cancelSessionAction,
  restoreSessionAction,
} from '@/app/[locale]/(dashboard)/dashboard-actions';
import { secondaryButtonClass } from '@/components/auth/styles';
import { Link } from '@/i18n/navigation';
import { isPast } from '@/lib/dashboard/dates';
import type { SessionRow } from '@/lib/dashboard/sessions';

/**
 * The buttons of one session: "Supprimer" (or "Restaurer" when it is cancelled) and
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

  const form = (
    action: (formData: FormData) => Promise<void>,
    label: string,
  ) => (
    <form action={action}>
      <input type="hidden" name="sessionId" value={session.id} />
      <input type="hidden" name="retour" value={returnTo} />
      <button type="submit" className={secondaryButtonClass}>
        {label}
      </button>
    </form>
  );

  return (
    <div className="flex flex-wrap gap-2">
      {session.status === 'scheduled' ? (
        <>
          {form(cancelSessionAction, t('cancel'))}
          <Link
            href={{
              pathname: `/calendrier/seances/${session.id}/deplacer`,
              query: { retour: returnTo },
            }}
            className={secondaryButtonClass}
          >
            {t('move')}
          </Link>
        </>
      ) : (
        form(restoreSessionAction, t('restore'))
      )}
    </div>
  );
}
