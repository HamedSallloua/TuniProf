import { describe, expect, it } from 'vitest';
import { summarizeLevels } from '@/lib/marketplace/levels';
import {
  completenessScore,
  rankTeachers,
  ratingScore,
  recencyScore,
  relevanceScore,
  rotationSeed,
  rotationValue,
  type RankInput,
} from '@/lib/marketplace/ranking';
import {
  buildSearchQuery,
  parseDinarsToMillimes,
  parseSearchParams,
  type Sort,
} from '@/lib/marketplace/search-params';
import { alternatesFor, pageUrl } from '@/lib/site-url';

const NOW = new Date('2026-10-27T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function teacher(id: string, overrides: Partial<RankInput> = {}): RankInput {
  return {
    userId: id,
    hasPhoto: true,
    bioLength: 250,
    subjectCount: 2,
    ratingAvg: 0,
    ratingCount: 0,
    lastRenewedAt: NOW,
    approvedAt: NOW,
    fromRateMillimes: 20000,
    ...overrides,
  };
}

describe('search parameters', () => {
  it('reads a full address', () => {
    const filters = parseSearchParams({
      gouvernorat: 'sfax',
      delegation: 'sfax-ville',
      niveau: 'secondaire-4',
      matiere: 'physique',
      mode: 'domicile',
      prix_min: '15',
      prix_max: '40,5',
      note: '4',
      tri: 'prix-asc',
      page: '3',
    });
    expect(filters).toEqual({
      governorate: 'sfax',
      delegation: 'sfax-ville',
      level: 'secondaire-4',
      subject: 'physique',
      mode: 'at_home',
      minRateMillimes: 15000,
      maxRateMillimes: 40500,
      minRating: 4,
      sort: 'prix-asc',
      page: 3,
    });
  });

  it('ignores invalid values instead of failing', () => {
    const filters = parseSearchParams({
      gouvernorat: 'Sfax; DROP TABLE',
      matiere: ['physique', 'chimie'],
      mode: 'teleportation',
      prix_min: 'abc',
      prix_max: '-5',
      note: '9',
      tri: 'hack',
      page: '-2',
    });
    expect(filters.governorate).toBeUndefined();
    expect(filters.subject).toBe('physique'); // the first value wins
    expect(filters.mode).toBeUndefined();
    expect(filters.minRateMillimes).toBeUndefined();
    expect(filters.maxRateMillimes).toBeUndefined();
    expect(filters.minRating).toBeUndefined();
    expect(filters.sort).toBe('pertinence');
    expect(filters.page).toBe(1);
  });

  it('ignores a délégation without its governorate', () => {
    expect(parseSearchParams({ delegation: 'sfax-ville' }).delegation).toBe(
      undefined,
    );
  });

  it('swaps a price range typed the wrong way round', () => {
    const filters = parseSearchParams({ prix_min: '50', prix_max: '20' });
    expect(filters.minRateMillimes).toBe(20000);
    expect(filters.maxRateMillimes).toBe(50000);
  });

  it('converts dinars to integer millimes', () => {
    expect(parseDinarsToMillimes('25')).toBe(25000);
    expect(parseDinarsToMillimes('25,5')).toBe(25500);
    expect(parseDinarsToMillimes('25.125')).toBe(25125);
    expect(parseDinarsToMillimes('25.1256')).toBeUndefined();
    expect(parseDinarsToMillimes('')).toBeUndefined();
    expect(parseDinarsToMillimes('1e3')).toBeUndefined();
  });

  it('writes an address back without the defaults, and reads it again', () => {
    const filters = parseSearchParams({
      gouvernorat: 'tunis',
      matiere: 'anglais',
      prix_max: '30',
      page: '2',
    });
    const query = buildSearchQuery(filters);
    expect(query).toBe('?gouvernorat=tunis&matiere=anglais&prix_max=30&page=2');
    expect(buildSearchQuery(parseSearchParams({}))).toBe('');
    const params = Object.fromEntries(new URLSearchParams(query));
    expect(parseSearchParams(params)).toEqual(filters);
  });
});

