import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { EditGroupStudents } from '@/components/students/EditGroupStudents';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { requireDashboard } from '@/lib/dashboard/context';
import { getGroup } from '@/lib/dashboard/groups';
import { listGroupMembers, loadStudentPool } from '@/lib/dashboard/students';
import { getPool } from '@/lib/db/client';

export const metadata: Metadata = { robots: { index: false } };

export default async function EditGroupStudentsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const { user, access } = await requireDashboard(locale as Locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const group = await getGroup(getPool(), user.id, id);
  if (!group) notFound();
  // Nothing can be changed during the read-only period.
  if (access !== 'full')
    redirect({ href: `/groupes/${id}`, locale: locale as Locale });

  const members = await listGroupMembers(getPool(), user.id, group.id);
  const pool = await loadStudentPool(getPool(), user.id);

  return (
    <EditGroupStudents
      group={{ id: group.id, name: group.name, color: group.color }}
      members={members}
      students={pool.students}
      serverMode={pool.serverMode}
    />
  );
}
