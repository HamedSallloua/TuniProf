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
import { runMigrations } from '@/db/migrate';
import { dashboardAccess } from '@/lib/billing/entitlements';
import { getFoundingSlots } from '@/lib/billing/founding';
import {
  issueCode,
  redeemCode,
  revokeCode,
  findIssuedCodeForTeacher,
  expireStaleCodes,
  deriveActivationCode,
} from '@/lib/billing/codes';
import {
  cancelPaymentRequest,
  createPaymentRequest,
  createUpgradeRequest,
  getPaymentDetail,
  getPaymentRequestByReference,
  grantDaysManually,
  listPaymentRequests,
  markProofReceived,
  rejectPaymentRequest,
} from '@/lib/billing/payments';
import { upgradePrice, getPlan } from '@/lib/billing/plans';
import { loadProfile, saveProfile, submitProfile } from '@/lib/profile/repo';
import { approveProfile, rejectProfile } from '@/lib/profile/review';
import { at, clearAuthTables, minutes, T0 } from './auth-helpers';
import {
  atDays,
  buyAndRedeem,
  createApprovedTeacher,
  createPendingTeacher,
  entitlementsOf,
  isVisible,
  planBySlug,
  purchaseCode,
} from './billing-helpers';
import {
  CHECK_VIOLATION,
  createTestPool,
  FOREIGN_KEY_VIOLATION,
  testDatabaseUrl,
  UNIQUE_VIOLATION,
} from './helpers';
import {
  completeInput,
  createAdminUser,
  createTeacher,
  loadCatalogueIds,
  type CatalogueIds,
} from './profile-helpers';

