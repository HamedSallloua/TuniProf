import type { Pool } from 'pg';
import type { Queryable } from '@/lib/db/transaction';
import { pickColor } from './colors';
import { tunisNow } from './dates';
import {
  findConflicts,
  generateSessions,
  overlaps,
  validateName,
  validatePeriod,
  validateRules,
  withoutEnded,
  type Conflict,
  type Rule,
} from './schedule';
import {
  EXCLUSION_VIOLATION,
  insertRules,
  insertSessions,
  loadScheduledSessions,
  UNIQUE_VIOLATION,
  withTeacherLock,
} from './store';

// Groups of a teacher (spec 5.2, 5.5). Every function takes the teacher's id and only touches
// that teacher's rows (invariant 16).

export type PricingModel = 'per_session' | 'per_month';

export type Group = {
  id: string;
  name: string;
  color: string;
  startDate: string;
  endDate: string;
  pricingModel: PricingModel;
  referencePriceMillimes: number | null;
  rules: Rule[];
};

const GROUP_SELECT = `
  SELECT id, name, color, start_date::text AS start_date, end_date::text AS end_date,
         pricing_model, reference_price_millimes
    FROM groups`;

type GroupRow = {
  id: string;
  name: string;
  color: string;
  start_date: string;
  end_date: string;
  pricing_model: PricingModel;
  reference_price_millimes: number | null;
};

async function attachRules(db: Queryable, rows: GroupRow[]): Promise<Group[]> {
  if (rows.length === 0) return [];
  const { rows: ruleRows } = await db.query<{
    group_id: string;
    weekday: number;
    slot_no: number;
    start_time: string;
    end_time: string;
  }>(
    `SELECT group_id, weekday, slot_no, to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time, 'HH24:MI') AS end_time
       FROM schedule_rules WHERE group_id = ANY($1) ORDER BY weekday, start_time`,
    [rows.map((r) => r.id)],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    startDate: row.start_date,
    endDate: row.end_date,
    pricingModel: row.pricing_model,
    referencePriceMillimes: row.reference_price_millimes,
    rules: ruleRows
      .filter((r) => r.group_id === row.id)
      .map((r) => ({
        weekday: r.weekday,
        slotNo: r.slot_no,
        startTime: r.start_time,
        endTime: r.end_time,
      })),
  }));
}

export async function listGroups(
  db: Queryable,
  teacherId: string,
): Promise<Group[]> {
  const { rows } = await db.query<GroupRow>(
    `${GROUP_SELECT} WHERE teacher_id = $1 ORDER BY lower(name), id`,
    [teacherId],
  );
  return attachRules(db, rows);
}

export async function getGroup(
  db: Queryable,
  teacherId: string,
  groupId: string,
): Promise<Group | null> {
  const { rows } = await db.query<GroupRow>(
    `${GROUP_SELECT} WHERE teacher_id = $1 AND id = $2`,
    [teacherId, groupId],
  );
  return (await attachRules(db, rows))[0] ?? null;
}

// ------------------------------------------------------------------------------- creating

export type GroupInput = {
  name: string;
  startDate: string;
  endDate: string;
  rules: Rule[];
  pricingModel: PricingModel;
  /** Millimes, or null when the teacher gave no reference price. */
  referencePriceMillimes: number | null;
};

export type CreateGroupResult =
  | { ok: true; groupId: string; sessionCount: number }
  | {
      ok: false;
      reason:
        | 'invalid_name'
        | 'name_taken'
        | 'invalid_period'
        | 'invalid_rules'
        | 'invalid_price'
        | 'conflicts';
      conflicts?: Conflict[];
    };

function validPrice(value: number | null): boolean {
  return (
    value === null ||
    (Number.isInteger(value) && value >= 0 && value <= 10_000_000)
  );
}

/**
 * Creates the group, its weekly rules and all its sessions in one transaction. If any new
 * session overlaps one of the teacher's other sessions nothing is created and the conflicts
 * are returned (acceptance test 1). Sessions of today that are already over are not created.
 * The database refuses an overlap in any case.
 */
