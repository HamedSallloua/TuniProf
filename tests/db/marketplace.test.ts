import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { getPublicProfile, getSitemapData } from '@/lib/marketplace/profile';
import { parseSearchParams } from '@/lib/marketplace/search-params';
import { countLocalTeachers, searchTeachers } from '@/lib/marketplace/search';
import {
  saveProfile,
  setListed,
  submitProfile,
  type ProfileInput,
} from '@/lib/profile/repo';
import {
  approveProfile,
  rejectProfile,
  suspendProfile,
} from '@/lib/profile/review';
import { clearAuthTables } from './auth-helpers';
import { createPendingTeacher } from './billing-helpers';
import { createTestPool, testDatabaseUrl } from './helpers';
import {
  completeInput,
  createAdminUser,
  createTeacher,
  loadCatalogueIds,
  photoKey,
  type CatalogueIds,
} from './profile-helpers';

describe.skipIf(!testDatabaseUrl)('public marketplace (database)', () => {
  let pool: Pool;
  let ids: CatalogueIds;
  let admin: string;

  beforeAll(async () => {
    pool = createTestPool();
    await runMigrations(pool);
    ids = await loadCatalogueIds(pool);
  });

  beforeEach(async () => {
    await clearAuthTables(pool);
    admin = await createAdminUser(pool);
  });

  afterAll(async () => {
    await clearAuthTables(pool);
    await pool.end();
  });

  /** An approved teacher (founding year granted), visible today. */
  async function approved(
    overrides: Partial<ProfileInput> = {},
  ): Promise<{ id: string; slug: string }> {
    const id = await createTeacher(pool);
    const saved = await saveProfile(pool, id, completeInput(ids, overrides), {
      strict: true,
    });
    if (!saved.ok) throw new Error(`save failed: ${saved.error}`);
    const submitted = await submitProfile(pool, id);
    if (!submitted.ok) throw new Error(`submit failed: ${submitted.error}`);
    const result = await approveProfile(pool, admin, id);
    if (!result.ok) throw new Error(`approve failed: ${result.reason}`);
    return { id, slug: result.slug };
  }

  const search = (params: Record<string, string> = {}) =>
    searchTeachers(pool, parseSearchParams(params));
  const searchIds = async (params: Record<string, string> = {}) =>
    (await search(params)).cards.map((card) => card.userId);

  async function sitemapSlugs() {
    return (await getSitemapData(pool)).profiles.map((p) => p.slug);
  }

  // ---------------------------------------------------------------- hidden profiles

  describe('a hidden profile never appears (invariant 1)', () => {
    it('a visible profile is in search, on its page and in the sitemap', async () => {
      const teacher = await approved();
      expect(await searchIds()).toContain(teacher.id);
      expect((await getPublicProfile(pool, teacher.slug))?.userId).toBe(
        teacher.id,
      );
      expect(await sitemapSlugs()).toContain(teacher.slug);
    });

    it('never exposes a phone number', async () => {
      const teacher = await approved();
      const { rows } = await pool.query(
        'SELECT phone_e164 FROM users WHERE id = $1',
        [teacher.id],
      );
      const phone = rows[0].phone_e164 as string;
      const everything = JSON.stringify([
        await search(),
        await getPublicProfile(pool, teacher.slug),
        await getSitemapData(pool),
      ]);
      expect(everything).not.toContain(phone);
      expect(everything).not.toContain(phone.slice(4));
    });

    const breakers: [string, (id: string) => Promise<void>][] = [
      [
        'its plan expired',
        async (id) => {
          await pool.query(
            `UPDATE entitlements SET visibility_until = now() - interval '1 minute'
              WHERE teacher_id = $1`,
            [id],
          );
        },
      ],
      [
        'the teacher paused the listing',
        async (id) => {
          await setListed(pool, id, false);
        },
      ],
      [
        'an admin suspended the profile',
        async (id) => {
          const result = await suspendProfile(pool, admin, id, 'test');
          if (!result.ok) throw new Error('suspend failed');
        },
      ],
      [
        'the account is suspended',
        async (id) => {
          await pool.query(
            `UPDATE users SET status = 'suspended' WHERE id = $1`,
            [id],
          );
        },
      ],
      [
        'a required field is missing',
        async (id) => {
          await pool.query('DELETE FROM teacher_levels WHERE teacher_id = $1', [
            id,
          ]);
        },
      ],
    ];

    it.each(breakers)(
      'disappears everywhere when %s',
      async (_name, breakIt) => {
        const teacher = await approved();
        const other = await approved();
        await breakIt(teacher.id);

        const found = await searchIds();
        expect(found).not.toContain(teacher.id);
        expect(found).toContain(other.id);
        expect(await getPublicProfile(pool, teacher.slug)).toBeNull();
        expect(await sitemapSlugs()).not.toContain(teacher.slug);
        expect(await sitemapSlugs()).toContain(other.slug);
        // not even on a narrow search
        expect(await searchIds({ gouvernorat: 'sfax' })).not.toContain(
          teacher.id,
        );
      },
    );

    it('a profile waiting for review or refused is not listed', async () => {
      const pending = await createPendingTeacher(pool, ids);
      const refused = await createPendingTeacher(pool, ids);
      const rejection = await rejectProfile(pool, admin, refused, {
        reason: 'other',
        note: 'incomplete',
      });
      expect(rejection.ok).toBe(true);
      const visible = await approved();

      const found = await searchIds();
      expect(found).toEqual([visible.id]);
      expect(found).not.toContain(pending);
      expect(found).not.toContain(refused);
      expect((await getSitemapData(pool)).profiles).toHaveLength(1);
    });

    it('a profile with an unknown address has no page', async () => {
      await approved();
      expect(await getPublicProfile(pool, 'nobody-nowhere')).toBeNull();
    });

    it('keeps the old version live while a change waits for review', async () => {
      const teacher = await approved();
      const saved = await saveProfile(
        pool,
        teacher.id,
        completeInput(ids, { fullName: 'Nouveau Nom' }),
        { strict: true },
      );
      expect(saved.ok).toBe(true);
      expect((await getPublicProfile(pool, teacher.slug))?.fullName).toBe(
        'Wassima Chaaben',
      );
    });
  });

  // ---------------------------------------------------------------- filters

  describe('filters (spec 3.2)', () => {
    async function setUpTeachers() {
      const sfax = ids.sfax.delegations;
      const tunis = ids.tunis.delegations;
      const a = await approved({
        governorateId: ids.sfax.id,
        modes: ['at_home'],
        zoneIds: [sfax[0], sfax[1]],
        levelIds: [ids.levels[0]],
        subjects: [{ subjectId: ids.subjects[0], rateMillimes: 25000 }],
      });
      const b = await approved({
        governorateId: ids.tunis.id,
        modes: ['online'],
        zoneIds: [],
        levelIds: [ids.levels[1]],
        subjects: [{ subjectId: ids.subjects[1], rateMillimes: 10000 }],
      });
      const c = await approved({
        governorateId: ids.tunis.id,
        modes: ['at_home', 'at_teacher'],
        zoneIds: [tunis[0]],
        levelIds: [ids.levels[2]],
        subjects: [
          { subjectId: ids.subjects[0], rateMillimes: 40000 },
          { subjectId: ids.subjects[2], rateMillimes: 15000 },
        ],
      });
      return { a: a.id, b: b.id, c: c.id };
    }

    async function slugOf(table: 'levels' | 'subjects', id: string) {
      const { rows } = await pool.query(
        `SELECT slug FROM ${table} WHERE id = $1`,
        [id],
      );
      return rows[0].slug as string;
    }

    it('without filters, lists every visible teacher', async () => {
      const t = await setUpTeachers();
      expect((await searchIds()).sort()).toEqual([t.a, t.b, t.c].sort());
    });

    it('a governorate shows its teachers plus the online ones from anywhere', async () => {
      const t = await setUpTeachers();
      expect((await searchIds({ gouvernorat: 'sfax' })).sort()).toEqual(
        [t.a, t.b].sort(),
      );
      expect((await searchIds({ gouvernorat: 'tunis' })).sort()).toEqual(
        [t.b, t.c].sort(),
      );
    });

    it('asking for another mode removes the online-everywhere rule', async () => {
      const t = await setUpTeachers();
      expect(
        await searchIds({ gouvernorat: 'sfax', mode: 'domicile' }),
      ).toEqual([t.a]);
      expect(
        (await searchIds({ gouvernorat: 'sfax', mode: 'en-ligne' })).sort(),
      ).toEqual([t.b]);
      expect(await searchIds({ mode: 'professeur' })).toEqual([t.c]);
    });

    it('a délégation shows the teachers covering it, plus online ones', async () => {
      const t = await setUpTeachers();
      const { rows } = await pool.query(
        'SELECT slug FROM delegations WHERE id = ANY($1) ORDER BY name_fr',
        [[ids.sfax.delegations[0], ids.sfax.delegations[2]]],
      );
      const covered = await pool.query(
        'SELECT slug FROM delegations WHERE id = $1',
        [ids.sfax.delegations[0]],
      );
      const notCovered = await pool.query(
        'SELECT slug FROM delegations WHERE id = $1',
        [ids.sfax.delegations[2]],
      );
      expect(rows).toHaveLength(2);
      expect(
        (
          await searchIds({
            gouvernorat: 'sfax',
            delegation: covered.rows[0].slug,
          })
        ).sort(),
      ).toEqual([t.a, t.b].sort());
      expect(
        await searchIds({
          gouvernorat: 'sfax',
          delegation: notCovered.rows[0].slug,
        }),
      ).toEqual([t.b]);
    });

    it('filters by level and subject', async () => {
      const t = await setUpTeachers();
      expect(
        await searchIds({ niveau: await slugOf('levels', ids.levels[2]) }),
      ).toEqual([t.c]);
      expect(
        (
          await searchIds({
            matiere: await slugOf('subjects', ids.subjects[0]),
          })
        ).sort(),
      ).toEqual([t.a, t.c].sort());
      expect(
        await searchIds({ matiere: await slugOf('subjects', ids.subjects[1]) }),
      ).toEqual([t.b]);
    });

    it('ignores an unknown slug like any other bad value', async () => {
      const t = await setUpTeachers();
      expect((await searchIds({ matiere: 'does-not-exist' })).sort()).toEqual(
        [t.a, t.b, t.c].sort(),
      );
    });

    it('filters by price, on the rate of the subject asked for', async () => {
      const t = await setUpTeachers();
      const first = await slugOf('subjects', ids.subjects[0]);
      // some subject of the teacher costs 30 DT or more: only C (40 DT)
      expect(await searchIds({ prix_min: '30' })).toEqual([t.c]);
      // the subject asked for costs at most 30 DT: A (25 DT), not C (40 DT)
      expect(await searchIds({ matiere: first, prix_max: '30' })).toEqual([
        t.a,
      ]);
      expect(
        (
          await searchIds({ matiere: first, prix_min: '20', prix_max: '45' })
        ).sort(),
      ).toEqual([t.a, t.c].sort());
    });

    it('shows "à partir de" as the lowest rate among the matching subjects', async () => {
      const t = await setUpTeachers();
      const cardOf = async (params: Record<string, string>) =>
        (await search(params)).cards.find((card) => card.userId === t.c)!;
      expect((await cardOf({})).fromRateMillimes).toBe(15000);
      expect(
        (await cardOf({ matiere: await slugOf('subjects', ids.subjects[0]) }))
          .fromRateMillimes,
      ).toBe(40000);
    });

    it('filters by minimum rating, counting only reviewed teachers', async () => {
      const t = await setUpTeachers();
      await pool.query(
        'UPDATE teacher_profiles SET rating_avg = 4.5, rating_count = 3 WHERE user_id = $1',
        [t.a],
      );
      await pool.query(
        'UPDATE teacher_profiles SET rating_avg = 3, rating_count = 10 WHERE user_id = $1',
        [t.b],
      );
      expect(await searchIds({ note: '4' })).toEqual([t.a]);
      expect((await searchIds({ note: '3' })).sort()).toEqual(
        [t.a, t.b].sort(),
      );
    });

    it('sorts by price, ascending and descending', async () => {
      const t = await setUpTeachers();
      expect(await searchIds({ tri: 'prix-asc' })).toEqual([t.b, t.c, t.a]);
      expect(await searchIds({ tri: 'prix-desc' })).toEqual([t.a, t.c, t.b]);
    });

    it('sorts the best rated first, then the newest', async () => {
      const t = await setUpTeachers();
      await pool.query(
        'UPDATE teacher_profiles SET rating_avg = 5, rating_count = 4 WHERE user_id = $1',
        [t.c],
      );
      await pool.query(
        'UPDATE teacher_profiles SET rating_avg = 3, rating_count = 4 WHERE user_id = $1',
        [t.a],
      );
      const best = await searchIds({ tri: 'mieux-notes' });
      expect(best.slice(0, 2)).toEqual([t.c, t.a]);

      await pool.query(
        `UPDATE teacher_profiles SET approved_at = now() + interval '1 day' WHERE user_id = $1`,
        [t.b],
      );
      expect((await searchIds({ tri: 'recents' }))[0]).toBe(t.b);
    });

    it('builds complete cards without a phone number', async () => {
      const t = await setUpTeachers();
      await pool.query(
        'UPDATE teacher_profiles SET photo_key = $2 WHERE user_id = $1',
        [t.a, photoKey()],
      );
      const card = (await search({ gouvernorat: 'sfax', mode: 'domicile' }))
        .cards[0];
      expect(card.userId).toBe(t.a);
      expect(card.fullName).toBe('Wassima Chaaben');
      expect(card.slug).toMatch(/^wassima-chaaben/);
      expect(card.photoKey).toMatch(/^photos\//);
      expect(card.governorate.slug).toBe('sfax');
      expect(card.zones).toHaveLength(2);
      expect(card.subjects).toHaveLength(1);
      expect(card.levels).toHaveLength(1);
      expect(card.modes).toEqual(['at_home']);
      expect(Object.keys(card)).not.toContain('phone');
    });

    it('counts the teachers living in a governorate for a subject (landing pages)', async () => {
      await setUpTeachers();
      expect(
        await countLocalTeachers(pool, ids.tunis.id, ids.subjects[0]),
      ).toBe(1);
      // Online teachers elsewhere do not count as local.
      expect(await countLocalTeachers(pool, ids.sfax.id, ids.subjects[1])).toBe(
        0,
      );
    });

    it('lists landing pages in the sitemap only where a teacher lives', async () => {
      await setUpTeachers();
      const { landings } = await getSitemapData(pool);
      const subject0 = await slugOf('subjects', ids.subjects[0]);
      const subject1 = await slugOf('subjects', ids.subjects[1]);
      expect(landings).toContainEqual({
        governorate: 'sfax',
        subject: subject0,
      });
      expect(landings).toContainEqual({
        governorate: 'tunis',
        subject: subject1,
      });
      expect(landings).not.toContainEqual({
        governorate: 'sfax',
        subject: subject1,
      });
    });
  });

  // ---------------------------------------------------------------- pages of results

  describe('pagination', () => {
    it('shows 20 results per page and clamps a page that does not exist', async () => {
      for (let i = 0; i < 21; i++) await approved();
      const first = await search();
      expect(first.total).toBe(21);
      expect(first.pageCount).toBe(2);
      expect(first.cards).toHaveLength(20);

      const second = await search({ page: '2' });
      expect(second.cards).toHaveLength(1);
      const all = new Set(
        [...first.cards, ...second.cards].map((c) => c.userId),
      );
      expect(all.size).toBe(21); // no teacher twice, none missing

      const beyond = await search({ page: '99' });
      expect(beyond.page).toBe(2);
      expect(beyond.cards).toHaveLength(1);
    });

    it('returns an empty page when nothing matches', async () => {
      const result = await search({ gouvernorat: 'sfax' });
      expect(result).toEqual({ cards: [], total: 0, page: 1, pageCount: 1 });
    });
  });
});
