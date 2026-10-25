import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import {
  loadProfile,
  saveProfile,
  submitProfile,
  type ProfileInput,
} from '@/lib/profile/repo';
import {
  approveProfile,
  approveVersion,
  listReviewQueue,
  loadForReview,
  rejectProfile,
  rejectVersion,
  restoreProfile,
  suspendProfile,
} from '@/lib/profile/review';
import { REJECTION_REASONS } from '@/lib/profile/rules';
import { at, clearAuthTables, minutes, T0 } from './auth-helpers';
import {
  completeInput,
  createAdminUser,
  createTeacher,
  loadCatalogueIds,
  photoKey,
  type CatalogueIds,
} from './profile-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';

describe.skipIf(!testDatabaseUrl)('profile review by admins (database)', () => {
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

  const edit = async (teacher: string, input: ProfileInput) => {
    const result = await saveProfile(pool, teacher, input, { strict: true });
    if (!result.ok) throw new Error(`save failed: ${result.error}`);
    return result;
  };

  async function pending(
    overrides: Partial<ProfileInput> = {},
    submittedAt = T0,
  ) {
    const teacher = await createTeacher(pool);
    await edit(teacher, completeInput(ids, overrides));
    expect(await submitProfile(pool, teacher, submittedAt)).toEqual({
      ok: true,
    });
    return teacher;
  }

  async function approved(overrides: Partial<ProfileInput> = {}) {
    const teacher = await pending(overrides);
    expect((await approveProfile(pool, admin, teacher)).ok).toBe(true);
    return teacher;
  }

  const audit = async () =>
    (
      await pool.query(
        'SELECT actor_id, action, target_id, details FROM audit_log ORDER BY id',
      )
    ).rows;

  describe('only an active admin may decide', () => {
    it('refuses teachers, reviewers, suspended admins and unknown actors, and changes nothing', async () => {
      const teacher = await pending();
      const otherTeacher = await createTeacher(pool);
      const { rows } = await pool.query(
        `INSERT INTO users (role, phone_e164, status, phone_verified_at)
         VALUES ('visitor', '+21640000777', 'active', now()) RETURNING id`,
      );
      const suspendedAdmin = await createAdminUser(pool);
      await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [
        suspendedAdmin,
      ]);

      for (const actor of [
        otherTeacher,
        teacher,
        rows[0].id,
        suspendedAdmin,
        '00000000-0000-0000-0000-000000000000',
      ]) {
        expect(await approveProfile(pool, actor, teacher)).toEqual({
          ok: false,
          reason: 'forbidden',
        });
        expect(
          await rejectProfile(pool, actor, teacher, {
            reason: 'other',
            note: 'x',
          }),
        ).toEqual({
          ok: false,
          reason: 'forbidden',
        });
        expect(await suspendProfile(pool, actor, teacher, 'because')).toEqual({
          ok: false,
          reason: 'forbidden',
        });
      }
      expect((await loadProfile(pool, teacher))!.status).toBe('pending');
      expect(await audit()).toEqual([]);
    });

    it('both support and super admins can review', async () => {
      const superAdmin = await createAdminUser(pool, 'admin_super');
      const a = await pending();
      const b = await pending();
      expect((await approveProfile(pool, admin, a)).ok).toBe(true);
      expect((await approveProfile(pool, superAdmin, b)).ok).toBe(true);
    });

    it('an unknown profile is reported as not found', async () => {
      expect(
        await approveProfile(
          pool,
          admin,
          '00000000-0000-0000-0000-000000000000',
        ),
      ).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });
  });

  describe('approve', () => {
    it('pending -> approved, records the reviewer and the time, and writes the audit log', async () => {
      const teacher = await pending();
      const result = await approveProfile(pool, admin, teacher, at(minutes(5)));
      expect(result.ok).toBe(true);

      const profile = (await loadProfile(pool, teacher))!;
      expect(profile.status).toBe('approved');
      expect(profile.approvedAt).toEqual(at(minutes(5)));
      expect(profile.rejectionReason).toBeNull();

      const log = await audit();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        actor_id: admin,
        action: 'profile.approve',
        target_id: teacher,
      });
      expect(log[0].details).toMatchObject({ from: 'pending', to: 'approved' });
    });

    it('only a pending profile can be approved', async () => {
      const draft = await createTeacher(pool);
      await edit(draft, completeInput(ids));
      expect(await approveProfile(pool, admin, draft)).toEqual({
        ok: false,
        reason: 'invalid_state',
      });

      const done = await approved();
      expect(await approveProfile(pool, admin, done)).toEqual({
        ok: false,
        reason: 'invalid_state',
      });
    });
  });

  describe('reject, then fix and resubmit', () => {
    it.each(REJECTION_REASONS.filter((r) => r !== 'other'))(
      'refuses with the template reason %s',
      async (reason) => {
        const teacher = await pending();
        expect(
          await rejectProfile(pool, admin, teacher, { reason, note: null }),
        ).toEqual({ ok: true });
        const profile = (await loadProfile(pool, teacher))!;
        expect(profile).toMatchObject({
          status: 'rejected',
          rejectionReason: reason,
          rejectionNote: null,
        });
      },
    );

    it('"other" needs a written explanation, and any note is kept trimmed', async () => {
      const teacher = await pending();
      expect(
        await rejectProfile(pool, admin, teacher, {
          reason: 'other',
          note: '   ',
        }),
      ).toEqual({
        ok: false,
        reason: 'invalid_reason',
      });
      expect(
        await rejectProfile(pool, admin, teacher, {
          reason: 'other',
          note: '  Photo floue  ',
        }),
      ).toEqual({
        ok: true,
      });
      expect((await loadProfile(pool, teacher))!.rejectionNote).toBe(
        'Photo floue',
      );
    });

    it('refuses an unknown reason', async () => {
      const teacher = await pending();
      expect(
        await rejectProfile(pool, admin, teacher, {
          reason: 'because I said so',
          note: null,
        }),
      ).toEqual({
        ok: false,
        reason: 'invalid_reason',
      });
      expect((await loadProfile(pool, teacher))!.status).toBe('pending');
    });

    it('the teacher fixes the profile and resubmits; the old reason disappears', async () => {
      const teacher = await pending();
      await rejectProfile(pool, admin, teacher, {
        reason: 'bio_unclear',
        note: 'Précisez les niveaux',
      });
      const rejected = (await loadProfile(pool, teacher))!;
      expect(rejected.status).toBe('rejected');

      await edit(
        teacher,
        completeInput(ids, {
          bio: 'Professeure de physique, cours détaillés pour tous les niveaux du lycée.',
        }),
      );
      expect(await submitProfile(pool, teacher, at(minutes(30)))).toEqual({
        ok: true,
      });
      const again = (await loadProfile(pool, teacher))!;
      expect(again).toMatchObject({
        status: 'pending',
        rejectionReason: null,
        rejectionNote: null,
      });

      expect((await approveProfile(pool, admin, teacher)).ok).toBe(true);
    });

    it('only a pending profile can be refused', async () => {
      const teacher = await approved();
      expect(
        await rejectProfile(pool, admin, teacher, {
          reason: 'incomplete_info',
          note: null,
        }),
      ).toEqual({
        ok: false,
        reason: 'invalid_state',
      });
    });
  });

  describe('edits to an approved profile (spec 4.2: review rules)', () => {
    const changes = async (teacher: string) => {
      const p = (await loadProfile(pool, teacher))!;
      return {
        fullName: p.fullName,
        bio: p.bio,
        diploma: p.diploma,
        photoKey: p.photoKey,
        pending: p.pendingVersion,
      };
    };

    it('price, zone, level, subject, mode and experience changes apply at once', async () => {
      const teacher = await approved();
      await edit(
        teacher,
        completeInput(ids, {
          experience: 'gt_15',
          modes: ['at_teacher'],
          levelIds: [ids.levels[2]],
          zoneIds: [ids.sfax.delegations[2]],
          subjects: [{ subjectId: ids.subjects[1], rateMillimes: 45500 }],
        }),
      );
      const profile = (await loadProfile(pool, teacher))!;
      expect(profile).toMatchObject({
        status: 'approved',
        experience: 'gt_15',
        modes: ['at_teacher'],
        levelIds: [ids.levels[2]],
        zoneIds: [ids.sfax.delegations[2]],
        pendingVersion: null,
      });
      expect(
        profile.subjects.map((s) => [s.subjectId, s.rateMillimes]),
      ).toEqual([[ids.subjects[1], 45500]]);
    });

    it('name, bio and diploma changes wait for review while the old version stays live', async () => {
      const teacher = await approved();
      const live = await changes(teacher);
      await edit(
        teacher,
        completeInput(ids, {
          fullName: 'Wassima Ben Salah',
          bio: 'Nouvelle présentation : professeure de physique et de chimie, tous niveaux du secondaire.',
          diploma: 'university_teacher',
        }),
      );
      const after = await changes(teacher);
      expect(after.fullName).toBe(live.fullName);
      expect(after.bio).toBe(live.bio);
      expect(after.diploma).toBe(live.diploma);
      expect(after.pending).toMatchObject({
        fullName: 'Wassima Ben Salah',
        diploma: 'university_teacher',
      });
      expect(after.pending!.bio).toContain('Nouvelle présentation');
    });

    it('a second edit replaces the waiting version, and going back to the live values removes it', async () => {
      const teacher = await approved();
      await edit(teacher, completeInput(ids, { fullName: 'First Change' }));
      await edit(teacher, completeInput(ids, { fullName: 'Second Change' }));
      expect((await changes(teacher)).pending!.fullName).toBe('Second Change');

      await edit(teacher, completeInput(ids)); // original values again
      expect((await changes(teacher)).pending).toBeNull();
    });

    it('an edit that would leave the approved profile incomplete is refused, and nothing changes', async () => {
      const teacher = await approved();
      const before = JSON.stringify(await loadProfile(pool, teacher));
      for (const overrides of [
        { levelIds: [] },
        { subjects: [] },
        { modes: ['at_home' as const], zoneIds: [] },
        { modes: [] },
      ]) {
        const result = await saveProfile(
          pool,
          teacher,
          completeInput(ids, overrides),
          { strict: false },
        );
        expect(result, JSON.stringify(overrides)).toEqual({
          ok: false,
          error: 'incomplete',
        });
      }
      expect(JSON.stringify(await loadProfile(pool, teacher))).toBe(before);
    });

    it('the waiting version shows up in the review queue as a change, not a new profile', async () => {
      const teacher = await approved();
      await edit(teacher, completeInput(ids, { fullName: 'Changed Name' }));
      const queue = await listReviewQueue(pool);
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ userId: teacher, kind: 'version' });
    });

    describe('photos', () => {
      it('follow the version: the new one waits, the old one stays live, unused files are reported', async () => {
        const [p1, p2, p3] = [photoKey(), photoKey(), photoKey()];
        const teacher = await approved({
          photo: { action: 'replace', key: p1 },
        });
        expect((await loadProfile(pool, teacher))!.photoKey).toBe(p1);

        // New photo: waits.
        const first = await edit(
          teacher,
          completeInput(ids, { photo: { action: 'replace', key: p2 } }),
        );
        expect(first.unusedPhotoKeys).toEqual([]);
        expect((await changes(teacher)).photoKey).toBe(p1);
        expect((await changes(teacher)).pending!.photoKey).toBe(p2);

        // Another new photo replaces the waiting one: the waiting one is now unused.
        const second = await edit(
          teacher,
          completeInput(ids, { photo: { action: 'replace', key: p3 } }),
        );
        expect(second.unusedPhotoKeys).toEqual([p2]);

        // Approval: p3 goes live, the old live photo is released.
        const result = await approveVersion(pool, admin, teacher);
        expect(result).toEqual({ ok: true, unusedPhotoKeys: [p1] });
        expect((await changes(teacher)).photoKey).toBe(p3);
        expect((await changes(teacher)).pending).toBeNull();
      });

      it('removing the photo of an approved profile waits for review too', async () => {
        const p1 = photoKey();
        const teacher = await approved({
          photo: { action: 'replace', key: p1 },
        });
        await edit(
          teacher,
          completeInput(ids, { photo: { action: 'remove' } }),
        );
        expect((await changes(teacher)).photoKey).toBe(p1);
        expect((await changes(teacher)).pending!.photoKey).toBeNull();
        expect(await approveVersion(pool, admin, teacher)).toEqual({
          ok: true,
          unusedPhotoKeys: [p1],
        });
        expect((await changes(teacher)).photoKey).toBeNull();
      });

      it('keeping the photo while editing the name keeps the photo', async () => {
        const p1 = photoKey();
        const teacher = await approved({
          photo: { action: 'replace', key: p1 },
        });
        await edit(teacher, completeInput(ids, { fullName: 'Another Name' }));
        expect((await changes(teacher)).pending!.photoKey).toBe(p1);
        expect(await approveVersion(pool, admin, teacher)).toEqual({
          ok: true,
          unusedPhotoKeys: [],
        });
        expect((await changes(teacher)).photoKey).toBe(p1);
      });

      it('replacing the photo before the first approval frees the old one at once', async () => {
        const [p1, p2] = [photoKey(), photoKey()];
        const teacher = await createTeacher(pool);
        await edit(
          teacher,
          completeInput(ids, { photo: { action: 'replace', key: p1 } }),
        );
        const result = await edit(
          teacher,
          completeInput(ids, { photo: { action: 'replace', key: p2 } }),
        );
        expect(result.unusedPhotoKeys).toEqual([p1]);
        expect((await loadProfile(pool, teacher))!.photoKey).toBe(p2);
      });
    });
  });

  describe('approve or refuse a waiting version', () => {
    async function withWaitingVersion(newPhoto?: string) {
      const live = photoKey();
      const teacher = await approved({
        photo: { action: 'replace', key: live },
      });
      await edit(
        teacher,
        completeInput(ids, {
          fullName: 'Wassima Nouvelle',
          photo: newPhoto
            ? { action: 'replace', key: newPhoto }
            : { action: 'keep' },
        }),
      );
      return { teacher, live };
    }

    it('approving applies the four fields, clears the version, and is logged', async () => {
      const { teacher } = await withWaitingVersion();
      expect(
        (await approveVersion(pool, admin, teacher, at(minutes(9)))).ok,
      ).toBe(true);
      const profile = (await loadProfile(pool, teacher))!;
      expect(profile).toMatchObject({
        fullName: 'Wassima Nouvelle',
        pendingVersion: null,
        status: 'approved',
      });
      expect((await audit()).map((l) => l.action)).toContain(
        'profile.approve_version',
      );
    });

    it('refusing keeps the live version, stores the reason, and releases the refused photo', async () => {
      const refusedPhoto = photoKey();
      const { teacher, live } = await withWaitingVersion(refusedPhoto);
      const result = await rejectVersion(pool, admin, teacher, {
        reason: 'photo_inappropriate',
        note: null,
      });
      expect(result).toEqual({ ok: true, unusedPhotoKeys: [refusedPhoto] });

      const profile = (await loadProfile(pool, teacher))!;
      expect(profile).toMatchObject({
        fullName: 'Wassima Chaaben',
        photoKey: live,
        pendingVersion: null,
        versionRejectionReason: 'photo_inappropriate',
        status: 'approved',
      });
    });

    it('a new edit clears the refusal message', async () => {
      const { teacher } = await withWaitingVersion();
      await rejectVersion(pool, admin, teacher, {
        reason: 'name_invalid',
        note: null,
      });
      await edit(teacher, completeInput(ids, { fullName: 'Wassima Corrigée' }));
      const profile = (await loadProfile(pool, teacher))!;
      expect(profile.versionRejectionReason).toBeNull();
      expect(profile.pendingVersion?.fullName).toBe('Wassima Corrigée');
    });

    it('needs a waiting version and an approved profile', async () => {
      const teacher = await approved();
      expect(await approveVersion(pool, admin, teacher)).toEqual({
        ok: false,
        reason: 'invalid_state',
      });
      expect(
        await rejectVersion(pool, admin, teacher, {
          reason: 'other',
          note: 'x',
        }),
      ).toEqual({
        ok: false,
        reason: 'invalid_state',
      });
      const waiting = await pending();
      expect(await approveVersion(pool, admin, waiting)).toEqual({
        ok: false,
        reason: 'invalid_state',
      });
    });

    it('refusing needs a valid reason', async () => {
      const { teacher } = await withWaitingVersion();
      expect(
        await rejectVersion(pool, admin, teacher, {
          reason: 'nope',
          note: null,
        }),
      ).toEqual({
        ok: false,
        reason: 'invalid_reason',
      });
      expect((await loadProfile(pool, teacher))!.pendingVersion).not.toBeNull();
    });
  });

  describe('suspend and restore', () => {
    it('suspends an approved profile with a written reason, and restores it', async () => {
      const teacher = await approved();
      expect(
        await suspendProfile(pool, admin, teacher, 'Signalements répétés'),
      ).toEqual({ ok: true });
      expect((await loadProfile(pool, teacher))!).toMatchObject({
        status: 'suspended',
        suspensionReason: 'Signalements répétés',
      });

      expect(await restoreProfile(pool, admin, teacher)).toEqual({ ok: true });
      expect((await loadProfile(pool, teacher))!).toMatchObject({
        status: 'approved',
        suspensionReason: null,
      });
      expect((await audit()).map((l) => l.action)).toEqual([
        'profile.approve',
        'profile.suspend',
        'profile.restore',
      ]);
    });

    it('needs a reason, and only works on the right status', async () => {
      const teacher = await approved();
      expect(await suspendProfile(pool, admin, teacher, '   ')).toEqual({
        ok: false,
        reason: 'invalid_reason',
      });
      expect(
        await suspendProfile(pool, admin, teacher, 'x'.repeat(501)),
      ).toEqual({
        ok: false,
        reason: 'invalid_reason',
      });
      expect(await restoreProfile(pool, admin, teacher)).toEqual({
        ok: false,
        reason: 'invalid_state',
      });

      const notYetApproved = await pending();
      expect(
        await suspendProfile(pool, admin, notYetApproved, 'because'),
      ).toEqual({
        ok: false,
        reason: 'invalid_state',
      });
    });
  });

  describe('the review queue', () => {
    it('lists pending profiles and waiting changes, oldest first, and nothing else', async () => {
      const draft = await createTeacher(pool);
      await edit(draft, completeInput(ids));
      const newer = await pending({}, at(minutes(20)));
      const older = await pending({}, at(minutes(5)));
      const rejected = await pending({}, at(minutes(1)));
      await rejectProfile(pool, admin, rejected, {
        reason: 'incomplete_info',
        note: null,
      });
      const live = await approved();
      const changed = await approved();
      await edit(changed, completeInput(ids, { fullName: 'Changed Name' }));

      const queue = await listReviewQueue(pool);
      const byUser = new Map(queue.map((item) => [item.userId, item]));
      expect(byUser.get(older)!.kind).toBe('profile');
      expect(byUser.get(changed)!.kind).toBe('version');
      expect([draft, rejected, live].some((id) => byUser.has(id))).toBe(false);
      expect(queue).toHaveLength(3);

      // Oldest waiting first: the one submitted at +5 min comes before the one at +20 min.
      const order = queue.map((item) => item.userId);
      expect(order.indexOf(older)).toBeLessThan(order.indexOf(newer));
    });

    it('gives the admin everything needed to decide, including the phone number', async () => {
      const teacher = await pending();
      const detail = (await loadForReview(pool, teacher))!;
      expect(detail.phone).toMatch(/^\+216/);
      expect(detail.governorateName).toBe('Sfax');
      expect(detail.zoneNames).toHaveLength(2);
      expect(detail.levelNames).toHaveLength(2);
      expect(detail.profile.fullName).toBe('Wassima Chaaben');
      expect(
        await loadForReview(pool, '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });
  });

  describe('audit trail', () => {
    it('every decision leaves one row with the actor, the target and the details', async () => {
      const a = await pending();
      const b = await pending();
      await approveProfile(pool, admin, a);
      await rejectProfile(pool, admin, b, {
        reason: 'bio_contact_info',
        note: 'Numéro dans la présentation',
      });
      const log = await audit();
      expect(log.map((l) => [l.action, l.target_id, l.actor_id])).toEqual([
        ['profile.approve', a, admin],
        ['profile.reject', b, admin],
      ]);
      expect(log[1].details).toEqual({
        reason: 'bio_contact_info',
        note: 'Numéro dans la présentation',
      });
    });

    it('a refused action leaves no audit row', async () => {
      const teacher = await approved();
      await rejectProfile(pool, admin, teacher, {
        reason: 'incomplete_info',
        note: null,
      });
      expect((await audit()).map((l) => l.action)).toEqual(['profile.approve']);
    });
  });
});
