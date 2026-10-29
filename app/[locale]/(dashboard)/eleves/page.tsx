import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { StudentsList } from '@/components/students/StudentsList';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import { listGroups } from '@/lib/dashboard/groups';
import { loadStudentPool } from '@/lib/dashboard/students';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

export default async function StudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ nouveau?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const { user, access } = await requireDashboard(locale as Locale);
  const query = await searchParams;

  const pool = await loadStudentPool(getPool(), user.id);
  const groups = await listGroups(getPool(), user.id);
  const justAdded =
    query.nouveau && /^[0-9a-f-]{36}$/.test(query.nouveau)
      ? query.nouveau
      : null;

  return (
    <StudentsList
      // A new student starts the list afresh.
      key={justAdded ?? ''}
      students={pool.students}
      serverMode={pool.serverMode}
      total={pool.total}
      groups={groups.map((g) => ({ id: g.id, name: g.name, color: g.color }))}
      canWrite={access === 'full'}
      highlightId={justAdded}
    />
  );
}