describe('ranking', () => {
  it('rewards a photo, a long bio and several subjects', () => {
    expect(completenessScore(teacher('a'))).toBe(1);
    expect(
      completenessScore(
        teacher('a', { hasPhoto: false, bioLength: 100, subjectCount: 1 }),
      ),
    ).toBe(0);
  });

  it('damps the rating of teachers with few reviews', () => {
    const newcomer = ratingScore(0, 0);
    const oneFive = ratingScore(5, 1);
    const manyFives = ratingScore(5, 50);
    const manyBad = ratingScore(2, 50);
    expect(oneFive).toBeLessThan(manyFives);
    expect(newcomer).toBeLessThan(manyFives);
    expect(manyBad).toBeLessThan(newcomer);
  });

  it('lowers the recency score over a year', () => {
    expect(recencyScore(NOW, NOW)).toBe(1);
    expect(recencyScore(new Date(NOW.getTime() - 365 * DAY), NOW)).toBe(0);
    expect(recencyScore(new Date(NOW.getTime() - 800 * DAY), NOW)).toBe(0);
    expect(recencyScore(null, NOW)).toBe(0);
    expect(relevanceScore(teacher('a'), NOW)).toBeGreaterThan(
      relevanceScore(teacher('a', { lastRenewedAt: null }), NOW),
    );
  });

  it('puts a clearly better teacher first, whatever the rotation', () => {
    const better = teacher('better', { ratingAvg: 5, ratingCount: 40 });
    const worse = teacher('worse', {
      hasPhoto: false,
      bioLength: 40,
      subjectCount: 1,
      lastRenewedAt: new Date(NOW.getTime() - 300 * DAY),
    });
    for (let hour = 0; hour < 20; hour++) {
      const now = new Date(NOW.getTime() + hour * 60 * 60 * 1000);
      expect(
        rankTeachers([worse, better], 'pertinence', now).map((t) => t.userId),
      ).toEqual(['better', 'worse']);
    }
  });

  it('rotates near-equal teachers: stable within a period, different across periods', () => {
    const equals = Array.from({ length: 8 }, (_, i) => teacher(`t${i}`));
    const order = (now: Date) =>
      rankTeachers(equals, 'pertinence', now).map((t) => t.userId);

    // Same period, any input order: the same result (pages of one search stay consistent).
    expect(order(NOW)).toEqual(
      rankTeachers([...equals].reverse(), 'pertinence', NOW).map(
        (t) => t.userId,
      ),
    );
    // Across many periods the first place does not always go to the same teacher.
    const firsts = new Set<string>();
    for (let hour = 0; hour < 40; hour++) {
      firsts.add(order(new Date(NOW.getTime() + hour * 3600 * 1000))[0]);
    }
    expect(firsts.size).toBeGreaterThan(2);
  });

  it('gives rotation values in [0, 1) that depend on the period', () => {
    const value = rotationValue('abc', rotationSeed(NOW));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(rotationValue('abc', 1)).not.toBe(rotationValue('abc', 2));
  });

  it('sorts by price, rating and age', () => {
    const items = [
      teacher('mid', { fromRateMillimes: 20000, ratingAvg: 4, ratingCount: 5 }),
      teacher('cheap', {
        fromRateMillimes: 10000,
        ratingAvg: 0,
        ratingCount: 0,
        approvedAt: new Date(NOW.getTime() - 5 * DAY),
      }),
      teacher('dear', {
        fromRateMillimes: 50000,
        ratingAvg: 5,
        ratingCount: 2,
        approvedAt: new Date(NOW.getTime() + DAY),
      }),
    ];
    const ids = (sort: Sort) =>
      rankTeachers(items, sort, NOW).map((t) => t.userId);
    expect(ids('prix-asc')).toEqual(['cheap', 'mid', 'dear']);
    expect(ids('prix-desc')).toEqual(['dear', 'mid', 'cheap']);
    expect(ids('mieux-notes')).toEqual(['dear', 'mid', 'cheap']);
    expect(ids('recents')).toEqual(['dear', 'mid', 'cheap']);
  });
});

describe('level summary', () => {
  it('shortens runs of grades per cycle, in school order', () => {
    expect(
      summarizeLevels([
        { cycle: 'secondaire', grade: 4 },
        { cycle: 'secondaire', grade: 3 },
        { cycle: 'primaire', grade: 1 },
        { cycle: 'primaire', grade: 2 },
        { cycle: 'primaire', grade: 3 },
        { cycle: 'primaire', grade: 5 },
      ]),
    ).toEqual([
      { cycle: 'primaire', grades: '1-3, 5' },
      { cycle: 'secondaire', grades: '3-4' },
    ]);
  });

  it('writes the university levels L1, L2, L3', () => {
    expect(
      summarizeLevels([
        { cycle: 'universite', grade: 1 },
        { cycle: 'universite', grade: 2 },
        { cycle: 'universite', grade: 3 },
      ]),
    ).toEqual([{ cycle: 'universite', grades: 'L1-L3' }]);
    expect(summarizeLevels([{ cycle: 'universite', grade: 2 }])).toEqual([
      { cycle: 'universite', grades: 'L2' },
    ]);
    expect(summarizeLevels([])).toEqual([]);
  });
});

describe('page addresses', () => {
  it('French has no prefix, Arabic lives under /ar', () => {
    expect(pageUrl('fr', '/prof/x')).toMatch(/\/prof\/x$/);
    expect(pageUrl('ar', '/prof/x')).toMatch(/\/ar\/prof\/x$/);
    expect(pageUrl('fr', '/')).not.toMatch(/\/$/);
    expect(pageUrl('ar', '/')).toMatch(/\/ar$/);
  });

  it('points each language at its twin', () => {
    const alternates = alternatesFor('ar', '/recherche');
    expect(alternates.canonical).toBe(pageUrl('ar', '/recherche'));
    expect(alternates.languages.fr).toBe(pageUrl('fr', '/recherche'));
    expect(alternates.languages['x-default']).toBe(pageUrl('fr', '/recherche'));
  });
});

describe('French elisions', () => {
  it('writes "d\'" before a vowel or a silent h, "de" otherwise', async () => {
    const { deSubject } = await import('@/lib/marketplace/french');
    expect(deSubject('Anglais', 'fr')).toBe("d'Anglais");
    expect(deSubject('Économie', 'fr')).toBe("d'Économie");
    expect(deSubject('Histoire-Géo', 'fr')).toBe("d'Histoire-Géo");
    expect(deSubject('Physique', 'fr')).toBe('de Physique');
    expect(deSubject('Anglais', 'ar')).toBe('Anglais');
  });

  it('writes "à Sfax" but "au Kef"', async () => {
    const { inGovernorate } = await import('@/lib/marketplace/french');
    expect(inGovernorate('Sfax', 'fr')).toBe('à Sfax');
    expect(inGovernorate('Le Kef', 'fr')).toBe('au Kef');
    expect(inGovernorate('Ben Arous', 'fr')).toBe('à Ben Arous');
    expect(inGovernorate('صفاقس', 'ar')).toBe('في صفاقس');
  });
});
