import { getFormatter, getTranslations } from 'next-intl/server';
import { secondaryButtonClass } from '@/components/auth/styles';
import { getPool } from '@/lib/db/client';
import { listSiteNotices } from '@/lib/notifications/deliver';
import { renderNotification } from '@/lib/notifications/render';
import { markNoticeReadAction } from '@/app/[locale]/(teacher)/notice-actions';

/** The unread notices of the teacher (spec 9: "on-site banner"), newest first. */
export async function TeacherNotices({
  userId,
  locale,
}: {
  userId: string;
  locale: string;
}) {
  const notices = await listSiteNotices(getPool(), userId);
  if (notices.length === 0) return null;

  const t = await getTranslations('teacherNotices');
  const format = await getFormatter();

  return (
    <section aria-labelledby="notices" className="space-y-3">
      <h2 id="notices" className="font-semibold text-primary">
        {t('title')}
      </h2>
      <ul className="space-y-3">
        {notices.map((notice) => {
          const { title, body } = renderNotification(
            notice.kind,
            notice.params,
            locale === 'ar' ? 'ar' : 'fr',
          );
          return (
            <li
              key={notice.id}
              className="rounded-card border border-primary bg-secondary p-4 text-secondary-foreground"
            >
              <p className="font-semibold">{title}</p>
              <p className="mt-1 text-sm">{body}</p>
              <p className="mt-1 text-xs text-muted">
                {format.dateTime(notice.createdAt, { dateStyle: 'long' })}
              </p>
              <form action={markNoticeReadAction} className="mt-2">
                <input type="hidden" name="id" value={notice.id} />
                <button type="submit" className={secondaryButtonClass}>
                  {t('markRead')}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
