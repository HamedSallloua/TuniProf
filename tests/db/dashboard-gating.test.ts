import type { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// The Dashboard server actions are the real guard of the read-only period and of the end of the
// Dashboard (spec 2.5, 5.11): the screens only hide buttons. Everything the actions need from
// Next.js is replaced here, the database and the access rule are the real ones.
vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUser: vi.fn(),
  requirePermission: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'fr' }));
vi.mock('@/i18n/navigation', () => ({ redirect: vi.fn() }));

import * as dashboard from '@/app/[locale]/(dashboard)/dashboard-actions';
import * as studentActions from '@/app/[locale]/(dashboard)/student-actions';
import { runMigrations } from '@/db/migrate';
import { getCurrentUser } from '@/lib/auth/current-user';
import { readableTeacher, writableTeacher } from '@/lib/dashboard/context';
import { createGroup } from '@/lib/dashboard/groups';
import { listSessions } from '@/lib/dashboard/sessions';
import { createStudent, listGroupMembers } from '@/lib/dashboard/students';
import { clearAuthTables } from './auth-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';
import { createTeacher } from './profile-helpers';

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!testDatabaseUrl)(
  'dashboard server actions: read-only and no access (database)',
  () => {
    let pool: Pool;
    let teacher: string;
    let group: string;
    let session: string;
    let student: string;
    let membership: string;

    const signIn = (id: string | null, role = 'teacher') =>
      vi
        .mocked(getCurrentUser)
        .mockResolvedValue(id ? ({ id, role } as never) : null);

    /** dashboard_until in `days` days from now (negative: in the past); null = never bought. */
    async function setDashboardUntil(days: number | null) {
      await pool.query('DELETE FROM entitlements WHERE teacher_id = $1', [
        teacher,
      ]);
      if (days === null) return;
      await pool.query(
        `INSERT INTO entitlements (teacher_id, dashboard_until, visibility_until)
         VALUES ($1, $2, $2)`,
        [teacher, new Date(Date.now() + days * DAY)],
      );
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = testDatabaseUrl;
      delete (globalThis as { pgPool?: Pool }).pgPool;
      pool = createTestPool();
      await runMigrations(pool);
    });
    afterAll(async () => {
      await (globalThis as { pgPool?: Pool }).pgPool?.end();
      delete (globalThis as { pgPool?: Pool }).pgPool;
      await clearAuthTables(pool);
      await pool.end();
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      await clearAuthTables(pool);
      teacher = await createTeacher(pool);

      // Data to try to change: a group far in the future, with a student in it.
      const start = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10);
      const made = await createGroup(pool, teacher, {
        name: 'Groupe A',
        startDate: start,
        endDate: end,
        rules: [
          { weekday: 1, slotNo: 1, startTime: '08:00', endTime: '10:00' },
        ],
        pricingModel: 'per_session',
        referencePriceMillimes: null,
      });
      if (!made.ok) throw new Error(`group: ${made.reason}`);
      group = made.groupId;
      session = (await listSessions(pool, teacher, start, end))[0].id;
      const created = await createStudent(
        pool,
        teacher,
        { fullName: 'Sarah Ben Ali', phone: '22 345 678' },
        { groupId: group },
      );
      if (!created.ok) throw new Error(`student: ${created.reason}`);
      student = created.studentId;
      membership = (await listGroupMembers(pool, teacher, group))[0]
        .membershipId;
    });

    const snapshot = async () => {
      const one = async (sql: string) =>
        (await pool.query(sql)).rows.map((r) => JSON.stringify(r)).join('|');
      return [
        await one('SELECT id, name, end_date::text FROM groups ORDER BY id'),
        await one(
          'SELECT id, date::text, start_time::text FROM sessions ORDER BY id',
        ),
        await one(
          'SELECT id, full_name, phone, note FROM students ORDER BY id',
        ),
        await one(
          'SELECT id, group_id, left_on::text FROM memberships ORDER BY id',
        ),
      ].join('\n');
    };

    /** Every action that changes something, called with VALID input for rows that exist. */
    const writes = (): [string, () => Promise<unknown>][] => {
      const slot = {
        date: new Date(Date.now() + 40 * DAY).toISOString().slice(0, 10),
        startTime: '14:00',
        endTime: '16:00',
      };
      const form = new FormData();
      form.set('sessionId', session);
      return [
        [
          'loadScheduledAction',
          () => dashboard.loadScheduledAction(slot.date, slot.date),
        ],
        [
          'createGroupAction',
          () =>
            dashboard.createGroupAction({
              name: 'Groupe B',
              startDate: slot.date,
              endDate: slot.date,
              rules: [],
              customSessions: [slot],
              pricingModel: 'per_session',
              referencePriceMillimes: null,
            }),
        ],
        [
          'changeCalendarAction',
          () =>
            dashboard.changeCalendarAction(
              group,
              {
                effectiveDate: new Date().toISOString().slice(0, 10),
                endDate: slot.date,
                rules: [
                  {
                    weekday: 3,
                    slotNo: 1,
                    startTime: '08:00',
                    endTime: '10:00',
                  },
                ],
                resetModified: true,
                addedSessions: [slot],
              },
              false,
            ),
        ],
        ['deleteSessionAction', () => dashboard.deleteSessionAction(form)],
        ['moveSessionAction', () => dashboard.moveSessionAction(session, slot)],
        [
          'addSessionsAction',
          () =>
            dashboard.addSessionsAction({ groupId: group, sessions: [slot] }),
        ],
        [
          'deleteGroupAction',
          () => dashboard.deleteGroupAction(group, 'Groupe A'),
        ],
        [
          'createStudentAction',
          () =>
            studentActions.createStudentAction({
              fullName: 'Karim',
              groupId: group,
            }),
        ],
        [
          'updateStudentAction',
          () =>
            studentActions.updateStudentAction(student, { fullName: 'Hacked' }),
        ],
        [
          'addStudentsToGroupAction',
          () => studentActions.addStudentsToGroupAction(group, [student]),
        ],
        [
          'addStudentToGroupsAction',
          () => studentActions.addStudentToGroupsAction(student, [group]),
        ],
        [
          'removeFromGroupAction',
          () => studentActions.removeFromGroupAction(membership),
        ],
        [
          'moveToGroupAction',
          () => studentActions.moveToGroupAction(membership, group),
        ],
        [
          'saveGroupStudentsAction',
          () =>
            studentActions.saveGroupStudentsAction(group, {
              removeMembershipIds: [membership],
              newStudents: [{ fullName: 'Lina' }],
              editedStudents: [{ studentId: student, fullName: 'Hacked' }],
            }),
        ],
        [
          'deleteStudentAction',
          () => studentActions.deleteStudentAction(student, 'Sarah Ben Ali'),
        ],
      ];
    };

    const blocked: [string, number | null, string][] = [
      ['in the read-only period (5 days after the end)', -5, 'read_only'],
      ['just inside the 30 days of read-only', -29, 'read_only'],
      ['after the 30 days of read-only', -31, 'no_access'],
      ['never bought', null, 'no_access'],
    ];

    describe.each(blocked)('Dashboard %s', (_label, days, reason) => {
      it(`refuses every change with "${reason}" and changes nothing`, async () => {
        signIn(teacher);
        await setDashboardUntil(days);
        const before = await snapshot();
        for (const [name, call] of writes()) {
          const result = await call();
          // deleteSessionAction answers with a redirect, not a value.
          if (name === 'deleteSessionAction') continue;
          expect(result, name).toEqual({ ok: false, reason });
        }
        expect(await snapshot()).toBe(before);
      });

      it('writableTeacher gives the same answer, and readableTeacher only refuses an ended Dashboard', async () => {
        signIn(teacher);
        await setDashboardUntil(days);
        expect(await writableTeacher()).toEqual({ ok: false, reason });
        const read = await readableTeacher();
        expect(read.ok).toBe(reason === 'read_only');
        if (!read.ok) expect(read.reason).toBe('no_access');
      });
    });

    it('searching students still works in the read-only period, and is refused once it ended', async () => {
      signIn(teacher);
      await setDashboardUntil(-5);
      const found = await studentActions.searchStudentsAction('sarah');
      expect(found.ok).toBe(true);
      if (found.ok) expect(found.students.map((s) => s.id)).toEqual([student]);
      await setDashboardUntil(-31);
      expect(await studentActions.searchStudentsAction('sarah')).toEqual({
        ok: false,
        reason: 'no_access',
      });
    });

    it('refuses a visitor and a signed-out request with "not_signed_in", for changes and for search', async () => {
      await setDashboardUntil(30);
      const before = await snapshot();
      for (const who of [
        () => signIn(null),
        () => signIn(teacher, 'visitor'),
      ]) {
        who();
        for (const [name, call] of writes()) {
          if (name === 'deleteSessionAction') continue;
          expect(await call(), name).toEqual({
            ok: false,
            reason: 'not_signed_in',
          });
        }
        expect(await studentActions.searchStudentsAction('sarah')).toEqual({
          ok: false,
          reason: 'not_signed_in',
        });
      }
      expect(await snapshot()).toBe(before);
    });

    it('lets a teacher with an active Dashboard change things (the guard is not just always closed)', async () => {
      signIn(teacher);
      await setDashboardUntil(30);
      expect(await writableTeacher()).toMatchObject({ ok: true });
      expect(
        await studentActions.updateStudentAction(student, {
          fullName: 'Sarah Trabelsi',
        }),
      ).toEqual({ ok: true });
      expect(
        await studentActions.createStudentAction({ fullName: 'Karim' }),
      ).toMatchObject({ ok: true });
      expect(
        await dashboard.addSessionsAction({
          groupId: group,
          sessions: [
            {
              date: new Date(Date.now() + 41 * DAY).toISOString().slice(0, 10),
              startTime: '14:00',
              endTime: '16:00',
            },
          ],
        }),
      ).toMatchObject({ ok: true, count: 1 });
    });

    it('also refuses malformed input, after the access check, without touching anything', async () => {
      signIn(teacher);
      await setDashboardUntil(30);
      const before = await snapshot();
      expect(
        await studentActions.updateStudentAction('not-a-uuid', {}),
      ).toEqual({ ok: false, reason: 'invalid' });
      expect(
        await studentActions.addStudentsToGroupAction(group, ['x']),
      ).toEqual({ ok: false, reason: 'invalid' });
      expect(await studentActions.searchStudentsAction(42)).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(await snapshot()).toBe(before);
    });
  },
);
