import type { PoolClient, Pool } from 'pg';
import { withTransaction, type Queryable } from '@/lib/db/transaction';
import type { ExistingSession, Rule, SessionDraft } from './schedule';

// Shared database helpers of the Dashboard. EVERY function takes the teacher's id and filters
// by it (invariant 16): there is no way to ask for a group or a session by its id alone.

export const EXCLUSION_VIOLATION = '23P01'; // no_teacher_overlap
export const UNIQUE_VIOLATION = '23505';

/**
 * Runs `work` in a transaction that holds one lock per teacher. Two changes of the same
 * teacher's calendar (two devices, a double click) therefore run one after the other, so the
 * conflict lists are computed on the real state. The database constraint stays the last guard.
 */
export async function withTeacherLock<T>(
  pool: Pool,
  teacherId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `dashboard:${teacherId}`,
    ]);
    return work(client);
  });
}

export const SESSION_COLUMNS = `
  s.id, s.group_id, s.date::text AS date,
  to_char(s.start_time, 'HH24:MI') AS start_time,
  to_char(s.end_time, 'HH24:MI') AS end_time,
  s.origin, s.original_date::text AS original_date,
  g.name AS group_name, g.color AS group_color`;

/**
 * Where a session comes from: the weekly pattern, "Modifier date", "Ajouter une séance", or a
 * day picked by hand in the calendar when the group was created.
 */
export type SessionOrigin = 'rule' | 'moved' | 'extra' | 'manual';

type SessionRowDb = {
  id: string;
  group_id: string;
  date: string;
  start_time: string;
  end_time: string;
  origin: SessionOrigin;
  original_date: string | null;
  group_name: string;
  group_color: string;
};

export type SessionRow = {
  id: string;
  groupId: string;
  groupName: string;
  groupColor: string;
  date: string;
  startTime: string;
  endTime: string;
  origin: SessionOrigin;
  originalDate: string | null;
};

export function toSessionRow(row: SessionRowDb): SessionRow {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    groupColor: row.group_color,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    origin: row.origin,
    originalDate: row.original_date,
  };
}

export function toExisting(row: SessionRow): ExistingSession {
  return {
    id: row.id,
    groupId: row.groupId,
    groupName: row.groupName,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
  };
}

/** The teacher's sessions between two dates, of every group. */
export async function loadScheduledSessions(
  db: Queryable,
  teacherId: string,
  from: string,
  to: string,
  excludeIds: string[] = [],
): Promise<ExistingSession[]> {
  const { rows } = await db.query<SessionRowDb>(
    `SELECT ${SESSION_COLUMNS}
       FROM sessions s JOIN groups g ON g.id = s.group_id
      WHERE s.teacher_id = $1
        AND s.date BETWEEN $2::date AND $3::date
        AND NOT (s.id = ANY($4::uuid[]))
      ORDER BY s.date, s.start_time`,
    [teacherId, from, to, excludeIds],
  );
  return rows.map((row) => toExisting(toSessionRow(row)));
}

/** Inserts many sessions of one group in one statement. */
export async function insertSessions(
  client: PoolClient,
  teacherId: string,
  groupId: string,
  drafts: SessionDraft[],
  origin: 'rule' | 'extra' | 'manual' = 'rule',
): Promise<void> {
  if (drafts.length === 0) return;
  await client.query(
    `INSERT INTO sessions (teacher_id, group_id, date, start_time, end_time, origin)
     SELECT $1, $2, t.d, t.s::time, t.e::time, $6
       FROM unnest($3::date[], $4::text[], $5::text[]) AS t(d, s, e)`,
    [
      teacherId,
      groupId,
      drafts.map((d) => d.date),
      drafts.map((d) => d.startTime),
      drafts.map((d) => d.endTime),
      origin,
    ],
  );
}

export async function insertRules(
  client: PoolClient,
  groupId: string,
  rules: Rule[],
): Promise<void> {
  if (rules.length === 0) return;
  await client.query(
    `INSERT INTO schedule_rules (group_id, weekday, slot_no, start_time, end_time)
     SELECT $1, t.w, t.n, t.s::time, t.e::time
       FROM unnest($2::int[], $3::int[], $4::text[], $5::text[]) AS t(w, n, s, e)`,
    [
      groupId,
      rules.map((r) => r.weekday),
      rules.map((r) => r.slotNo),
      rules.map((r) => r.startTime),
      rules.map((r) => r.endTime),
    ],
  );
}
