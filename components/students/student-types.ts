import { useEffect, useState } from 'react';
import type { StudentRow } from '@/lib/dashboard/students';

/** A student in a group, with the id of the membership and the day they joined. */
export type GroupMember = StudentRow & {
  membershipId: string;
  joinedOn: string;
};

/** Keeps a row highlighted for about 3 seconds after it was added (spec 5.6). */
export function useHighlight(active: boolean): boolean {
  const [on, setOn] = useState(active);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setOn(false), 3000);
    return () => clearTimeout(timer);
  }, [active]);
  return on;
}
