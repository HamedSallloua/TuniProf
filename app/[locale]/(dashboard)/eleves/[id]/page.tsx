import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import {
  StudentDanger,
  StudentGroups,
  StudentInfo,
} from '@/components/students/StudentPanels';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import { listGroups } from '@/lib/dashboard/groups';
import { getStudent, listMemberships } from '@/lib/dashboard/students';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

export default async function StudentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const { user, access } = await requireDashboard(locale as Locale);

  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const student = await getStudent(getPool(), user.id, id);
  if (!student) notFound();

  const t = await getTranslations('students');
  const history = await listMemberships(getPool(), user.id, student.id);
  const groups = await listGroups(getPool(), user.id);
  const canWrite = access === 'full';

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm">
          <Link
            href="/eleves"
            className="text-primary underline underline-offset-2"
          >
            {t('backToList')}
          </Link>
        </p>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold text-primary">
          {student.fullName}
        </h1>
      </header>

      <StudentInfo student={student} canWrite={canWrite} />
      <StudentGroups
        student={student}
        history={history}
        groups={groups.map((g) => ({ id: g.id, name: g.name, color: g.color }))}
        canWrite={canWrite}
      />
      <StudentDanger student={student} canWrite={canWrite} />
    </div>
  );
}
