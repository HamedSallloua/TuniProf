'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getPool } from '@/lib/db/client';
import { safeReturnPath, writableTeacher } from '@/lib/dashboard/context';
import { addMonths, isValidDate, isValidTime } from '@/lib/dashboard/dates';
import {
  changeCalendar,
  createGroup,
  deleteGroup,
  type CalendarChangeResult,
  type CreateGroupResult,
} from '@/lib/dashboard/groups';
import type { ExistingSession } from '@/lib/dashboard/schedule';
import {
  addSession,
  cancelSession,
  moveSession,
  restoreSession,
  type SessionResult,
} from '@/lib/dashboard/sessions';
import { loadScheduledSessions } from '@/lib/dashboard/store';

// Server actions of the Dashboard. Each one: checks that the teacher is signed in AND that the
// Dashboard is fully active (not in its read-only period), validates the input, then calls a
// tested function of lib/dashboard that only touches this teacher's rows.

type Blocked = {
  ok: false;
  reason: 'read_only' | 'no_access' | 'not_signed_in' | 'invalid';
};

const date = z.custom<string>(isValidDate);
const time = z.custom<string>(isValidTime);
const uuid = z.string().uuid();
const rule = z.object({
  weekday: z.number().int().min(1).max(7),
  slotNo: z.number().int().min(1).max(3),
  startTime: time,
  endTime: time,
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function revalidate() {
  revalidatePath('/', 'layout');
}

// ------------------------------------------------------------------------- wizard and groups

/** The teacher's sessions in a period: the wizard compares its preview with them. */
export async function loadScheduledAction(
  startDate: string,
  endDate: string,
): Promise<{ ok: true; sessions: ExistingSession[] } | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  if (
    !isValidDate(startDate) ||
    !isValidDate(endDate) ||
    endDate < startDate ||
    endDate > addMonths(startDate, 14)
  )
    return { ok: false, reason: 'invalid' };
  return {
    ok: true,
    sessions: await loadScheduledSessions(
      getPool(),
      who.user.id,
      startDate,
      endDate,
    ),
  };
}

const groupSchema = z.object({
  name: z.string().max(200),
  startDate: date,
  endDate: date,
  rules: z.array(rule).max(21),
  pricingModel: z.enum(['per_session', 'per_month']),
  referencePriceMillimes: z.number().int().nullable(),
});

export async function createGroupAction(
  input: unknown,
): Promise<CreateGroupResult | Blocked> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const result = await createGroup(getPool(), who.user.id, parsed.data);
  if (result.ok) revalidate();
  return result;
}

/** "Supprimer" with the name typed in the dialog (spec 5.5, invariant 15). */
export async function deleteGroupAction(
  groupId: string,
  typedName: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const who = await writableTeacher();
  if (!who.ok) return who;
  const id = uuid.safeParse(groupId);
  if (!id.success || typeof typedName !== 'string')
    return { ok: false, reason: 'invalid' };
  const result = await deleteGroup(getPool(), who.user.id, id.data, typedName);
  if (result.ok) revalidate();
  return result;
}

// ------------------------------------------------------------------ "Modifier calendrier"

const changeSchema = z.object({
  effectiveDate: date,
  endDate: date,
  rules: z.array(rule).max(21),
  resetModified: z.boolean(),
});

export async function changeCalendarAction(
  groupId: string,
  input: unknown,
  dryRun: boolean,
): Promise<CalendarChangeResult | Blocked> {
  const who = await writableTeacher();
  const id = uuid.safeParse(groupId);
  const parsed = changeSchema.safeParse(input);
  if (!who.ok) return who;
  if (!id.success || !parsed.success) return { ok: false, reason: 'invalid' };
  const result = await changeCalendar(
    getPool(),
    who.user.id,
    id.data,
    parsed.data,
    {
      dryRun,
    },
  );
  if (result.ok && !dryRun) revalidate();
  return result;
}

// ----------------------------------------------------------------------------- one session

async function backWith(
  formData: FormData,
  fallback: string,
  key: 'done' | 'error',
  value: string,
): Promise<never> {
  const locale = (await getLocale()) as Locale;
  const path = safeReturnPath(text(formData, 'retour'), fallback);
  const url = new URL(path, 'http://local');
  url.searchParams.set(key, value);
  revalidate();
  return redirect({ href: `${url.pathname}${url.search}`, locale });
}

export async function cancelSessionAction(formData: FormData): Promise<void> {
  const who = await writableTeacher();
  const id = uuid.safeParse(text(formData, 'sessionId'));
  if (!who.ok || !id.success)
    return backWith(formData, '/calendrier', 'error', 'invalid');
  const result = await cancelSession(getPool(), who.user.id, id.data);
  return backWith(
    formData,
    '/calendrier',
    result.ok ? 'done' : 'error',
    result.ok ? 'cancelled' : result.reason,
  );
}

export async function restoreSessionAction(formData: FormData): Promise<void> {
  const who = await writableTeacher();
  const id = uuid.safeParse(text(formData, 'sessionId'));
  if (!who.ok || !id.success)
    return backWith(formData, '/calendrier', 'error', 'invalid');
  const result = await restoreSession(getPool(), who.user.id, id.data);
  return backWith(
    formData,
    '/calendrier',
    result.ok ? 'done' : 'error',
    result.ok ? 'restored' : result.reason,
  );
}

const slotSchema = z.object({ date, startTime: time, endTime: time });

export async function moveSessionAction(
  sessionId: string,
  slot: unknown,
): Promise<SessionResult | Blocked> {
  const who = await writableTeacher();
  const id = uuid.safeParse(sessionId);
  const parsed = slotSchema.safeParse(slot);
  if (!who.ok) return who;
  if (!id.success || !parsed.success) return { ok: false, reason: 'invalid' };
  const result = await moveSession(
    getPool(),
    who.user.id,
    id.data,
    parsed.data,
  );
  if (result.ok) revalidate();
  return result;
}

export async function addSessionAction(
  input: unknown,
): Promise<(SessionResult & { sessionId?: string }) | Blocked> {
  const who = await writableTeacher();
  const parsed = slotSchema.extend({ groupId: uuid }).safeParse(input);
  if (!who.ok) return who;
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const result = await addSession(getPool(), who.user.id, parsed.data);
  if (result.ok) revalidate();
  return result;
}