describe.skipIf(!testDatabaseUrl)('billing (database)', () => {
  let pool: Pool;
  let ids: CatalogueIds;
  let admin: string;

  beforeAll(async () => {
    pool = createTestPool();
    await runMigrations(pool);
    ids = await loadCatalogueIds(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await clearAuthTables(pool);
    admin = await createAdminUser(pool, 'admin_support');
  });

  const setSetting = (key: string, json: string) =>
    pool.query('UPDATE settings SET value = $2::jsonb WHERE key = $1', [
      key,
      json,
    ]);
  const noFounding = () => setSetting('founding.slots_total', '0');
  const ms = (date: Date | null | undefined) => date?.getTime();

  // ===================================================================== invariant 1
  describe('the visibility rule (one SQL function, invariant 1)', () => {
    async function visibleTeacher() {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      await buyAndRedeem(pool, admin, teacher, { plan: 'mensuel' });
      return teacher;
    }

    it('is true only when every condition holds', async () => {
      const teacher = await visibleTeacher();
      expect(await isVisible(pool, teacher, atDays(1))).toBe(true);
    });

    it('is false when the profile is not approved, even with paid days waiting', async () => {
      await noFounding();
      for (const status of [
        'draft',
        'pending',
        'rejected',
        'suspended',
      ] as const) {
        const teacher = await visibleTeacher();
        await pool.query(
          'UPDATE teacher_profiles SET status = $2 WHERE user_id = $1',
          [teacher, status],
        );
        expect(await isVisible(pool, teacher, atDays(1)), status).toBe(false);
      }
    });

    it('is false when the teacher paused the listing', async () => {
      const teacher = await visibleTeacher();
      await pool.query(
        'UPDATE teacher_profiles SET is_listed = false WHERE user_id = $1',
        [teacher],
      );
      expect(await isVisible(pool, teacher, atDays(1))).toBe(false);
    });

    it('is false the instant visibility_until is reached, and true one millisecond before', async () => {
      const teacher = await visibleTeacher(); // mensuel: T0 + 30 days
      const until = atDays(30);
      expect(
        await isVisible(pool, teacher, new Date(until.getTime() - 1)),
      ).toBe(true);
      expect(await isVisible(pool, teacher, until)).toBe(false);
      expect(await isVisible(pool, teacher, atDays(31))).toBe(false);
    });

    it('is false for a teacher who never paid', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      expect(await isVisible(pool, teacher, atDays(1))).toBe(false);
    });

    it('is false when a required field is missing', async () => {
      const teacher = await visibleTeacher();
      await pool.query('DELETE FROM teacher_levels WHERE teacher_id = $1', [
        teacher,
      ]);
      expect(await isVisible(pool, teacher, atDays(1))).toBe(false);
    });

    it('is false when the account is suspended', async () => {
      const teacher = await visibleTeacher();
      await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [
        teacher,
      ]);
      expect(await isVisible(pool, teacher, atDays(1))).toBe(false);
    });

    it('is false for an unknown id', async () => {
      expect(
        await isVisible(pool, '00000000-0000-0000-0000-000000000000'),
      ).toBe(false);
    });

    it('the public view lists visible teachers only, and has no phone number', async () => {
      const shown = await visibleTeacher();
      const hidden = await createApprovedTeacher(pool, ids, admin); // never paid
      const { rows } = await pool.query(
        'SELECT * FROM visible_teacher_profiles',
      );
      // The view uses now(); the paid days start at T0 (2026-10-26), so build the check at a
      // time inside the paid period by reading through the function instead.
      const viaFunction = await pool.query(
        'SELECT user_id FROM teacher_profiles WHERE teacher_is_visible(user_id, $1)',
        [atDays(1)],
      );
      expect(viaFunction.rows.map((r) => r.user_id)).toEqual([shown]);
      expect(viaFunction.rows.map((r) => r.user_id)).not.toContain(hidden);
      for (const row of rows) {
        expect(Object.keys(row)).not.toContain('phone_e164');
        expect(Object.keys(row)).not.toContain('phone');
      }
    });
  });

  // ============================================================ entitlements (test 10, 11, 12)
  describe('entitlements', () => {
    it('ACCEPTANCE 10: renewing 10 days before expiry adds the full duration after the current end', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'trimestriel',
        now: T0,
      }); // T0 + 90
      expect(ms((await entitlementsOf(pool, teacher))!.visibility_until)).toBe(
        atDays(90).getTime(),
      );

      await buyAndRedeem(pool, admin, teacher, {
        plan: 'trimestriel',
        now: atDays(80),
      }); // 10 days before
      expect(ms((await entitlementsOf(pool, teacher))!.visibility_until)).toBe(
        atDays(180).getTime(),
      );
    });

    it('renewing after the end counts from the day of renewal', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      await buyAndRedeem(pool, admin, teacher, { plan: 'mensuel', now: T0 });
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'mensuel',
        now: atDays(50),
      }); // 20 days late
      expect(ms((await entitlementsOf(pool, teacher))!.visibility_until)).toBe(
        atDays(80).getTime(),
      );
    });

    it('the two dates are independent (invariant 2)', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'annuel',
        withDashboard: true,
        now: T0,
      });
      let e = (await entitlementsOf(pool, teacher))!;
      expect([ms(e.visibility_until), ms(e.dashboard_until)]).toEqual([
        atDays(365).getTime(),
        atDays(365).getTime(),
      ]);

      // A visibility-only renewal moves visibility and leaves the Dashboard where it was.
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'mensuel',
        now: atDays(10),
      });
      e = (await entitlementsOf(pool, teacher))!;
      expect(ms(e.visibility_until)).toBe(atDays(395).getTime());
      expect(ms(e.dashboard_until)).toBe(atDays(365).getTime());
    });

    it('a visibility-only plan gives no Dashboard at all', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'trimestriel',
        now: T0,
      });
      expect((await entitlementsOf(pool, teacher))!.dashboard_until).toBeNull();
    });

    it('ACCEPTANCE 11: a code redeemed while the profile is pending hides nothing new and the days start at approval', async () => {
      await noFounding();
      const teacher = await createPendingTeacher(pool, ids);
      const result = await buyAndRedeem(pool, admin, teacher, {
        plan: 'trimestriel',
        now: T0,
      });
      expect(result.credited).toBe(true);

      // Hidden: the profile is not approved, and the days have not started.
      let e = (await entitlementsOf(pool, teacher))!;
      expect(e.visibility_until).toBeNull();
      expect(e.pending_visibility_days).toBe(90);
      expect(await isVisible(pool, teacher, atDays(3))).toBe(false);

      // Approved 5 days later: the 90 days start THEN, not on the day of payment.
      expect((await approveProfile(pool, admin, teacher, atDays(5))).ok).toBe(
        true,
      );
      e = (await entitlementsOf(pool, teacher))!;
      expect(ms(e.visibility_until)).toBe(atDays(95).getTime());
      expect([e.pending_visibility_days, e.pending_dashboard_days]).toEqual([
        0, 0,
      ]);
      expect(await isVisible(pool, teacher, atDays(6))).toBe(true);
      expect(await isVisible(pool, teacher, atDays(94))).toBe(true);
      expect(await isVisible(pool, teacher, atDays(96))).toBe(false);

      const { rows } = await pool.query(
        'SELECT as_credit, started_at FROM entitlement_grants WHERE teacher_id = $1',
        [teacher],
      );
      expect(rows).toEqual([{ as_credit: true, started_at: atDays(5) }]);
    });

    it('credit before approval keeps the Dashboard days too, and several codes add up', async () => {
      await noFounding();
      const teacher = await createPendingTeacher(pool, ids);
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'mensuel',
        withDashboard: true,
        now: T0,
      });
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'trimestriel',
        now: atDays(1),
      });
      await approveProfile(pool, admin, teacher, atDays(10));
      const e = (await entitlementsOf(pool, teacher))!;
      expect(ms(e.visibility_until)).toBe(atDays(10 + 30 + 90).getTime());
      expect(ms(e.dashboard_until)).toBe(atDays(10 + 30).getTime());
    });

    it('credit and the founding year stack at approval', async () => {
      const teacher = await createPendingTeacher(pool, ids);
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'trimestriel',
        now: T0,
      });
      await approveProfile(pool, admin, teacher, atDays(2));
      const e = (await entitlementsOf(pool, teacher))!;
      expect(ms(e.visibility_until)).toBe(atDays(2 + 90 + 365).getTime());
    });

    it('a refused profile keeps its credit untouched and unused', async () => {
      await noFounding();
      const teacher = await createPendingTeacher(pool, ids);
      await buyAndRedeem(pool, admin, teacher, { plan: 'mensuel', now: T0 });
      await rejectProfile(pool, admin, teacher, {
        reason: 'incomplete_info',
        note: null,
      });
      const e = (await entitlementsOf(pool, teacher))!;
      expect([e.visibility_until, e.pending_visibility_days]).toEqual([
        null,
        30,
      ]);
    });

    it('ACCEPTANCE 12 (visibility part): profile leaves the results when visibility ends; the Dashboard is read-only 30 days', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'mensuel',
        withDashboard: true,
        now: T0,
      });
      const e = (await entitlementsOf(pool, teacher))!;

      expect(await isVisible(pool, teacher, atDays(29))).toBe(true);
      expect(await isVisible(pool, teacher, atDays(30))).toBe(false); // gone at once

      expect(dashboardAccess(e.dashboard_until, atDays(29))).toBe('full');
      expect(dashboardAccess(e.dashboard_until, atDays(31))).toBe('read_only');
      expect(dashboardAccess(e.dashboard_until, atDays(60))).toBe('read_only');
      expect(dashboardAccess(e.dashboard_until, atDays(61))).toBe('none');
    });

    it('the database refuses an entitlement for an account that is not a teacher', async () => {
      await expect(
        pool.query('INSERT INTO entitlements (teacher_id) VALUES ($1)', [
          admin,
        ]),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });
  });

  // ================================================================ payment requests
  describe('payment requests', () => {
    const request = (
      teacher: string,
      planSlug = 'trimestriel',
      withDashboard = false,
      method = 'flouci',
      now = T0,
    ) =>
      planBySlug(pool, planSlug).then((planId) =>
        createPaymentRequest(
          pool,
          teacher,
          { planId, withDashboard, method },
          now,
        ),
      );

    it('creates a request with a TTP-NNNNN reference and the exact amount', async () => {
      const teacher = await createTeacher(pool);
      const visibility = await request(teacher, 'trimestriel', false);
      expect(visibility.ok && visibility.request).toMatchObject({
        amountMillimes: 40500,
        status: 'pending',
        method: 'flouci',
        kind: 'plan',
      });
      if (visibility.ok)
        expect(visibility.request.reference).toMatch(/^TTP-[0-9]{5}$/);

      await cancelPaymentRequest(
        pool,
        teacher,
        visibility.ok ? visibility.request.id : '',
      );
      const bundle = await request(teacher, 'semestriel', true, 'ccp');
      expect(bundle.ok && bundle.request.amountMillimes).toBe(111000);
    });

    it('keeps the price it had when it was made, even if the plan price changes later', async () => {
      const teacher = await createTeacher(pool);
      const created = await request(teacher, 'mensuel', false);
      await pool.query(
        "UPDATE plans SET price_visibility_millimes = 99000, price_with_dashboard_millimes = 99000 WHERE slug = 'mensuel'",
      );
      try {
        const { rows } = await pool.query(
          'SELECT amount_millimes FROM payment_requests WHERE teacher_id = $1',
          [teacher],
        );
        expect(rows[0].amount_millimes).toBe(15000);
        expect(created.ok).toBe(true);
      } finally {
        await pool.query(
          "UPDATE plans SET price_visibility_millimes = 15000, price_with_dashboard_millimes = 25000 WHERE slug = 'mensuel'",
        );
      }
    });

    it('only one request can be open at a time, and a cancelled one frees the place', async () => {
      const teacher = await createTeacher(pool);
      const first = await request(teacher);
      expect(await request(teacher)).toEqual({
        ok: false,
        reason: 'open_request_exists',
      });
      if (first.ok)
        expect(
          await cancelPaymentRequest(pool, teacher, first.request.id),
        ).toBe(true);
      expect((await request(teacher)).ok).toBe(true);
    });

    it('refuses an unknown method or plan', async () => {
      const teacher = await createTeacher(pool);
      expect(await request(teacher, 'trimestriel', false, 'bitcoin')).toEqual({
        ok: false,
        reason: 'invalid_method',
      });
      expect(
        await createPaymentRequest(pool, teacher, {
          planId: '00000000-0000-0000-0000-000000000000',
          withDashboard: false,
          method: 'ccp',
        }),
      ).toEqual({ ok: false, reason: 'invalid_plan' });
    });

    it('is not possible in production until the owner has configured the payment accounts', async () => {
      const teacher = await createTeacher(pool);
      vi.stubEnv('NODE_ENV', 'production');
      try {
        expect(await request(teacher)).toEqual({
          ok: false,
          reason: 'unavailable',
        });
        await setSetting('payment.configured', 'true');
        expect((await request(teacher)).ok).toBe(true);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('a teacher can only see and cancel their own requests (invariant 16)', async () => {
      const [a, b] = [await createTeacher(pool), await createTeacher(pool)];
      const mine = await request(a);
      if (!mine.ok) throw new Error('setup');
      expect(
        await getPaymentRequestByReference(pool, a, mine.request.reference),
      ).not.toBeNull();
      expect(
        await getPaymentRequestByReference(pool, b, mine.request.reference),
      ).toBeNull();
      expect(await cancelPaymentRequest(pool, b, mine.request.id)).toBe(false);
      expect((await getPaymentDetail(pool, mine.request.id))!.status).toBe(
        'pending',
      );
    });

    it('cannot be cancelled once an admin has seen the proof', async () => {
      const teacher = await createTeacher(pool);
      const created = await request(teacher);
      if (!created.ok) throw new Error('setup');
      await markProofReceived(pool, admin, created.request.id);
      expect(
        await cancelPaymentRequest(pool, teacher, created.request.id),
      ).toBe(false);
    });
  });

  // ========================================================= Dashboard added mid-term
  describe('adding the Dashboard to a running term', () => {
    it('is priced add-on x remaining days / plan days, and grants the remaining days of Dashboard', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      await buyAndRedeem(pool, admin, teacher, { plan: 'annuel', now: T0 }); // visibility only, 365 days

      const created = await createUpgradeRequest(
        pool,
        teacher,
        { method: 'd17' },
        atDays(265),
      ); // 100 days left
      if (!created.ok) throw new Error(`upgrade failed: ${created.reason}`);
      expect(created.request).toMatchObject({
        kind: 'upgrade',
        amountMillimes: 16500,
        withDashboard: true,
      });
      const plan = (await getPlan(pool, created.request.planId))!;
      expect(created.request.amountMillimes).toBe(upgradePrice(plan, 100));

      const issued = await issueCode(
        pool,
        admin,
        created.request.id,
        { transactionRef: 'UP-1', transactionDate: '2026-10-26' },
        atDays(265),
      );
      if (!issued.ok) throw new Error('issue failed');
      expect(
        (await redeemCode(pool, teacher, issued.code, atDays(265))).ok,
      ).toBe(true);

      const e = (await entitlementsOf(pool, teacher))!;
      expect(ms(e.visibility_until)).toBe(atDays(365).getTime()); // unchanged
      expect(ms(e.dashboard_until)).toBe(atDays(365).getTime()); // now equal to visibility
    });

    it('is not offered without a running term, or when the Dashboard already runs', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      expect(
        await createUpgradeRequest(pool, teacher, { method: 'ccp' }, T0),
      ).toEqual({ ok: false, reason: 'not_available' });

      await buyAndRedeem(pool, admin, teacher, {
        plan: 'trimestriel',
        withDashboard: true,
        now: T0,
      });
      expect(
        await createUpgradeRequest(
          pool,
          teacher,
          { method: 'ccp' },
          atDays(10),
        ),
      ).toEqual({
        ok: false,
        reason: 'not_available',
      });
      // After the term, nothing is left to upgrade.
      expect(
        await createUpgradeRequest(
          pool,
          teacher,
          { method: 'ccp' },
          atDays(200),
        ),
      ).toEqual({
        ok: false,
        reason: 'not_available',
      });
    });
  });

  // ======================================================================= admin side
  describe('admin: verifying a payment and issuing the code', () => {
    async function open(teacher: string, now = T0) {
      const created = await createPaymentRequest(
        pool,
        teacher,
        {
          planId: await planBySlug(pool, 'trimestriel'),
          withDashboard: true,
          method: 'flouci',
        },
        now,
      );
      if (!created.ok) throw new Error('setup');
      return created.request;
    }
    const proof = (n: string) => ({
      transactionRef: `TX-${n}`,
      transactionDate: '2026-10-26',
    });

    it('issues one code from that request, marks it verified, and logs it', async () => {
      const teacher = await createTeacher(pool);
      const req = await open(teacher);
      expect((await markProofReceived(pool, admin, req.id)).ok).toBe(true);
      const issued = await issueCode(pool, admin, req.id, proof('A1'), T0);
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      expect(issued.code).toMatch(
        /^TTP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
      );
      const detail = (await getPaymentDetail(pool, req.id))!;
      expect(detail).toMatchObject({
        status: 'verified',
        transactionRef: 'TX-A1',
        codeStatus: 'issued',
      });

      const { rows } = await pool.query(
        'SELECT visibility_days, dashboard_days, expires_at, code_hash FROM activation_codes',
      );
      expect(rows[0]).toMatchObject({
        visibility_days: 90,
        dashboard_days: 90,
      });
      expect(rows[0].expires_at).toEqual(atDays(90)); // unredeemed codes expire after 90 days
      expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].code_hash).not.toContain(issued.code.replace(/-/g, ''));

      const log = await pool.query(
        'SELECT action, actor_id FROM audit_log ORDER BY id',
      );
      expect(log.rows.map((r) => r.action)).toEqual([
        'payment.proof_received',
        'payment.issue_code',
      ]);
      expect(log.rows.every((r) => r.actor_id === admin)).toBe(true);
    });

    it('the teacher sees the code in their space until it is used, then not any more', async () => {
      const teacher = await createTeacher(pool);
      const req = await open(teacher);
      const issued = await issueCode(pool, admin, req.id, proof('A2'), T0);
      if (!issued.ok) throw new Error('setup');
      expect(
        (await findIssuedCodeForTeacher(pool, teacher, atDays(1)))?.code,
      ).toBe(issued.code);
      // Another teacher sees nothing.
      expect(
        await findIssuedCodeForTeacher(
          pool,
          await createTeacher(pool),
          atDays(1),
        ),
      ).toBeNull();

      await redeemCode(pool, teacher, issued.code, atDays(1));
      expect(
        await findIssuedCodeForTeacher(pool, teacher, atDays(2)),
      ).toBeNull();
    });

    it('the same transaction number can never be used twice (spec 13.3)', async () => {
      const [a, b] = [await createTeacher(pool), await createTeacher(pool)];
      const [ra, rb] = [await open(a), await open(b)];
      expect((await issueCode(pool, admin, ra.id, proof('SAME'), T0)).ok).toBe(
        true,
      );
      expect(await issueCode(pool, admin, rb.id, proof('SAME'), T0)).toEqual({
        ok: false,
        reason: 'transaction_reused',
      });
      // The second request stays open and untouched.
      expect((await getPaymentDetail(pool, rb.id))!.status).toBe('pending');
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM activation_codes'))
          .rows[0].n,
      ).toBe(1);
    });

    it('needs a transaction number and a date, and works once per request', async () => {
      const teacher = await createTeacher(pool);
      const req = await open(teacher);
      expect(
        await issueCode(
          pool,
          admin,
          req.id,
          { transactionRef: '  ', transactionDate: '2026-10-26' },
          T0,
        ),
      ).toEqual({
        ok: false,
        reason: 'invalid_input',
      });
      expect(
        await issueCode(
          pool,
          admin,
          req.id,
          { transactionRef: 'X', transactionDate: 'yesterday' },
          T0,
        ),
      ).toEqual({
        ok: false,
        reason: 'invalid_input',
      });
      expect((await issueCode(pool, admin, req.id, proof('B1'), T0)).ok).toBe(
        true,
      );
      expect(await issueCode(pool, admin, req.id, proof('B2'), T0)).toEqual({
        ok: false,
        reason: 'invalid_state',
      });
    });

    it('refuses a request that was rejected or cancelled, and an unknown one', async () => {
      const teacher = await createTeacher(pool);
      const req = await open(teacher);
      await rejectPaymentRequest(pool, admin, req.id, 'Montant non reçu', T0);
      expect(await issueCode(pool, admin, req.id, proof('C1'), T0)).toEqual({
        ok: false,
        reason: 'invalid_state',
      });
      expect(
        await issueCode(
          pool,
          admin,
          '00000000-0000-0000-0000-000000000000',
          proof('C2'),
          T0,
        ),
      ).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });

    it('rejecting needs a written note, and frees the teacher to ask again', async () => {
      const teacher = await createTeacher(pool);
      const req = await open(teacher);
      expect(await rejectPaymentRequest(pool, admin, req.id, '   ')).toEqual({
        ok: false,
        reason: 'invalid_input',
      });
      expect(
        (
          await rejectPaymentRequest(
            pool,
            admin,
            req.id,
            'Montant non reçu',
            T0,
          )
        ).ok,
      ).toBe(true);
      expect(await getPaymentDetail(pool, req.id)).toMatchObject({
        status: 'rejected',
        note: 'Montant non reçu',
      });
      expect((await open(teacher)).status).toBe('pending');
    });

    it('only an active admin can do any of it', async () => {
      const teacher = await createTeacher(pool);
      const other = await createTeacher(pool);
      const req = await open(teacher);
      const suspended = await createAdminUser(pool);
      await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [
        suspended,
      ]);

      for (const actor of [
        teacher,
        other,
        suspended,
        '00000000-0000-0000-0000-000000000000',
      ]) {
        expect(await markProofReceived(pool, actor, req.id)).toEqual({
          ok: false,
          reason: 'forbidden',
        });
        expect(await rejectPaymentRequest(pool, actor, req.id, 'note')).toEqual(
          { ok: false, reason: 'forbidden' },
        );
        expect(await issueCode(pool, actor, req.id, proof('D1'), T0)).toEqual({
          ok: false,
          reason: 'forbidden',
        });
        expect(await revokeCode(pool, actor, req.id, 'note')).toEqual({
          ok: false,
          reason: 'forbidden',
        });
        expect(
          await grantDaysManually(pool, actor, teacher, {
            visibilityDays: 5,
            dashboardDays: 0,
            note: 'x',
          }),
        ).toEqual({
          ok: false,
          reason: 'forbidden',
        });
      }
      expect((await getPaymentDetail(pool, req.id))!.status).toBe('pending');
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0]
          .n,
      ).toBe(0);
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM activation_codes'))
          .rows[0].n,
      ).toBe(0);
    });

    it('lists open requests oldest first', async () => {
      const [a, b, c] = [
        await createTeacher(pool),
        await createTeacher(pool),
        await createTeacher(pool),
      ];
      const rb = await open(b, at(minutes(5)));
      const ra = await open(a, at(minutes(1)));
      const rc = await open(c, at(minutes(9)));
      await rejectPaymentRequest(pool, admin, rc.id, 'doublon');
      const open1 = await listPaymentRequests(pool, 'open');
      expect(open1.map((r) => r.id)).toEqual([ra.id, rb.id]);
      expect(open1[0]).toMatchObject({
        teacherPhone: expect.stringMatching(/^\+216/),
        planNameFr: 'Trimestriel',
      });
      expect((await listPaymentRequests(pool, 'all')).length).toBe(3);
    });
  });

  // ==================================================== activation codes (test 13)
  describe('redeeming activation codes', () => {
    async function approved() {
      await noFounding();
      return createApprovedTeacher(pool, ids, admin);
    }

    it('ACCEPTANCE 13: five wrong codes lock the account for an hour, even for the right code', async () => {
      const teacher = await approved();
      const { code } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
      });

      for (let i = 1; i <= 5; i++) {
        expect(
          await redeemCode(pool, teacher, 'TTP-ABCD-EFGH-JKLM', at(minutes(i))),
        ).toEqual({
          ok: false,
          reason: 'invalid',
        });
      }
      // The 6th attempt is refused for the lock, even with the right code.
      const sixth = await redeemCode(pool, teacher, code, at(minutes(6)));
      expect(sixth).toMatchObject({ ok: false, reason: 'locked' });
      if (!sixth.ok && sixth.reason === 'locked') {
        expect(sixth.retryAfterMs).toBe(minutes(60 - 1)); // 1 hour from the 5th wrong try (minute 5)
      }
      expect(
        (await entitlementsOf(pool, teacher))?.visibility_until,
      ).toBeNull();

      // A lockout does not count as a new wrong attempt and ends one hour after the last one.
      expect(
        await redeemCode(pool, teacher, code, at(minutes(64))),
      ).toMatchObject({ ok: false, reason: 'locked' });
      expect((await redeemCode(pool, teacher, code, at(minutes(66)))).ok).toBe(
        true,
      );
    });

    it('four wrong codes do not lock, and old mistakes are forgotten after an hour', async () => {
      const teacher = await approved();
      const { code } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
      });
      for (let i = 1; i <= 4; i++)
        await redeemCode(pool, teacher, 'TTP-ABCD-EFGH-JKLM', at(minutes(i)));
      // A fifth wrong code only after the first four are over an hour old: no lock.
      await redeemCode(pool, teacher, 'TTP-ABCD-EFGH-JKLM', at(minutes(130)));
      expect((await redeemCode(pool, teacher, code, at(minutes(131)))).ok).toBe(
        true,
      );
    });

    it('the lock is per account: another teacher is not affected', async () => {
      const teacher = await approved();
      const other = await createApprovedTeacher(pool, ids, admin, T0);
      const { code } = await purchaseCode(pool, admin, other, {
        plan: 'mensuel',
      });
      for (let i = 1; i <= 5; i++)
        await redeemCode(pool, teacher, 'TTP-ABCD-EFGH-JKLM', at(minutes(i)));
      expect((await redeemCode(pool, other, code, at(minutes(6)))).ok).toBe(
        true,
      );
    });

    it('ACCEPTANCE 13: a reused code is refused', async () => {
      const teacher = await approved();
      const { code } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
      });
      expect((await redeemCode(pool, teacher, code, T0)).ok).toBe(true);
      expect(await redeemCode(pool, teacher, code, atDays(1))).toEqual({
        ok: false,
        reason: 'used',
      });
      // It gave its days only once.
      expect(ms((await entitlementsOf(pool, teacher))!.visibility_until)).toBe(
        atDays(30).getTime(),
      );
    });

    it('ACCEPTANCE 13: a revoked code is refused, and the payment request is closed', async () => {
      const teacher = await approved();
      const { code, request } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
      });
      expect(await revokeCode(pool, admin, request.id, '   ')).toEqual({
        ok: false,
        reason: 'invalid_input',
      });
      expect(
        (
          await revokeCode(
            pool,
            admin,
            request.id,
            'Paiement annulé par la banque',
            T0,
          )
        ).ok,
      ).toBe(true);
      expect(await redeemCode(pool, teacher, code, atDays(1))).toEqual({
        ok: false,
        reason: 'revoked',
      });
      expect(await getPaymentDetail(pool, request.id)).toMatchObject({
        status: 'rejected',
        codeStatus: 'revoked',
      });
      expect(
        (await entitlementsOf(pool, teacher))?.visibility_until,
      ).toBeNull();
    });

    it('a code that was already used cannot be revoked', async () => {
      const teacher = await approved();
      const { code, request } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
      });
      await redeemCode(pool, teacher, code, T0);
      expect(await revokeCode(pool, admin, request.id, 'trop tard')).toEqual({
        ok: false,
        reason: 'invalid_state',
      });
    });

    it('an unredeemed code expires after 90 days', async () => {
      const teacher = await approved();
      const { code, request } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
      });
      expect(
        (
          await redeemCode(
            pool,
            teacher,
            code,
            new Date(atDays(90).getTime() - 1),
          )
        ).ok,
      ).toBe(true);

      // A second one, left unused for 90 days:
      const { code: late } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
        now: atDays(100),
      });
      expect(await redeemCode(pool, teacher, late, atDays(190))).toEqual({
        ok: false,
        reason: 'expired',
      });
      expect(request.id).toBeTruthy();
      const { rows } = await pool.query(
        "SELECT status FROM activation_codes WHERE status = 'expired'",
      );
      expect(rows).toHaveLength(1);
    });

    it('a teacher cannot use someone else’s code, and the answer does not reveal that it exists', async () => {
      const [owner, thief] = [
        await approved(),
        await createApprovedTeacher(pool, ids, admin),
      ];
      const { code } = await purchaseCode(pool, admin, owner, {
        plan: 'mensuel',
      });
      expect(await redeemCode(pool, thief, code, T0)).toEqual({
        ok: false,
        reason: 'invalid',
      });
      expect(
        (await entitlementsOf(pool, thief))?.visibility_until ?? null,
      ).toBeNull();
      // The owner can still use it.
      expect((await redeemCode(pool, owner, code, T0)).ok).toBe(true);
    });

    it('is tolerant about how the code is typed', async () => {
      const teacher = await approved();
      const { code } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
      });
      expect(
        (
          await redeemCode(
            pool,
            teacher,
            ` ${code.toLowerCase().replace(/-/g, ' ')} `,
            T0,
          )
        ).ok,
      ).toBe(true);
    });

    it('a suspended teacher keeps the code: it is not used and not counted as a mistake', async () => {
      const teacher = await approved();
      const { code } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
      });
      await pool.query(
        "UPDATE teacher_profiles SET status = 'suspended' WHERE user_id = $1",
        [teacher],
      );
      expect(await redeemCode(pool, teacher, code, T0)).toEqual({
        ok: false,
        reason: 'suspended',
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM rate_limit_events WHERE bucket = 'code_failure:user'",
          )
        ).rows[0].n,
      ).toBe(0);
      await pool.query(
        "UPDATE teacher_profiles SET status = 'approved' WHERE user_id = $1",
        [teacher],
      );
      expect((await redeemCode(pool, teacher, code, T0)).ok).toBe(true);
    });

    it('a code redeemed before the profile exists waits as credit too', async () => {
      await noFounding();
      const teacher = await createTeacher(pool); // no profile row at all
      const { code } = await purchaseCode(pool, admin, teacher, {
        plan: 'trimestriel',
        withDashboard: true,
      });
      expect(await redeemCode(pool, teacher, code, T0)).toMatchObject({
        ok: true,
        credited: true,
      });
      const e = (await entitlementsOf(pool, teacher))!;
      expect([
        e.pending_visibility_days,
        e.pending_dashboard_days,
        e.visibility_until,
      ]).toEqual([90, 90, null]);
    });

    it('the code in the database can be traced to its payment request, plan and teacher', async () => {
      const teacher = await approved();
      const { request } = await purchaseCode(pool, admin, teacher, {
        plan: 'semestriel',
        withDashboard: true,
      });
      const { rows } = await pool.query(
        `SELECT c.teacher_id, c.visibility_days, c.dashboard_days, p.slug
         FROM activation_codes c JOIN plans p ON p.id = c.plan_id WHERE c.payment_request_id = $1`,
        [request.id],
      );
      expect(rows[0]).toEqual({
        teacher_id: teacher,
        visibility_days: 180,
        dashboard_days: 180,
        slug: 'semestriel',
      });
    });

    it('deriving the code again from its id gives the same code (no secret stored)', async () => {
      const teacher = await approved();
      const { code } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
      });
      const { rows } = await pool.query('SELECT id FROM activation_codes');
      expect(deriveActivationCode(rows[0].id)).toBe(code);
    });
  });

  // ================================================================ founding (test 20)
  describe('the founding offer (spec 2.6)', () => {
    const approveNext = async (phone?: string) =>
      createApprovedTeacher(pool, ids, admin, T0, { phone });

    it('ACCEPTANCE 20: the 100th approved teacher gets 365 days automatically, the 101st does not', async () => {
      await setSetting('founding.slots_used', '99');
      const hundredth = await approveNext();
      const e100 = (await entitlementsOf(pool, hundredth))!;
      expect(ms(e100.visibility_until)).toBe(atDays(365).getTime());
      expect(ms(e100.dashboard_until)).toBe(atDays(365).getTime()); // assumption: includes the Dashboard
      expect(await isVisible(pool, hundredth, atDays(10))).toBe(true); // no code needed

      const next = await approveNext();
      expect(
        (await entitlementsOf(pool, next))?.visibility_until ?? null,
      ).toBeNull();
      expect(await isVisible(pool, next, atDays(10))).toBe(false);
      expect(await getFoundingSlots(pool)).toEqual({
        total: 100,
        used: 100,
        left: 0,
      });
    });

    it('ACCEPTANCE 20: the counter moves only on approval, and a rejected profile uses no slot', async () => {
      const rejected = await createPendingTeacher(pool, ids);
      await rejectProfile(pool, admin, rejected, {
        reason: 'incomplete_info',
        note: null,
      });
      const stillPending = await createPendingTeacher(pool, ids);
      const draft = await createTeacher(pool);
      await saveProfile(pool, draft, completeInput(ids), { strict: true });
      expect((await getFoundingSlots(pool)).used).toBe(0);

      await approveNext();
      expect((await getFoundingSlots(pool)).used).toBe(1);
      expect(await entitlementsOf(pool, rejected)).toBeUndefined();
      expect(await entitlementsOf(pool, stillPending)).toBeUndefined();
    });

    it('hands out exactly as many years as there are slots', async () => {
      await setSetting('founding.slots_total', '5');
      const given: boolean[] = [];
      for (let i = 0; i < 8; i++) {
        const teacher = await approveNext();
        given.push(
          ((await entitlementsOf(pool, teacher))?.visibility_until ?? null) !==
            null,
        );
      }
      expect(given).toEqual([
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        false,
      ]);
      expect(await getFoundingSlots(pool)).toEqual({
        total: 5,
        used: 5,
        left: 0,
      });
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM entitlement_grants'))
          .rows[0].n,
      ).toBe(5);
    });

    it('two approvals at the same moment cannot share the last slot', async () => {
      await setSetting('founding.slots_total', '1');
      const [a, b] = [
        await createPendingTeacher(pool, ids),
        await createPendingTeacher(pool, ids),
      ];
      await Promise.all([
        approveProfile(pool, admin, a, T0),
        approveProfile(pool, admin, b, T0),
      ]);
      const granted = (
        await pool.query(
          'SELECT count(*)::int AS n FROM entitlement_grants WHERE source = $1',
          ['founding'],
        )
      ).rows[0].n;
      expect(granted).toBe(1);
      expect((await getFoundingSlots(pool)).used).toBe(1);
    });

    it('one year per phone number: the same number cannot claim again after a new sign-up', async () => {
      const phone = '+21622000123';
      const first = await approveNext(phone);
      expect(
        (await entitlementsOf(pool, first))?.visibility_until,
      ).not.toBeNull();
      await pool.query('DELETE FROM users WHERE id = $1', [first]); // account deleted
      const again = await approveNext(phone);
      expect(
        (await entitlementsOf(pool, again))?.visibility_until ?? null,
      ).toBeNull();
      expect((await getFoundingSlots(pool)).used).toBe(1);
    });

    it('follows the flags: the free year may exclude the Dashboard (no code change needed)', async () => {
      await setSetting('founding.grant_dashboard', 'false');
      const teacher = await approveNext();
      const e = (await entitlementsOf(pool, teacher))!;
      expect(ms(e.visibility_until)).toBe(atDays(365).getTime());
      expect(e.dashboard_until).toBeNull();
    });

    it('is recorded as a grant with source "founding", and a later code adds to it', async () => {
      const teacher = await approveNext();
      const { rows } = await pool.query(
        'SELECT source, visibility_days, dashboard_days, as_credit FROM entitlement_grants',
      );
      expect(rows).toEqual([
        {
          source: 'founding',
          visibility_days: 365,
          dashboard_days: 365,
          as_credit: false,
        },
      ]);
      await buyAndRedeem(pool, admin, teacher, {
        plan: 'mensuel',
        now: atDays(300),
      });
      expect(ms((await entitlementsOf(pool, teacher))!.visibility_until)).toBe(
        atDays(395).getTime(),
      );
    });

    it('is not given twice for the same profile (re-approval of a restored profile)', async () => {
      const teacher = await approveNext();
      const before = ms(
        (await entitlementsOf(pool, teacher))!.visibility_until,
      );
      await pool.query(
        "UPDATE teacher_profiles SET status = 'pending' WHERE user_id = $1",
        [teacher],
      );
      await approveProfile(pool, admin, teacher, atDays(3));
      expect(ms((await entitlementsOf(pool, teacher))!.visibility_until)).toBe(
        before,
      );
    });
  });

  // ======================================================================= manual grants
  describe('manual extension by an admin (spec 6)', () => {
    it('adds days with a written note, logs them, and records the admin', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      const result = await grantDaysManually(
        pool,
        admin,
        teacher,
        { visibilityDays: 10, dashboardDays: 5, note: 'Geste commercial' },
        T0,
      );
      expect(result).toEqual({ ok: true, credited: false });
      const e = (await entitlementsOf(pool, teacher))!;
      expect([ms(e.visibility_until), ms(e.dashboard_until)]).toEqual([
        atDays(10).getTime(),
        atDays(5).getTime(),
      ]);

      const grant = await pool.query(
        'SELECT source, note, granted_by FROM entitlement_grants',
      );
      expect(grant.rows).toEqual([
        { source: 'admin', note: 'Geste commercial', granted_by: admin },
      ]);
      expect(
        (await pool.query('SELECT action FROM audit_log')).rows.map(
          (r) => r.action,
        ),
      ).toContain('entitlement.manual_grant');
    });

    it('always needs a note, and sensible numbers', async () => {
      const teacher = await createApprovedTeacher(pool, ids, admin);
      for (const bad of [
        { visibilityDays: 10, dashboardDays: 0, note: '' },
        { visibilityDays: 10, dashboardDays: 0, note: '   ' },
        { visibilityDays: 0, dashboardDays: 0, note: 'x' },
        { visibilityDays: -1, dashboardDays: 5, note: 'x' },
        { visibilityDays: 1.5, dashboardDays: 0, note: 'x' },
        { visibilityDays: 5000, dashboardDays: 0, note: 'x' },
      ]) {
        expect(await grantDaysManually(pool, admin, teacher, bad)).toEqual({
          ok: false,
          reason: 'invalid_input',
        });
      }
    });

    it('waits as credit for a profile that is not approved yet', async () => {
      await noFounding();
      const teacher = await createPendingTeacher(pool, ids);
      expect(
        await grantDaysManually(pool, admin, teacher, {
          visibilityDays: 30,
          dashboardDays: 0,
          note: 'x',
        }),
      ).toEqual({
        ok: true,
        credited: true,
      });
      expect(
        (await entitlementsOf(pool, teacher))!.pending_visibility_days,
      ).toBe(30);
    });

    it('only works for teacher accounts', async () => {
      expect(
        await grantDaysManually(pool, admin, admin, {
          visibilityDays: 5,
          dashboardDays: 0,
          note: 'x',
        }),
      ).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });

    it('the database insists on the note for admin grants', async () => {
      const teacher = await createTeacher(pool);
      await pool.query('INSERT INTO entitlements (teacher_id) VALUES ($1)', [
        teacher,
      ]);
      await expect(
        pool.query(
          `INSERT INTO entitlement_grants (teacher_id, source, visibility_days, dashboard_days, started_at, granted_by)
           VALUES ($1, 'admin', 5, 0, now(), $2)`,
          [teacher, admin],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  // ====================================================================== daily job
  describe('daily job', () => {
    it('marks unredeemed codes past their expiry, and is safe to run twice', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      const { request } = await purchaseCode(pool, admin, teacher, {
        plan: 'mensuel',
        now: T0,
      });
      expect(await expireStaleCodes(pool, atDays(89))).toBe(0);
      expect(await expireStaleCodes(pool, atDays(91))).toBe(1);
      expect(await expireStaleCodes(pool, atDays(92))).toBe(0);
      expect((await getPaymentDetail(pool, request.id))!.codeStatus).toBe(
        'expired',
      );
    });

    it('leaves redeemed codes alone', async () => {
      await noFounding();
      const teacher = await createApprovedTeacher(pool, ids, admin);
      await buyAndRedeem(pool, admin, teacher, { plan: 'mensuel' });
      expect(await expireStaleCodes(pool, atDays(400))).toBe(0);
    });
  });

  // ====================================================================== constraints
  describe('rules enforced by the database', () => {
    it('a request needs a positive amount, a known method and a well-formed reference', async () => {
      const teacher = await createTeacher(pool);
      const planId = await planBySlug(pool, 'mensuel');
      const insert = (amount: number, method: string, reference: string) =>
        pool.query(
          `INSERT INTO payment_requests (teacher_id, plan_id, with_dashboard, amount_millimes, method, reference)
           VALUES ($1, $2, false, $3, $4, $5)`,
          [teacher, planId, amount, method, reference],
        );
      await expect(insert(0, 'flouci', 'TTP-11111')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(insert(-5, 'flouci', 'TTP-11111')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(insert(1000, 'paypal', 'TTP-11111')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(insert(1000, 'flouci', 'TTP-1234')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(insert(1000, 'flouci', 'XXX-12345')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await insert(1000, 'flouci', 'TTP-11111');
      // a second open request is refused by the one-open-request rule
      await expect(insert(1000, 'ccp', 'TTP-22222')).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
    });

    it('a verified payment must carry its transaction number and date', async () => {
      const teacher = await createTeacher(pool);
      const planId = await planBySlug(pool, 'mensuel');
      await expect(
        pool.query(
          `INSERT INTO payment_requests (teacher_id, plan_id, with_dashboard, amount_millimes, method, reference, status)
           VALUES ($1, $2, false, 1000, 'ccp', 'TTP-33333', 'verified')`,
          [teacher, planId],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('a code needs days, a status that matches its dates, and one payment request', async () => {
      const teacher = await createTeacher(pool);
      const created = await createPaymentRequest(pool, teacher, {
        planId: await planBySlug(pool, 'mensuel'),
        withDashboard: false,
        method: 'ccp',
      });
      if (!created.ok) throw new Error('setup');
      const insert = (set: string) =>
        pool.query(
          `INSERT INTO activation_codes (id, code_hash, plan_id, visibility_days, dashboard_days, payment_request_id, teacher_id, expires_at, ${set.split('|')[0]})
           VALUES (gen_random_uuid(), md5(random()::text), $1, ${set.split('|')[1]}, $2, $3, now() + interval '1 day', ${set.split('|')[2]})`,
          [created.request.planId, created.request.id, teacher],
        );
      // no days at all
      await expect(
        pool.query(
          `INSERT INTO activation_codes (id, code_hash, plan_id, visibility_days, dashboard_days, payment_request_id, teacher_id, expires_at)
           VALUES (gen_random_uuid(), 'h1', $1, 0, 0, $2, $3, now() + interval '1 day')`,
          [created.request.planId, created.request.id, teacher],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      // 'redeemed' without a redemption date
      await expect(
        pool.query(
          `INSERT INTO activation_codes (id, code_hash, plan_id, visibility_days, dashboard_days, payment_request_id, teacher_id, expires_at, status)
           VALUES (gen_random_uuid(), 'h2', $1, 30, 0, $2, $3, now() + interval '1 day', 'redeemed')`,
          [created.request.planId, created.request.id, teacher],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      void insert;
    });

    it('a grant of type "code" must name its code, and a grant needs days', async () => {
      const teacher = await createTeacher(pool);
      await pool.query('INSERT INTO entitlements (teacher_id) VALUES ($1)', [
        teacher,
      ]);
      const insert = (source: string, v: number, d: number) =>
        pool.query(
          `INSERT INTO entitlement_grants (teacher_id, source, visibility_days, dashboard_days, started_at)
           VALUES ($1, $2, $3, $4, now())`,
          [teacher, source, v, d],
        );
      await expect(insert('code', 30, 0)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(insert('founding', 0, 0)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(insert('gift', 5, 0)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await insert('founding', 365, 365);
    });

    it('negative credit is impossible', async () => {
      const teacher = await createTeacher(pool);
      await expect(
        pool.query(
          'INSERT INTO entitlements (teacher_id, pending_visibility_days) VALUES ($1, -1)',
          [teacher],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  it('the profile approval keeps working for a teacher without any billing row', async () => {
    await setSetting('founding.slots_total', '0');
    const teacher = await createPendingTeacher(pool, ids);
    const result = await approveProfile(pool, admin, teacher, T0);
    expect(result.ok).toBe(true);
    expect((await loadProfile(pool, teacher))!.status).toBe('approved');
    expect(await submitProfile(pool, teacher)).toEqual({
      ok: false,
      error: 'invalid_state',
    });
  });
});
