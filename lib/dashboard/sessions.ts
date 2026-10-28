import type { Pool } from 'pg';
import type { Queryable } from '@/lib/db/transaction';
import {
  addDays,
  isPast,
  isValidDate,
  isValidTime,
  timeToMinutes,
  tunisNow,
} from './dates';
import { MAX_ADDED_SESSIONS, overlaps, type ExistingSession } from './schedule';
import {
  EXCLUSION_VIOLATION,
  insertSessions,
  loadScheduledSessions,
  SESSION_COLUMNS,
  toSessionRow,
  withTeacherLock,
  type SessionRow,
} from './store';

// One session at a time (spec 5.3): "Supprimer", "Modifier date", "Ajouter une séance". Past sessions are locked. Every function takes the teacher's id.

export type { SessionRow } from './store';

export type SessionFailure =
  | 'not_found'
  | 'past' // a session that is over cannot be changed (history integrity)
  | 'invalid' // bad date or time
  | 'unchanged'
  | 'new_slot_in_past'
  | 'group_not_found'
  | 'conflict';

export type SessionResult =
  | { ok: true }
  | {
      ok: false;
      reason: SessionFailure;
      /** The sessions in the way, for the message "chevauche Groupe A 08:00-10:00". */
      conflicts?: ExistingSession[];
    };

// --------------------------------------------------------------------------------- reading

/** The sessions of the calendar between two dates, with their group's name and colour. */
export async function listSessions(
  db: Queryable,
  teacherId: string,
  from: string,
  to: string,
  options: { groupId?: string } = {},
): Promise<SessionRow[]> {
  const { rows } = await db.query(
    `SELECT ${SESSION_COLUMNS}
       FROM sessions s JOIN groups g ON g.id = s.group_id
      WHERE s.teacher_id = $1
        AND s.date BETWEEN $2::date AND $3::date
        AND ($4::uuid IS NULL OR s.group_id = $4)
      ORDER BY s.date, s.start_time, s.id`,
    [teacherId, from, to, options.groupId ?? null],
  );
  return rows.map(toSessionRow);
}

/** Every session of one group, whatever its date (for the group's calendar preview). */
export async function listGroupSessions(
  db: Queryable,
  teacherId: string,
  groupId: string,
): Promise<SessionRow[]> {
  const { rows } = await db.query(
    `SELECT ${SESSION_COLUMNS}
       FROM sessions s JOIN groups g ON g.id = s.group_id
      WHERE s.teacher_id = $1 AND s.group_id = $2
      ORDER BY s.date, s.start_time, s.id`,
    [teacherId, groupId],
  );
  return rows.map(toSessionRow);
}

export async function getSession(
  db: Queryable,
  teacherId: string,
  sessionId: string,
): Promise<SessionRow | null> {
  const { rows } = await db.query(
    `SELECT ${SESSION_COLUMNS}
       FROM sessions s JOIN groups g ON g.id = s.group_id
      WHERE s.teacher_id = $1 AND s.id = $2`,
    [teacherId, sessionId],
  );
  return rows[0] ? toSessionRow(rows[0]) : null;
}

/** "Prochaines séances" (spec 5.10): the rest of today and tomorrow. */
export async function upcomingSessions(
  db: Queryable,
  teacherId: string,
  now: Date,
): Promise<SessionRow[]> {
  const today = tunisNow(now);
  const rows = await listSessions(
    db,
    teacherId,
    today.date,
    addDays(today.date, 1),
  );
  return rows.filter(
    (row) =>
      !(
        row.date === today.date &&
        timeToMinutes(row.endTime) <= timeToMinutes(today.time)
      ),
  );
}

// ------------------------------------------------------------------------------ one change

