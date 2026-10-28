import type { Pool } from 'pg';
import type { Queryable } from '@/lib/db/transaction';
import { pickColor } from './colors';
import {
  findConflicts,
  MAX_CUSTOM_SESSIONS,
  planSessions,
  validateName,
  validatePeriod,
  validatePlan,
  validateRules,
  withoutEnded,
  type Conflict,
  type Rule,
  type SessionDraft,
  type SlotMove,
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
  /** The weekly pattern; empty when the days were picked by hand (`customSessions`). */
  rules: Rule[];
  /**
   * Days added by hand in a calendar, each with its times (origin `manual`). Alone (no weekly
   * pattern) they are the whole group; next to a pattern they are extra specific days.
   */
  customSessions?: SessionDraft[];
  /** Sessions the pattern would make that the teacher deleted in the wizard (by date and times). */
  removedSessions?: SessionDraft[];
  /** Sessions the pattern would make that the teacher edited in the wizard (origin `moved`). */
  movedSessions?: SlotMove[];
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
        | 'invalid_sessions'
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
  const custom = input.customSessions ?? [];
  const removed = input.removedSessions ?? [];
  const moved = input.movedSessions ?? [];
  const hasPattern = input.rules.length > 0;
  if (hasPattern) {
    if (!validateRules(input.rules).ok)
      return { ok: false, reason: 'invalid_rules' };
  } else {
    // No weekly pattern: the group is only its hand-picked days, and there is nothing to
    // remove or edit.
    if (!input.customSessions) return { ok: false, reason: 'invalid_rules' };
    if (removed.length > 0 || moved.length > 0)
      return { ok: false, reason: 'invalid_sessions' };
  }
  if (custom.length > MAX_CUSTOM_SESSIONS)
    return { ok: false, reason: 'invalid_sessions' };
  if (!validPrice(input.referencePriceMillimes))
    return { ok: false, reason: 'invalid_price' };

  const planned = planSessions(input.rules, input.startDate, input.endDate, {
    removed,
    moved,
    extras: custom,
  });
  if (validatePlan(planned, input.startDate, input.endDate, hasPattern))
    return { ok: false, reason: 'invalid_sessions' };
  const drafts = withoutEnded(planned, now);

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

// "Modifier calendrier" lives in its own file (it grew with the day-by-day changes).
export {
  changeCalendar,
  type CalendarChangeInput,
  type CalendarChangeResult,
} from './calendar-change';
