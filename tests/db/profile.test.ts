import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { getFormCatalogue, getRateRange } from '@/lib/profile/catalogue';
import {
  getOrCreateProfile,
  loadProfile,
  saveProfile,
  setListed,
  submitProfile,
  type ProfileInput,
} from '@/lib/profile/repo';
import { approveProfile } from '@/lib/profile/review';
import {
  isProfileComplete,
  listMissingFields,
  type ProfileSnapshot,
} from '@/lib/profile/rules';
import { clearAuthTables } from './auth-helpers';
import {
  completeInput,
  createAdminUser,
  createTeacher,
  loadCatalogueIds,
  type CatalogueIds,
} from './profile-helpers';
import {
  CHECK_VIOLATION,
  createTestPool,
  FOREIGN_KEY_VIOLATION,
  testDatabaseUrl,
  UNIQUE_VIOLATION,
} from './helpers';

describe.skipIf(!testDatabaseUrl)('teacher profiles (database)', () => {
  let pool: Pool;
  let ids: CatalogueIds;

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
  });

  const save = (teacher: string, input: ProfileInput, strict = true) =>
    saveProfile(pool, teacher, input, { strict });

  async function savedOk(teacher: string, input: ProfileInput, strict = true) {
    const result = await save(teacher, input, strict);
    if (!result.ok) throw new Error(`save failed: ${result.error}`);
    return result;
  }

  async function pendingProfile(overrides: Partial<ProfileInput> = {}) {
    const teacher = await createTeacher(pool);
    await savedOk(teacher, completeInput(ids, overrides));
    expect(await submitProfile(pool, teacher)).toEqual({ ok: true });
    return teacher;
  }

  async function approvedProfile(overrides: Partial<ProfileInput> = {}) {
    const teacher = await pendingProfile(overrides);
    const admin = await createAdminUser(pool);
    const result = await approveProfile(pool, admin, teacher);
    if (!result.ok) throw new Error(`approve failed: ${result.reason}`);
    return { teacher, admin, slug: result.slug };
  }

  describe('structure enforced by the database', () => {
    const insertProfile = (userId: string, set = '') =>
      pool.query(`INSERT INTO teacher_profiles (user_id) VALUES ($1)${set}`, [
        userId,
      ]);

    it('only a teacher account can own a profile', async () => {
      const admin = await createAdminUser(pool);
      await expect(insertProfile(admin)).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
      await pool.query(
        `INSERT INTO users (role, phone_e164, status, phone_verified_at)
         VALUES ('visitor', '+21640000999', 'active', now())`,
      );
      const { rows } = await pool.query(
        "SELECT id FROM users WHERE role = 'visitor'",
      );
      await expect(insertProfile(rows[0].id)).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
    });

    it('refuses values outside the allowed lists and lengths', async () => {
      const teacher = await createTeacher(pool);
      await insertProfile(teacher);
      const bad: [string, unknown][] = [
        ['diploma', 'wizard'],
        ['experience', '20_years'],
        ['status', 'published'],
        ['full_name', 'A'],
        ['full_name', 'x'.repeat(61)],
        ['bio', 'too short'],
        ['bio', 'x'.repeat(601)],
        ['photo_key', 'https://evil.example/x.jpg'],
        ['photo_key', 'photos/../../secret.jpg'],
        ['slug', 'Not A Slug'],
        ['rating_avg', 6],
      ];
      for (const [column, value] of bad) {
        await expect(
          pool.query(
            `UPDATE teacher_profiles SET ${column} = $2 WHERE user_id = $1`,
            [teacher, value],
          ),
          column,
        ).rejects.toMatchObject({ code: CHECK_VIOLATION });
      }
      await expect(
        pool.query(
          "UPDATE teacher_profiles SET modes = ARRAY['teleport'] WHERE user_id = $1",
          [teacher],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('a zone must be a délégation of the profile’s governorate', async () => {
      const teacher = await createTeacher(pool);
      await insertProfile(teacher);
      await pool.query(
        'UPDATE teacher_profiles SET governorate_id = $2 WHERE user_id = $1',
        [teacher, ids.sfax.id],
      );

      // A délégation of Tunis in a Sfax profile: refused, whatever the app does.
      await expect(
        pool.query(
          'INSERT INTO teacher_zones (teacher_id, governorate_id, delegation_id) VALUES ($1, $2, $3)',
          [teacher, ids.sfax.id, ids.tunis.delegations[0]],
        ),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
      // Claiming the wrong governorate on the zone row is refused too.
      await expect(
        pool.query(
          'INSERT INTO teacher_zones (teacher_id, governorate_id, delegation_id) VALUES ($1, $2, $3)',
          [teacher, ids.tunis.id, ids.tunis.delegations[0]],
        ),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
      // The right one works.
      await pool.query(
        'INSERT INTO teacher_zones (teacher_id, governorate_id, delegation_id) VALUES ($1, $2, $3)',
        [teacher, ids.sfax.id, ids.sfax.delegations[0]],
      );
    });

    it('the governorate cannot change while zones of the old one exist', async () => {
      const teacher = await createTeacher(pool);
      await savedOk(teacher, completeInput(ids));
      await expect(
        pool.query(
          'UPDATE teacher_profiles SET governorate_id = $2 WHERE user_id = $1',
          [teacher, ids.tunis.id],
        ),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });

    it('refuses a zero or negative hourly rate, and the same subject twice', async () => {
      const teacher = await createTeacher(pool);
      await insertProfile(teacher);
      const add = (rate: number) =>
        pool.query(
          'INSERT INTO teacher_subjects (teacher_id, subject_id, hourly_rate_millimes) VALUES ($1, $2, $3)',
          [teacher, ids.subjects[0], rate],
        );
      await expect(add(0)).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await expect(add(-5000)).rejects.toMatchObject({ code: CHECK_VIOLATION });
      await add(20000);
      await expect(add(30000)).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
    });

    it('a slug is unique', async () => {
      const [a, b] = [await createTeacher(pool), await createTeacher(pool)];
      await insertProfile(a, '');
      await insertProfile(b, '');
      await pool.query(
        "UPDATE teacher_profiles SET slug = 'same-slug' WHERE user_id = $1",
        [a],
      );
      await expect(
        pool.query(
          "UPDATE teacher_profiles SET slug = 'same-slug' WHERE user_id = $1",
          [b],
        ),
      ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it('deleting the account deletes the profile and everything on it', async () => {
      const teacher = await createTeacher(pool);
      await savedOk(teacher, completeInput(ids));
      await pool.query('DELETE FROM users WHERE id = $1', [teacher]);
      for (const table of [
        'teacher_profiles',
        'teacher_levels',
        'teacher_zones',
        'teacher_subjects',
      ]) {
        const { rows } = await pool.query(
          `SELECT count(*)::int AS n FROM ${table}`,
        );
        expect(rows[0].n, table).toBe(0);
      }
    });
  });

  describe('"all required fields are complete" (one rule, in the database)', () => {
    const forceStatus = (teacher: string, status: string) =>
      pool.query('UPDATE teacher_profiles SET status = $2 WHERE user_id = $1', [
        teacher,
        status,
      ]);

    it('refuses pending or approved for an empty profile, even by direct SQL', async () => {
      const teacher = await createTeacher(pool);
      await getOrCreateProfile(pool, teacher);
      await expect(forceStatus(teacher, 'pending')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(forceStatus(teacher, 'approved')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(
        pool.query(
          "INSERT INTO teacher_profiles (user_id, status) VALUES ($1, 'pending')",
          [await createTeacher(pool)],
        ),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('refuses each missing piece, one at a time', async () => {
      const teacher = await createTeacher(pool);
      const attempts: [string, Partial<ProfileInput>][] = [
        ['no name', { fullName: null }],
        ['no diploma', { diploma: null }],
        ['no experience', { experience: null }],
        ['no bio', { bio: null }],
        ['no governorate', { governorateId: null, zoneIds: [] }],
        ['no mode', { modes: [] }],
        ['no level', { levelIds: [] }],
        ['no subject', { subjects: [] }],
        ['at home but no zone', { modes: ['at_home'], zoneIds: [] }],
        [
          'at the teacher’s but no zone',
          { modes: ['at_teacher'], zoneIds: [] },
        ],
        [
          'online and at home but no zone',
          { modes: ['online', 'at_home'], zoneIds: [] },
        ],
      ];
      for (const [label, overrides] of attempts) {
        await savedOk(teacher, completeInput(ids, overrides), false);
        expect(await submitProfile(pool, teacher), label).toEqual({
          ok: false,
          error: 'incomplete',
        });
      }
    });

    it('zones are not needed when the only mode is online', async () => {
      const teacher = await createTeacher(pool);
      await savedOk(
        teacher,
        completeInput(ids, { modes: ['online'], zoneIds: [] }),
      );
      expect(await submitProfile(pool, teacher)).toEqual({ ok: true });
    });

    it('needs a verified phone number', async () => {
      const teacher = await createTeacher(pool, { verified: false });
      await savedOk(teacher, completeInput(ids), false);
      expect(await submitProfile(pool, teacher)).toEqual({
        ok: false,
        error: 'incomplete',
      });
    });

    it('the TypeScript list of missing fields agrees with the SQL function on every combination', async () => {
      const teacher = await createTeacher(pool);
      await getOrCreateProfile(pool, teacher);
      const pieces = [
        'name',
        'diploma',
        'experience',
        'bio',
        'governorate',
        'modes',
        'levels',
        'subjects',
        'zones',
      ] as const;
      // 2^9 = 512 combinations of present/absent pieces, plus 3 mode choices.
      for (const modeSet of [
        ['at_home'],
        ['online'],
        ['online', 'at_teacher'],
      ] as const) {
        for (let mask = 0; mask < 1 << pieces.length; mask++) {
          const has = (piece: (typeof pieces)[number]) =>
            (mask & (1 << pieces.indexOf(piece))) !== 0;
          const input = completeInput(ids, {
            fullName: has('name') ? 'Sarah' : null,
            diploma: has('diploma') ? 'student' : null,
            experience: has('experience') ? '1_3' : null,
            bio: has('bio') ? 'x'.repeat(40) : null,
            governorateId: has('governorate') ? ids.sfax.id : null,
            modes: has('modes') ? [...modeSet] : [],
            levelIds: has('levels') ? [ids.levels[0]] : [],
            subjects: has('subjects')
              ? [{ subjectId: ids.subjects[0], rateMillimes: 10000 }]
              : [],
            zoneIds:
              has('zones') && has('governorate')
                ? [ids.sfax.delegations[0]]
                : [],
          });
          await savedOk(teacher, input, false);
          const profile = (await loadProfile(pool, teacher))!;
          const snapshot: ProfileSnapshot = {
            fullName: profile.fullName,
            diploma: profile.diploma,
            experience: profile.experience,
            bio: profile.bio,
            governorateId: profile.governorateId,
            modes: profile.modes,
            levelCount: profile.levelIds.length,
            subjectCount: profile.subjects.length,
            zoneCount: profile.zoneIds.length,
            phoneVerified: profile.phoneVerified,
          };
          const { rows } = await pool.query(
            'SELECT profile_is_complete($1) AS ok',
            [teacher],
          );
          expect(
            isProfileComplete(snapshot),
            `mask ${mask} ${modeSet}: ${listMissingFields(snapshot)}`,
          ).toBe(rows[0].ok);
        }
      }
    }, 120_000);
  });

  describe('draft, submit and review', () => {
    it('saves an incomplete draft without complaint, and loads it back', async () => {
      const teacher = await createTeacher(pool);
      const { profile } = await savedOk(
        teacher,
        completeInput(ids, {
          bio: null,
          levelIds: [],
          subjects: [],
          zoneIds: [],
        }),
        false,
      );
      expect(profile.status).toBe('draft');
      expect(profile.fullName).toBe('Wassima Chaaben');
      expect(profile.bio).toBeNull();
      expect(profile.modes).toEqual(['at_home', 'online']);
    });

    it('a strict save refuses an incomplete result and changes nothing', async () => {
      const teacher = await createTeacher(pool);
      await savedOk(teacher, completeInput(ids), false);
      const result = await save(
        teacher,
        completeInput(ids, { fullName: 'Someone Else', levelIds: [] }),
        true,
      );
      expect(result).toEqual({ ok: false, error: 'incomplete' });
      expect((await loadProfile(pool, teacher))!.fullName).toBe(
        'Wassima Chaaben',
      );
      expect((await loadProfile(pool, teacher))!.levelIds).toHaveLength(2);
    });

    it('submit: draft -> pending, once', async () => {
      const teacher = await createTeacher(pool);
      await savedOk(teacher, completeInput(ids));
      expect(await submitProfile(pool, teacher)).toEqual({ ok: true });
      const profile = (await loadProfile(pool, teacher))!;
      expect(profile.status).toBe('pending');
      expect(profile.submittedAt).not.toBeNull();
      expect(await submitProfile(pool, teacher)).toEqual({
        ok: false,
        error: 'invalid_state',
      });
    });

    it('a pending profile can still be edited by its owner (it is not public yet)', async () => {
      const teacher = await pendingProfile();
      const { profile } = await savedOk(
        teacher,
        completeInput(ids, { fullName: 'Wassima B.' }),
      );
      expect(profile.status).toBe('pending');
      expect(profile.fullName).toBe('Wassima B.');
      expect(profile.pendingVersion).toBeNull();
    });

    it('approve creates the public address /prof/{slug} from name, first subject and governorate', async () => {
      const { teacher, slug } = await approvedProfile();
      const { rows } = await pool.query(
        'SELECT name_fr FROM subjects WHERE id = $1',
        [ids.subjects[0]],
      );
      expect(slug).toBe(
        `wassima-chaaben-${rows[0].name_fr
          .toLowerCase()
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .replace(/[^a-z0-9]+/g, '-')}-sfax`,
      );
      const profile = (await loadProfile(pool, teacher))!;
      expect(profile).toMatchObject({ status: 'approved', slug });
      expect(profile.approvedAt).not.toBeNull();
    });

    it('two teachers with the same name, subject and city get different addresses', async () => {
      const first = await approvedProfile();
      const second = await approvedProfile();
      expect(second.slug).toBe(`${first.slug}-2`);
    });

    it('the address never changes afterwards, even if the name does', async () => {
      const { teacher, admin, slug } = await approvedProfile();
      await savedOk(
        teacher,
        completeInput(ids, { fullName: 'Wassima Ben Salah' }),
      );
      const { approveVersion } = await import('@/lib/profile/review');
      expect((await approveVersion(pool, admin, teacher)).ok).toBe(true);
      const profile = (await loadProfile(pool, teacher))!;
      expect(profile.fullName).toBe('Wassima Ben Salah');
      expect(profile.slug).toBe(slug);
    });

    it('an incomplete pending profile can never be approved, even if the data was damaged afterwards', async () => {
      const teacher = await pendingProfile();
      await pool.query('DELETE FROM teacher_levels WHERE teacher_id = $1', [
        teacher,
      ]);
      const admin = await createAdminUser(pool);
      expect(await approveProfile(pool, admin, teacher)).toEqual({
        ok: false,
        reason: 'incomplete',
      });
      expect((await loadProfile(pool, teacher))!.status).toBe('pending');
    });
  });

  describe('changing the governorate', () => {
    it('removes the old zones and accepts zones of the new governorate', async () => {
      const teacher = await createTeacher(pool);
      await savedOk(teacher, completeInput(ids));
      const { profile } = await savedOk(
        teacher,
        completeInput(ids, {
          governorateId: ids.tunis.id,
          zoneIds: [ids.tunis.delegations[0]],
        }),
      );
      expect(profile.governorateId).toBe(ids.tunis.id);
      expect(profile.zoneIds).toEqual([ids.tunis.delegations[0]]);
    });

    it('refuses zones that are not in the chosen governorate', async () => {
      const teacher = await createTeacher(pool);
      const result = await save(
        teacher,
        completeInput(ids, {
          governorateId: ids.sfax.id,
          zoneIds: [ids.tunis.delegations[0]],
        }),
      );
      expect(result).toEqual({ ok: false, error: 'invalidSelection' });
      // nothing was half-saved
      expect((await loadProfile(pool, teacher))?.fullName ?? null).toBeNull();
    });

    it('refuses ids that do not exist', async () => {
      const teacher = await createTeacher(pool);
      const bogus = '00000000-0000-0000-0000-000000000000';
      expect(
        await save(teacher, completeInput(ids, { levelIds: [bogus] })),
      ).toEqual({
        ok: false,
        error: 'invalidSelection',
      });
      expect(
        await save(
          teacher,
          completeInput(ids, {
            subjects: [{ subjectId: bogus, rateMillimes: 10000 }],
          }),
        ),
      ).toEqual({ ok: false, error: 'invalidSelection' });
    });
  });

  describe('"Autre": a subject typed by the teacher', () => {
    const withCustom = (name: string, rate = 15000) =>
      completeInput(ids, {
        subjects: [
          { subjectId: ids.subjects[0], rateMillimes: 20000 },
          { customName: name, rateMillimes: rate },
        ],
      });

    it('creates a pending subject owned by the teacher, hidden from the public catalogue', async () => {
      const teacher = await createTeacher(pool);
      const { profile } = await savedOk(teacher, withCustom('Calcul mental'));
      const custom = profile.subjects.find((s) => s.status === 'pending');
      expect(custom).toMatchObject({
        nameFr: 'Calcul mental',
        rateMillimes: 15000,
      });

      const { rows } = await pool.query(
        'SELECT status, suggested_by FROM subjects WHERE name_fr = $1',
        ['Calcul mental'],
      );
      expect(rows).toEqual([{ status: 'pending', suggested_by: teacher }]);

      const catalogue = await getFormCatalogue(pool);
      expect(catalogue.subjects.some((s) => s.nameFr === 'Calcul mental')).toBe(
        false,
      );
    });

    it('reuses a subject that already exists, whatever the letter case', async () => {
      const teacher = await createTeacher(pool);
      const { rows } = await pool.query(
        'SELECT name_fr FROM subjects WHERE id = $1',
        [ids.subjects[1]],
      );
      const { profile } = await savedOk(
        teacher,
        completeInput(ids, {
          subjects: [
            { customName: rows[0].name_fr.toUpperCase(), rateMillimes: 12000 },
          ],
        }),
      );
      expect(profile.subjects.map((s) => s.subjectId)).toEqual([
        ids.subjects[1],
      ]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM subjects WHERE status = 'pending'",
          )
        ).rows[0].n,
      ).toBe(0);
    });

    it('the same name typed again does not create a duplicate', async () => {
      const [a, b] = [await createTeacher(pool), await createTeacher(pool)];
      await savedOk(a, withCustom('Calcul mental'));
      await savedOk(b, withCustom('calcul MENTAL'));
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM subjects WHERE status = 'pending'",
          )
        ).rows[0].n,
      ).toBe(1);
    });

    it('at most 3 custom subjects per teacher', async () => {
      const teacher = await createTeacher(pool);
      const rows = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((customName) => ({
        customName,
        rateMillimes: 10000,
      }));
      expect(
        await save(teacher, completeInput(ids, { subjects: rows.slice(0, 3) })),
      ).toMatchObject({ ok: true });
      expect(
        await save(teacher, completeInput(ids, { subjects: rows })),
      ).toEqual({
        ok: false,
        error: 'tooManyCustomSubjects',
      });
    });

    it('works with an Arabic name', async () => {
      const teacher = await createTeacher(pool);
      const { profile } = await savedOk(teacher, withCustom('الخط العربي'));
      expect(profile.subjects.some((s) => s.nameFr === 'الخط العربي')).toBe(
        true,
      );
    });
  });

  describe('hourly rate range comes from the settings', () => {
    it('is 5 to 300 DT by default', async () => {
      expect(await getRateRange(pool)).toEqual({ min: 5000, max: 300000 });
    });

    it('follows a change in the settings, and falls back when a setting is broken', async () => {
      try {
        await pool.query(
          "UPDATE settings SET value = '8000' WHERE key = 'profile.rate_min_millimes'",
        );
        await pool.query(
          "UPDATE settings SET value = '\"oops\"' WHERE key = 'profile.rate_max_millimes'",
        );
        expect(await getRateRange(pool)).toEqual({ min: 8000, max: 300000 });
      } finally {
        await pool.query(
          "UPDATE settings SET value = '5000' WHERE key = 'profile.rate_min_millimes'",
        );
        await pool.query(
          "UPDATE settings SET value = '300000' WHERE key = 'profile.rate_max_millimes'",
        );
      }
    });
  });

  describe('suspended profiles and the listing switch', () => {
    it('the owner can pause and resume the public listing', async () => {
      const { teacher } = await approvedProfile();
      expect(await setListed(pool, teacher, false)).toBe(true);
      expect((await loadProfile(pool, teacher))!.isListed).toBe(false);
      expect(await setListed(pool, teacher, true)).toBe(true);
      expect((await loadProfile(pool, teacher))!.isListed).toBe(true);
    });

    it('a suspended profile cannot be edited or re-listed by its owner', async () => {
      const { teacher } = await approvedProfile();
      await pool.query("UPDATE teacher_profiles SET status = 'suspended'");
      expect(
        await save(teacher, completeInput(ids, { fullName: 'New Name' })),
      ).toEqual({
        ok: false,
        error: 'suspended',
      });
      expect(await setListed(pool, teacher, false)).toBe(false);
      expect(await submitProfile(pool, teacher)).toEqual({
        ok: false,
        error: 'suspended',
      });
      expect((await loadProfile(pool, teacher))!.fullName).toBe(
        'Wassima Chaaben',
      );
    });
  });

  describe('teachers only ever touch their own rows (invariant 16)', () => {
    it('saving, submitting and listing for teacher A leave teacher B untouched', async () => {
      const a = await createTeacher(pool);
      const b = await createTeacher(pool);
      await savedOk(
        b,
        completeInput(ids, {
          fullName: 'Teacher Bee',
          subjects: [{ subjectId: ids.subjects[1], rateMillimes: 33000 }],
        }),
      );
      const before = JSON.stringify(await loadProfile(pool, b));

      await savedOk(a, completeInput(ids, { fullName: 'Teacher Ay' }));
      await submitProfile(pool, a);
      await setListed(pool, a, false);
      await save(
        a,
        completeInput(ids, {
          fullName: 'Teacher Ay Again',
          levelIds: [ids.levels[2]],
        }),
      );

      expect(JSON.stringify(await loadProfile(pool, b))).toBe(before);
      expect((await loadProfile(pool, a))!.fullName).toBe('Teacher Ay Again');
    });

    it('the same zone, level and subject ids can be used by two teachers without mixing', async () => {
      const a = await createTeacher(pool);
      const b = await createTeacher(pool);
      await savedOk(a, completeInput(ids));
      await savedOk(
        b,
        completeInput(ids, {
          subjects: [{ subjectId: ids.subjects[0], rateMillimes: 99000 }],
        }),
      );
      expect((await loadProfile(pool, a))!.subjects[0].rateMillimes).toBe(
        25000,
      );
      expect((await loadProfile(pool, b))!.subjects[0].rateMillimes).toBe(
        99000,
      );
    });

    it('a teacher id that has no profile gives nothing, not someone else’s data', async () => {
      await approvedProfile();
      expect(
        await loadProfile(pool, '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });
  });
});