async function loadForUpdate(
  client: import('pg').PoolClient,
  teacherId: string,
  sessionId: string,
): Promise<SessionRow | null> {
  const { rows } = await client.query(
    `SELECT ${SESSION_COLUMNS}
       FROM sessions s JOIN groups g ON g.id = s.group_id
      WHERE s.teacher_id = $1 AND s.id = $2 FOR UPDATE OF s`,
    [teacherId, sessionId],
  );
  return rows[0] ? toSessionRow(rows[0]) : null;
}

/**
 * "Supprimer": this one occurrence is deleted for good (there is no "Restaurer"); the other
 * dates are not touched. A session that is over cannot be deleted.
 */
export async function deleteSession(
  pool: Pool,
  teacherId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<SessionResult> {
  return withTeacherLock(pool, teacherId, async (client) => {
    const session = await loadForUpdate(client, teacherId, sessionId);
    if (!session) return { ok: false, reason: 'not_found' } as const;
    if (isPast(session, now)) return { ok: false, reason: 'past' } as const;
    await client.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    return { ok: true } as const;
  });
}

export type SlotInput = { date: string; startTime: string; endTime: string };

function validSlot(slot: SlotInput): boolean {
  return (
    isValidDate(slot.date) &&
    isValidTime(slot.startTime) &&
    isValidTime(slot.endTime) &&
    timeToMinutes(slot.endTime) > timeToMinutes(slot.startTime)
  );
}

async function overlapping(
  db: Queryable,
  teacherId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeId: string | null,
): Promise<ExistingSession[]> {
  const sameDay = await loadScheduledSessions(
    db,
    teacherId,
    date,
    date,
    excludeId ? [excludeId] : [],
  );
  return sameDay.filter(
    (s) =>
      timeToMinutes(s.startTime) < timeToMinutes(endTime) &&
      timeToMinutes(startTime) < timeToMinutes(s.endTime),
  );
}

/**
 * "Modifier date": this one occurrence moves to another date and time (spec 5.3). The old slot
 * is freed, the new one is taken, and an overlap is refused with the list of what is in the way.
 * The session may leave the group's period (make-up lessons) but not go into the past.
 */
export async function moveSession(
  pool: Pool,
  teacherId: string,
  sessionId: string,
  slot: SlotInput,
  now: Date = new Date(),
): Promise<SessionResult> {
  if (!validSlot(slot)) return { ok: false, reason: 'invalid' };
  try {
    return await withTeacherLock(pool, teacherId, async (client) => {
      const session = await loadForUpdate(client, teacherId, sessionId);
      if (!session) return { ok: false, reason: 'not_found' } as const;
      if (isPast(session, now)) return { ok: false, reason: 'past' } as const;
      if (
        session.date === slot.date &&
        session.startTime === slot.startTime &&
        session.endTime === slot.endTime
      )
        return { ok: false, reason: 'unchanged' } as const;
      if (isPast({ date: slot.date, endTime: slot.endTime }, now))
        return { ok: false, reason: 'new_slot_in_past' } as const;

      const conflicts = await overlapping(
        client,
        teacherId,
        slot.date,
        slot.startTime,
        slot.endTime,
        session.id,
      );
      if (conflicts.length > 0)
        return { ok: false, reason: 'conflict', conflicts } as const;

      // The date it first had is kept, even if it is moved again.
      await client.query(
        `UPDATE sessions
            SET date = $2, start_time = $3, end_time = $4, origin = 'moved',
                original_date = COALESCE(original_date, date)
          WHERE id = $1`,
        [sessionId, slot.date, slot.startTime, slot.endTime],
      );
      return { ok: true } as const;
    });
  } catch (error) {
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION)
      return { ok: false, reason: 'conflict', conflicts: [] };
    throw error;
  }
}

export type AddSessionsResult =
  | { ok: true; count: number }
  | {
      ok: false;
      reason: SessionFailure | 'too_many' | 'empty';
      /** The row (0-based) the failure belongs to, when it belongs to one. */
      index?: number;
      /** Overlaps, by row: with a session already in the calendar or with another new row. */
      conflicts?: { index: number; with: ExistingSession }[];
    };

