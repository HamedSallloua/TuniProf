import { createHash } from 'node:crypto';
import { RANKING_WEIGHTS, SEARCH } from './config';
import type { Sort } from './search-params';

// Order of the search results (spec 3.2). Pure functions: the database only finds the
// matching teachers, the order is decided here so it can be tested.

export type RankInput = {
  userId: string;
  hasPhoto: boolean;
  bioLength: number;
  subjectCount: number;
  ratingAvg: number;
  ratingCount: number;
  /** Latest purchase or grant of days; null when there never was one. */
  lastRenewedAt: Date | null;
  approvedAt: Date | null;
  /** Lowest hourly rate among the subjects matching the search, in millimes. */
  fromRateMillimes: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 0 to 1. Every visible profile already has the required fields; this rewards the extras. */
export function completenessScore(input: RankInput): number {
  return (
    0.5 * (input.hasPhoto ? 1 : 0) +
    0.25 * (input.bioLength >= 200 ? 1 : 0) +
    0.25 * (input.subjectCount >= 2 ? 1 : 0)
  );
}

// A teacher with no review is treated as if they had 3 reviews of 4 stars, so a newcomer is
// neither buried nor placed above teachers with many good reviews.
const PRIOR_RATING = 4;
const PRIOR_WEIGHT = 3;

/** 0 to 1. A damped average: few reviews count for less than many. */
export function ratingScore(avg: number, count: number): number {
  const weighted =
    (avg * count + PRIOR_RATING * PRIOR_WEIGHT) / (count + PRIOR_WEIGHT);
  return weighted / 5;
}

/** 0 to 1. 1 for a plan bought today, 0 after a year. Rewards teachers who keep renewing. */
export function recencyScore(last: Date | null, now: Date): number {
  if (!last) return 0;
  const days = Math.max(0, (now.getTime() - last.getTime()) / DAY_MS);
  return 1 - Math.min(days, 365) / 365;
}

/** 0 to 100. */
export function relevanceScore(input: RankInput, now: Date): number {
  return (
    RANKING_WEIGHTS.completeness * completenessScore(input) +
    RANKING_WEIGHTS.rating * ratingScore(input.ratingAvg, input.ratingCount) +
    RANKING_WEIGHTS.recency * recencyScore(input.lastRenewedAt, now)
  );
}

/** Which rotation period `now` belongs to. The order of equal teachers changes with it. */
export function rotationSeed(now: Date): number {
  return Math.floor(now.getTime() / SEARCH.rotationMs);
}

/** A stable pseudo-random number in [0, 1) for this teacher in this rotation. */
export function rotationValue(userId: string, seed: number): number {
  const digest = createHash('sha256').update(`${seed}:${userId}`).digest();
  return digest.readUIntBE(0, 6) / 2 ** 48;
}

/**
 * Sorts the matching teachers. The default order is the score by bands: teachers within
 * `rotationBand` points of each other are "near-equal" and are shuffled, differently in each
 * rotation period, so new teachers get exposure. The other sorts break ties the same way.
 */
export function rankTeachers<T extends RankInput>(
  items: T[],
  sort: Sort,
  now: Date,
): T[] {
  const seed = rotationSeed(now);
  const rotation = (item: T) => rotationValue(item.userId, seed);

  const keyed = items.map((item) => ({
    item,
    rotation: rotation(item),
    band: Math.floor(relevanceScore(item, now) / SEARCH.rotationBand),
  }));

  const primary = (a: (typeof keyed)[number], b: (typeof keyed)[number]) => {
    switch (sort) {
      case 'prix-asc':
        return a.item.fromRateMillimes - b.item.fromRateMillimes;
      case 'prix-desc':
        return b.item.fromRateMillimes - a.item.fromRateMillimes;
      case 'mieux-notes':
        // Reviewed teachers first, best average first, then the most reviewed.
        return (
          Number(b.item.ratingCount > 0) - Number(a.item.ratingCount > 0) ||
          b.item.ratingAvg - a.item.ratingAvg ||
          b.item.ratingCount - a.item.ratingCount
        );
      case 'recents':
        return (
          (b.item.approvedAt?.getTime() ?? 0) -
          (a.item.approvedAt?.getTime() ?? 0)
        );
      default:
        return b.band - a.band;
    }
  };

  return keyed
    .sort((a, b) => primary(a, b) || a.rotation - b.rotation)
    .map((entry) => entry.item);
}