export async function createGroup(
  pool: Pool,
  teacherId: string,
  input: GroupInput,
  now: Date = new Date(),
): Promise<CreateGroupResult> {
  const name = input.name.trim();
  if (!validateName(name)) return { ok: false, reason: 'invalid_name' };
  if (validatePeriod(input.startDate, input.endDate))
    return { ok: false, reason: 'invalid_period' };
  if (!validateRules(input.rules).ok)
    return { ok: false, reason: 'invalid_rules' };
  if (!validPrice(input.referencePriceMillimes))
    return { ok: false, reason: 'invalid_price' };

  const drafts = withoutEnded(
    generateSessions(input.rules, input.startDate, input.endDate),
    now,
  );

  try {
    return await withTeacherLock(pool, teacherId, async (client) => {
      const existing = await loadScheduledSessions(
        client,
        teacherId,
        input.startDate,
        input.endDate,
      );
      const conflicts = findConflicts(drafts, existing);
      if (conflicts.length > 0)
        return { ok: false, reason: 'conflicts', conflicts } as const;

      const used = await client.query<{ color: string }>(
        `SELECT color FROM groups WHERE teacher_id = $1`,
        [teacherId],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO groups (teacher_id, name, color, start_date, end_date, pricing_model,
                             reference_price_millimes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          teacherId,
          name,
          pickColor(used.rows.map((r) => r.color)),
          input.startDate,
          input.endDate,
          input.pricingModel,
          input.referencePriceMillimes,
        ],
      );
      await insertRules(client, rows[0].id, input.rules);
      await insertSessions(client, teacherId, rows[0].id, drafts);
      return {
        ok: true,
        groupId: rows[0].id,
        sessionCount: drafts.length,
      } as const;
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === UNIQUE_VIOLATION) return { ok: false, reason: 'name_taken' };
    // Someone else's change slipped in between: the database stopped it.
    if (code === EXCLUSION_VIOLATION)
      return { ok: false, reason: 'conflicts', conflicts: [] };
    throw error;
  }
}

// ---------------------------------------------------------------------------------- delete

export type SimpleResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'name_mismatch' };

/**
 * "Supprimer": permanent, and only when the name is typed exactly (spec 5.5, invariant 15).
 * The group's rules and sessions go with it. (The revenue warning of the dialog comes with the
 * monthly accounts, M10.)
 */
export async function deleteGroup(
  pool: Pool,
  teacherId: string,
  groupId: string,
  typedName: string,
): Promise<SimpleResult> {
  return withTeacherLock(pool, teacherId, async (client) => {
    const { rows } = await client.query<{ name: string }>(
      'SELECT name FROM groups WHERE id = $1 AND teacher_id = $2 FOR UPDATE',
      [groupId, teacherId],
    );
    if (!rows[0]) return { ok: false, reason: 'not_found' } as const;
    if (typedName.trim() !== rows[0].name.trim())
      return { ok: false, reason: 'name_mismatch' } as const;
    await client.query('DELETE FROM groups WHERE id = $1 AND teacher_id = $2', [
      groupId,
      teacherId,
    ]);
    return { ok: true } as const;
  });
}

// ------------------------------------------------------------------ "Modifier calendrier"

export type CalendarChangeInput = {
  /** Changes apply from this date on; sessions before it are never touched. */
  effectiveDate: string;
  endDate: string;
  rules: Rule[];
  /** "Réinitialiser aussi les séances modifiées": moved and cancelled sessions are rebuilt too. */
  resetModified: boolean;
};

export type CalendarChangeResult =
  | { ok: true; removed: number; created: number }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'invalid_date'
        | 'invalid_period'
        | 'invalid_rules'
        | 'conflicts';
      conflicts?: Conflict[];
    };