/**
 * "Ajouter une séance" with several rows at once (owner request after M8): one extra session
 * of one group for each row, all or nothing. A row that overlaps a session of the calendar, or
 * another row, stops everything and is reported with the row it belongs to.
 */
export async function addSessions(
  pool: Pool,
  teacherId: string,
  input: { groupId: string; sessions: SlotInput[] },
  now: Date = new Date(),
): Promise<AddSessionsResult> {
  const rows = input.sessions;
  if (rows.length === 0) return { ok: false, reason: 'empty' };
  if (rows.length > MAX_ADDED_SESSIONS)
    return { ok: false, reason: 'too_many' };
  for (let index = 0; index < rows.length; index++) {
    if (!validSlot(rows[index])) return { ok: false, reason: 'invalid', index };
    if (isPast({ date: rows[index].date, endTime: rows[index].endTime }, now))
      return { ok: false, reason: 'new_slot_in_past', index };
  }

  try {
    return await withTeacherLock(pool, teacherId, async (client) => {
      const group = await client.query<{ name: string }>(
        `SELECT name FROM groups WHERE id = $1 AND teacher_id = $2`,
        [input.groupId, teacherId],
      );
      if (group.rows.length === 0)
        return { ok: false, reason: 'group_not_found' } as const;

      const dates = rows.map((row) => row.date).sort();
      const existing = await loadScheduledSessions(
        client,
        teacherId,
        dates[0],
        dates[dates.length - 1],
      );

      const conflicts: { index: number; with: ExistingSession }[] = [];
      rows.forEach((row, index) => {
        for (const session of existing)
          if (session.date === row.date && overlaps(row, session))
            conflicts.push({ index, with: session });
        for (let before = 0; before < index; before++)
          if (rows[before].date === row.date && overlaps(rows[before], row))
            conflicts.push({
              index,
              with: {
                id: `new-${before}`,
                groupId: input.groupId,
                groupName: group.rows[0].name,
                ...rows[before],
              },
            });
      });
      if (conflicts.length > 0)
        return { ok: false, reason: 'conflict', conflicts } as const;

      await insertSessions(client, teacherId, input.groupId, rows, 'extra');
      return { ok: true, count: rows.length } as const;
    });
  } catch (error) {
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION)
      return { ok: false, reason: 'conflict', conflicts: [] };
    throw error;
  }
}

/** "Ajouter une séance": one extra session of a group (spec 5.3). */
export async function addSession(
  pool: Pool,
  teacherId: string,
  input: SlotInput & { groupId: string },
  now: Date = new Date(),
): Promise<SessionResult & { sessionId?: string }> {
  if (!validSlot(input)) return { ok: false, reason: 'invalid' };
  if (isPast({ date: input.date, endTime: input.endTime }, now))
    return { ok: false, reason: 'new_slot_in_past' };

  try {
    return await withTeacherLock(pool, teacherId, async (client) => {
      const group = await client.query(
        `SELECT 1 FROM groups WHERE id = $1 AND teacher_id = $2`,
        [input.groupId, teacherId],
      );
      if (group.rows.length === 0)
        return { ok: false, reason: 'group_not_found' } as const;

      const conflicts = await overlapping(
        client,
        teacherId,
        input.date,
        input.startTime,
        input.endTime,
        null,
      );
      if (conflicts.length > 0)
        return { ok: false, reason: 'conflict', conflicts } as const;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO sessions (teacher_id, group_id, date, start_time, end_time, origin)
         VALUES ($1, $2, $3, $4, $5, 'extra') RETURNING id`,
        [teacherId, input.groupId, input.date, input.startTime, input.endTime],
      );
      return { ok: true, sessionId: rows[0].id } as const;
    });
  } catch (error) {
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION)
      return { ok: false, reason: 'conflict', conflicts: [] };
    throw error;
  }
}
