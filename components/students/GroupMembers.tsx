'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { inputClass, secondaryButtonClass } from '@/components/auth/styles';
import { StudentRowCard, type GroupMember } from './StudentRowCard';
import { useStudentSearch } from './use-student-search';

/**
 * The students of a group with a live search bar (spec 5.6 "One search component everywhere"):
 * the same search as the picker and the Élèves list (name, phone, note, group name), run in the
 * browser because a group is small. 20 students at a time, "Voir plus" for the rest.
 */
export function GroupMembers({
  members,
  groupId,
  allGroups,
  canWrite,
  highlighted,
}: {
  members: GroupMember[];
  groupId: string;
  allGroups: { id: string; name: string; color: string }[];
  canWrite: boolean;
  /** The ids of the students just added: highlighted for about 3 seconds. */
  highlighted: string[];
}) {
  const t = useTranslations('students');
  const [query, setQuery] = useState('');
  const found = useStudentSearch({
    students: members,
    serverMode: false,
    query,
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  const lit = new Set(highlighted);

  return (
    <div className="space-y-3">
      {members.length > 1 && (
        <div className="space-y-1">
          <label
            htmlFor="group-students-search"
            className="block text-sm font-medium"
          >
            {t('searchInGroup')}
          </label>
          <input
            id="group-students-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className={inputClass + ' sm:max-w-sm'}
          />
          {query.trim() !== '' && (
            <p role="status" className="text-sm text-muted">
              {t('resultCount', { count: found.total, all: members.length })}
            </p>
          )}
        </div>
      )}

      {found.results.length === 0 ? (
        <p
          role="status"
          className="rounded-card border border-border bg-surface p-4 text-muted"
        >
          {t('noResults')}
        </p>
      ) : (
        <ul className="space-y-3">
          {found.results.map(({ student }) => {
            const member = byId.get(student.id) as GroupMember;
            return (
              <StudentRowCard
                key={member.membershipId}
                member={member}
                groupId={groupId}
                allGroups={allGroups}
                canWrite={canWrite}
                highlight={lit.has(member.id)}
              />
            );
          })}
        </ul>
      )}
      {found.hasMore && (
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={found.showMore}
        >
          {t('showMore')}
        </button>
      )}
    </div>
  );
}
