import type { Pool, PoolClient } from 'pg';
import {
  isPast,
  isValidDate,
  isValidTime,
  timeToMinutes,
  tunisNow,
} from './dates';
import {
  findConflicts,
  generateSessions,
  overlaps,
  slotKey,
  validatePeriod,
  validateRules,
  withoutEnded,
  type Conflict,
  type Rule,
  type SessionDraft,
} from './schedule';
import {
  EXCLUSION_VIOLATION,
  insertRules,
  insertSessions,
  loadScheduledSessions,
  type NewSession,
  type SessionOrigin,
} from './store';

// "Modifier calendrier" (spec 5.3). Two kinds of change, saved together:
//  - the weekly pattern and the end date, rebuilt FROM an effective date (groups that have a
//    weekly pattern only);
//  - day-by-day changes (owner request after M8): sessions added on a chosen day, and existing
//    future sessions edited (date and times) or deleted.
// Past sessions are never touched.

export type CalendarChangeInput = {
  /** The pattern is rebuilt from this date on; sessions before it are never touched. */
  effectiveDate: string;
  endDate: string;
  /** The weekly pattern; empty for a group whose days were picked in a calendar. */
  rules: Rule[];
  /** Sessions added on specific days (origin `manual`: the pattern never touches them). */
  addedSessions?: SessionDraft[];
  /** Future sessions of this group that are deleted for good. */
  deletedSessionIds?: string[];
  /** Future sessions of this group that move to another date and/or times. */
  editedSessions?: { id: string; to: SessionDraft }[];
};

export type CalendarChangeResult =
  | {
      ok: true;
      /**
       * The pattern part of the change: the pattern's sessions removed and created again. The
       * day-by-day changes are not counted here (the screen already shows them).
       */
      removed: number;
      created: number;
      removedSessions: SessionDraft[];
      createdSessions: SessionDraft[];
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'invalid_date'
        | 'invalid_period'
        | 'invalid_rules'
        | 'invalid_sessions'
        | 'session_not_found'
        | 'past'
        | 'conflicts';
      conflicts?: Conflict[];
    };

/** At most this many day-by-day changes in one save. */
export const MAX_DAY_CHANGES = 500;

function validSlot(slot: SessionDraft): boolean {
  return (
    isValidDate(slot.date) &&
    isValidTime(slot.startTime) &&
    isValidTime(slot.endTime) &&
    timeToMinutes(slot.endTime) > timeToMinutes(slot.startTime)
  );
}

type TargetRow = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  origin: SessionOrigin;
  original_date: string | null;
};

/**
 * Rebuilds the FUTURE of a group's calendar from an effective date (spec 5.3), but only when the
 * pattern or its end date changed, and applies the day-by-day changes. Past sessions, sessions
 * added by hand and sessions moved one by one are never touched by the pattern. A session deleted
 * or edited in the same save is not made again by the pattern (its slot is skipped). With
 * `dryRun` nothing is changed: it only says what would happen and which conflicts would block
 * it (the screen shows this before saving).
 */