/**
 * Rebuilds the FUTURE of a group's calendar from an effective date (spec 5.3). Past sessions
 * and extra sessions are never touched; sessions that were moved or cancelled one by one are
 * kept unless `resetModified` is true. With `dryRun` nothing is changed: it only says what
 * would happen and which conflicts would block it (the screen shows this before saving).
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
  if (!validateRules(input.rules).ok)
    return { ok: false, reason: 'invalid_rules' };

  const finish = async <T>(
    client: import('pg').PoolClient,
    result: T,
  ): Promise<T> => {
    if (options.dryRun || (result as { ok: boolean }).ok === false)
      await client.query('ROLLBACK');
    return result;
  };

  try {
    return await withTeacherLockNoCommit(pool, teacherId, async (client) => {
      const { rows } = await client.query<{ start_date: string }>(
        `SELECT start_date::text AS start_date FROM groups
          WHERE id = $1 AND teacher_id = $2 FOR UPDATE`,
        [groupId, teacherId],
      );
      if (!rows[0])
        return finish(client, { ok: false, reason: 'not_found' } as const);
      if (validatePeriod(rows[0].start_date, input.endDate))
        return finish(client, { ok: false, reason: 'invalid_period' } as const);

      // 1. What disappears: the future sessions made by the old pattern, and (on request) the
      //    ones the teacher had moved or cancelled one by one. Extra sessions always stay.
      const removable = input.resetModified
        ? `(origin = 'rule' OR origin = 'moved')`
        : `(origin = 'rule' AND status = 'scheduled')`;
      //    A session of today that is already over is history: it stays.
      const removed = await client.query(
        `DELETE FROM sessions
          WHERE group_id = $1 AND teacher_id = $2 AND date >= $3::date AND ${removable}
            AND NOT (date = $4::date AND end_time <= $5::time)`,
        [groupId, teacherId, input.effectiveDate, today, nowTime],
      );

      // 2. What is kept must not be generated twice: a session cancelled one by one stays
      //    cancelled, and the date a session was moved away from stays free.
      const kept = await client.query<{
        date: string;
        start_time: string;
        end_time: string;
        origin: string;
        original_date: string | null;
      }>(
        `SELECT date::text AS date, to_char(start_time, 'HH24:MI') AS start_time,
                to_char(end_time, 'HH24:MI') AS end_time, origin, original_date::text AS original_date
           FROM sessions
          WHERE group_id = $1 AND teacher_id = $2 AND date >= $3::date
             OR (group_id = $1 AND teacher_id = $2 AND origin = 'moved' AND original_date >= $3::date)`,
        [groupId, teacherId, input.effectiveDate],
      );
      // A cancelled session keeps its date free for any new session that overlaps it, even if
      // the new pattern has other times; a moved session keeps free the date it left.
      const cancelledHere = kept.rows.filter((row) => row.origin === 'rule');
      const movedAway = new Set(
        kept.rows
          .filter((row) => row.origin === 'moved' && row.original_date)
          .map((row) => row.original_date as string),
      );
      const drafts = withoutEnded(
        generateSessions(
          input.rules,
          rows[0].start_date,
          input.endDate,
          input.effectiveDate,
        ),
        now,
      ).filter(
        (draft) =>
          !movedAway.has(draft.date) &&
          !cancelledHere.some(
            (row) =>
              row.date === draft.date &&
              overlaps(draft, {
                startTime: row.start_time,
                endTime: row.end_time,
              }),
          ),
      );

      // 3. Conflicts with the teacher's other sessions (the removed ones are already gone).
      const existing = await loadScheduledSessions(
        client,
        teacherId,
        input.effectiveDate,
        input.endDate,
      );
      const conflicts = findConflicts(drafts, existing);
      if (conflicts.length > 0)
        return finish(client, {
          ok: false,
          reason: 'conflicts',
          conflicts,
        } as const);

      // 4. Write the new pattern and the new sessions.
      await client.query('DELETE FROM schedule_rules WHERE group_id = $1', [
        groupId,
      ]);
      await insertRules(client, groupId, input.rules);
      await client.query(
        'UPDATE groups SET end_date = $3 WHERE id = $1 AND teacher_id = $2',
        [groupId, teacherId, input.endDate],
      );
      await insertSessions(client, teacherId, groupId, drafts);

      const result = {
        ok: true,
        removed: removed.rowCount ?? 0,
        created: drafts.length,
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
  work: (client: import('pg').PoolClient) => Promise<T>,
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
