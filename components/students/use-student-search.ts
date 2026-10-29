'use client';

import { useEffect, useMemo, useState } from 'react';
import { searchStudentsAction } from '@/app/[locale]/(dashboard)/student-actions';
import type { StudentRow } from '@/lib/dashboard/students';
import {
  isSearchable,
  matchStudent,
  PAGE_SIZE,
  searchStudents,
  type MatchKind,
} from '@/lib/students/search';

/** Wait this long after the last key before searching (spec 5.7). */
const DEBOUNCE_MS = 150;

export type StudentResult = { student: StudentRow; match: MatchKind | null };

/**
 * THE student search of every screen (spec 5.6, 5.7): the live filter of "Ajouter élève", the
 * suggestions of the new-student fields, and the Élèves list. A short list is filtered in the
 * browser; when the teacher has more than about 200 students (`serverMode`) the same search
 * runs on the server, and gives the same answer. Results come 20 at a time ("Voir plus").
 */
export function useStudentSearch({
  students,
  serverMode,
  query,
  filter,
}: {
  /** The list the browser filters: everybody, or (server mode) the first students. */
  students: StudentRow[];
  serverMode: boolean;
  query: string;
  /** Keeps only some students, before the results are cut into pages (a group filter). */
  filter?: (student: StudentRow) => boolean;
}) {
  const [debounced, setDebounced] = useState(query);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [remote, setRemote] = useState<{
    query: string;
    rows: StudentRow[];
  } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
      setShown(PAGE_SIZE);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const needsServer = serverMode && isSearchable(debounced);
  useEffect(() => {
    if (!needsServer) return;
    let cancelled = false;
    searchStudentsAction(debounced).then((result) => {
      if (!cancelled)
        setRemote({ query: debounced, rows: result.ok ? result.students : [] });
    });
    return () => {
      cancelled = true;
    };
  }, [needsServer, debounced]);

  const all: StudentResult[] = useMemo(() => {
    const found: StudentResult[] = needsServer
      ? remote?.query === debounced
        ? remote.rows.map((student) => ({
            student,
            match: matchStudent(student, debounced),
          }))
        : []
      : searchStudents(students, debounced);
    return filter ? found.filter((r) => filter(r.student)) : found;
  }, [needsServer, remote, debounced, students, filter]);

  return {
    results: all.slice(0, shown),
    total: all.length,
    hasMore: all.length > shown,
    showMore: () => setShown((n) => n + PAGE_SIZE),
    /** Waiting for the server's answer. */
    loading: needsServer && remote?.query !== debounced,
  };
}