export async function changeCalendar(
  pool: Pool,
  teacherId: string,
  groupId: string,
  input: CalendarChangeInput,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<CalendarChangeResult> {
  const now = options.now ?? new Date();
  const { date: today, time: nowTime } = tunisNow(now);
  if (input.effectiveDate < today) return { ok: false, reason: 'invalid_date' };

  const added = input.addedSessions ?? [];
  const deletedIds = [...new Set(input.deletedSessionIds ?? [])];
  const edited = input.editedSessions ?? [];
  const editedIds = edited.map((e) => e.id);
  const newSlots = [...added, ...edited.map((e) => e.to)];
  if (
    new Set(editedIds).size !== editedIds.length ||
    editedIds.some((id) => deletedIds.includes(id)) ||
    added.length + edited.length + deletedIds.length > MAX_DAY_CHANGES ||
    newSlots.some((slot) => !validSlot(slot) || isPast(slot, now))
  )
    return { ok: false, reason: 'invalid_sessions' };

  const finish = async <T>(client: PoolClient, result: T): Promise<T> => {
    if (options.dryRun || (result as { ok: boolean }).ok === false)
      await client.query('ROLLBACK');
    return result;
  };

  try {
    return await withTeacherLockNoCommit(pool, teacherId, async (client) => {
      const { rows } = await client.query<{
        name: string;
        start_date: string;
        end_date: string;
      }>(
        `SELECT name, start_date::text AS start_date, end_date::text AS end_date
           FROM groups WHERE id = $1 AND teacher_id = $2 FOR UPDATE`,
        [groupId, teacherId],
      );
      const group = rows[0];
      if (!group)
        return finish(client, { ok: false, reason: 'not_found' } as const);

      // A group with a weekly pattern keeps one; a group whose days were picked in a calendar
      // has none and cannot be given one here.
      const current = await client.query<{
        weekday: number;
        slot_no: number;
        start_time: string;
        end_time: string;
      }>(
        `SELECT weekday, slot_no, to_char(start_time, 'HH24:MI') AS start_time,
                to_char(end_time, 'HH24:MI') AS end_time
           FROM schedule_rules WHERE group_id = $1`,
        [groupId],
      );
      const hasPattern = current.rows.length > 0;
      if (hasPattern ? !validateRules(input.rules).ok : input.rules.length > 0)
        return finish(client, { ok: false, reason: 'invalid_rules' } as const);
      if (hasPattern && validatePeriod(group.start_date, input.endDate))
        return finish(client, { ok: false, reason: 'invalid_period' } as const);
      // The pattern is rebuilt only when the teacher changed it (or its end date). A save that only touches days leaves every other session
      // alone: a day deleted earlier must not come back.
      const signature = (
        list: {
          weekday: number;
          slotNo: number;
          startTime: string;
          endTime: string;
        }[],
      ) =>
        list
          .map(
            (r) =>
              `${r.weekday}|${r.slotNo}|${r.startTime.slice(0, 5)}|${r.endTime.slice(0, 5)}`,
          )
          .sort()
          .join(';');
      const rebuild =
        hasPattern &&
        (input.endDate !== group.end_date ||
          signature(input.rules) !==
            signature(
              current.rows.map((r) => ({
                weekday: r.weekday,
                slotNo: r.slot_no,
                startTime: r.start_time,
                endTime: r.end_time,
              })),
            ));

      // 0. The sessions deleted or edited by hand: they must be this group's future sessions.
      const targetIds = [...deletedIds, ...editedIds];
      let targets: TargetRow[] = [];
      if (targetIds.length > 0) {
        const found = await client.query<TargetRow>(
          `SELECT id, date::text AS date, to_char(start_time, 'HH24:MI') AS start_time,
                  to_char(end_time, 'HH24:MI') AS end_time, origin,
                  original_date::text AS original_date
             FROM sessions
            WHERE id = ANY($1::uuid[]) AND group_id = $2 AND teacher_id = $3
              FOR UPDATE`,
          [targetIds, groupId, teacherId],
        );
        targets = found.rows;
        if (targets.length !== targetIds.length)
          return finish(client, {
            ok: false,
            reason: 'session_not_found',
          } as const);
        if (
          targets.some((t) =>
            isPast({ date: t.date, endTime: t.end_time }, now),
          )
        )
          return finish(client, { ok: false, reason: 'past' } as const);
        await client.query(`DELETE FROM sessions WHERE id = ANY($1::uuid[])`, [
          targetIds,
        ]);
      }
      // What the pattern must not make again: the slot of a pattern session that was deleted or
      // edited now, and the date a deleted moved session came from.
      const skipSlots = new Set(
        targets
          .filter((t) => t.origin === 'rule')
          .map((t) =>
            slotKey({
              date: t.date,
              startTime: t.start_time,
              endTime: t.end_time,
            }),
          ),
      );
      const skipDates = new Set(
        targets
          .filter((t) => t.origin === 'moved' && t.original_date)
          .map((t) => t.original_date as string),
      );

      // 1. What the pattern removes: the future sessions made by the old pattern. Sessions
      //    moved one by one, added and hand-picked sessions always stay. A session of today that is already over is history: it stays.
      let removedRows: SessionDraft[] = [];
      let generated: SessionDraft[] = [];
      if (rebuild) {
        const removed = await client.query<{
          date: string;
          start_time: string;
          end_time: string;
        }>(
          `DELETE FROM sessions
            WHERE group_id = $1 AND teacher_id = $2 AND date >= $3::date AND origin = 'rule'
              AND NOT (date = $4::date AND end_time <= $5::time)
        RETURNING date::text AS date, to_char(start_time, 'HH24:MI') AS start_time,
                  to_char(end_time, 'HH24:MI') AS end_time`,
          [groupId, teacherId, input.effectiveDate, today, nowTime],
        );
        removedRows = removed.rows.map((row) => ({
          date: row.date,
          startTime: row.start_time,
          endTime: row.end_time,
        }));

        // 2. What is kept must not be generated twice: the date a session was moved away from
        //    stays free.
        const kept = await client.query<{ original_date: string }>(
          `SELECT original_date::text AS original_date FROM sessions
            WHERE group_id = $1 AND teacher_id = $2 AND origin = 'moved'
              AND original_date >= $3::date`,
          [groupId, teacherId, input.effectiveDate],
        );
        const movedAway = new Set([
          ...kept.rows.map((row) => row.original_date),
          ...skipDates,
        ]);
        generated = withoutEnded(
          generateSessions(
            input.rules,
            group.start_date,
            input.endDate,
            input.effectiveDate,
          ),
          now,
        ).filter(
          (draft) =>
            !movedAway.has(draft.date) && !skipSlots.has(slotKey(draft)),
        );
      }

      // 3. What is written back for the day-by-day changes. An edited pattern or moved session
      //    becomes a moved one (it remembers where it came from); an added or hand-picked
      //    session keeps its kind.
      const editedRows: NewSession[] = edited.map((change) => {
        const old = targets.find((t) => t.id === change.id) as TargetRow;
        const keepsKind = old.origin === 'extra' || old.origin === 'manual';
        return {
          ...change.to,
          origin: keepsKind ? old.origin : 'moved',
          originalDate: keepsKind ? null : (old.original_date ?? old.date),
        };
      });
      const addedRows: NewSession[] = added.map((slot) => ({
        ...slot,
        origin: 'manual',
      }));
      const incoming: NewSession[] = [
        ...generated.map((d) => ({ ...d, origin: 'rule' as const })),
        ...editedRows,
        ...addedRows,
      ];

      // 4. Conflicts with the teacher's other sessions (the removed ones are already gone) and
      //    between the new sessions themselves.
      const dates = incoming.map((s) => s.date).sort();
      const existing =
        dates.length > 0
          ? await loadScheduledSessions(
              client,
              teacherId,
              dates[0],
              dates[dates.length - 1],
            )
          : [];
      const conflicts = findConflicts(incoming, existing);
      incoming.forEach((draft, index) => {
        for (let before = 0; before < index; before++)
          if (
            incoming[before].date === draft.date &&
            overlaps(incoming[before], draft)
          )
            conflicts.push({
              draft,
              with: {
                id: `new-${before}`,
                groupId,
                groupName: group.name,
                date: incoming[before].date,
                startTime: incoming[before].startTime,
                endTime: incoming[before].endTime,
              },
            });
      });
      if (conflicts.length > 0)
        return finish(client, {
          ok: false,
          reason: 'conflicts',
          conflicts: conflicts.sort(
            (a, b) =>
              a.draft.date.localeCompare(b.draft.date) ||
              timeToMinutes(a.draft.startTime) -
                timeToMinutes(b.draft.startTime),
          ),
        } as const);

      // 5. The period: a group with a pattern keeps its start and takes the new end date; a day
      //    outside the period widens it. A group without a pattern is the first to the last
      //    of its sessions. The 14-month limit holds either way.
      let newStart = group.start_date;
      let newEnd = hasPattern ? input.endDate : group.end_date;
      if (!hasPattern) {
        const left = await client.query<{
          first: string | null;
          last: string | null;
        }>(
          `SELECT min(date)::text AS first, max(date)::text AS last
             FROM sessions WHERE group_id = $1`,
          [groupId],
        );
        const all = [
          ...(left.rows[0].first ? [left.rows[0].first] : []),
          ...(left.rows[0].last ? [left.rows[0].last] : []),
          ...dates,
        ].sort();
        if (all.length > 0) {
          newStart = all[0];
          newEnd = all[all.length - 1];
        }
      } else {
        for (const date of dates) {
          if (date < newStart) newStart = date;
          if (date > newEnd) newEnd = date;
        }
      }
      if (validatePeriod(newStart, newEnd))
        return finish(client, { ok: false, reason: 'invalid_period' } as const);

      // 6. Write.
      if (rebuild) {
        await client.query('DELETE FROM schedule_rules WHERE group_id = $1', [
          groupId,
        ]);
        await insertRules(client, groupId, input.rules);
      }
      await client.query(
        `UPDATE groups SET start_date = $3, end_date = $4
          WHERE id = $1 AND teacher_id = $2`,
        [groupId, teacherId, newStart, newEnd],
      );
      await insertSessions(client, teacherId, groupId, incoming);

      const result = {
        ok: true,
        removed: removedRows.length,
        created: generated.length,
        removedSessions: removedRows,
        createdSessions: generated,
      } as const;
      if (options.dryRun) await client.query('ROLLBACK');
      else await client.query('COMMIT');
      return result;
    });
  } catch (error) {
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION)
      return { ok: false, reason: 'conflicts', conflicts: [] };
    throw error;
  }
}

/** Like withTeacherLock, but the caller decides when to COMMIT or ROLLBACK (for dry runs). */
async function withTeacherLockNoCommit<T>(
  pool: Pool,
  teacherId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `dashboard:${teacherId}`,
    ]);
    return await work(client);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
