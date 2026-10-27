import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET } from '@/lib/auth/crypto';
import {
  deriveActivationCode,
  hashActivationCode,
  normalizeActivationCode,
} from '@/lib/billing/codes';
import {
  DAY_MS,
  GRACE_DAYS,
  dashboardAccess,
  daysLeft,
  extendUntil,
  visibilityActive,
} from '@/lib/billing/entitlements';
import {
  nominalMonths,
  planPrice,
  pricePerMonth,
  savingPercent,
  upgradePrice,
  type Plan,
} from '@/lib/billing/plans';
import { formatMillimes, roundToHalfDinar } from '@/lib/money';

// The plans of spec 2.1, in millimes.
const plan = (
  slug: string,
  durationDays: number,
  visibility: number,
  bundle: number,
): Plan => ({
  id: slug,
  slug,
  nameFr: slug,
  nameAr: slug,
  durationDays,
  priceVisibilityMillimes: visibility,
  priceWithDashboardMillimes: bundle,
  sortOrder: 0,
});
const MENSUEL = plan('mensuel', 30, 15000, 25000);
const TRIMESTRIEL = plan('trimestriel', 90, 40500, 65000);
const SEMESTRIEL = plan('semestriel', 180, 72000, 111000);
const ANNUEL = plan('annuel', 365, 120000, 180000);

describe('money', () => {
  it('writes millimes as dinars with three decimals', () => {
    expect(formatMillimes(40500)).toBe('40.500 DT');
    expect(formatMillimes(15000)).toBe('15.000 DT');
    expect(formatMillimes(5)).toBe('0.005 DT');
    expect(formatMillimes(0)).toBe('0.000 DT');
    expect(formatMillimes(40500, 'ar')).toBe('40.500 د.ت');
  });

  it('rounds to the nearest 0.5 DT, halves up', () => {
    expect(roundToHalfDinar(16438)).toBe(16500);
    expect(roundToHalfDinar(16249)).toBe(16000);
    expect(roundToHalfDinar(16250)).toBe(16500);
    expect(roundToHalfDinar(0)).toBe(0);
    expect(roundToHalfDinar(499)).toBe(500);
    expect(roundToHalfDinar(250)).toBe(500);
    expect(roundToHalfDinar(249)).toBe(0);
  });
});

describe('plan prices follow the table of spec 2.1', () => {
  it('visibility only or with the Dashboard', () => {
    expect(planPrice(SEMESTRIEL, false)).toBe(72000); // the corrected 20% price, not 90.000
    expect(planPrice(SEMESTRIEL, true)).toBe(111000);
  });

  it('counts plans in nominal months: 30, 90, 180, 365 days = 1, 3, 6, 12', () => {
    expect([30, 90, 180, 365].map(nominalMonths)).toEqual([1, 3, 6, 12]);
  });

  it.each([
    // plan, visibility per month, with dashboard per month
    [MENSUEL, 15000, 25000],
    [TRIMESTRIEL, 13500, 21667],
    [SEMESTRIEL, 12000, 18500],
    [ANNUEL, 10000, 15000],
  ])('%s: per month', (p, visibility, bundle) => {
    expect(pricePerMonth(p.priceVisibilityMillimes, p.durationDays)).toBe(
      visibility,
    );
    expect(pricePerMonth(p.priceWithDashboardMillimes, p.durationDays)).toBe(
      bundle,
    );
  });

  it.each([
    // plan, saving visibility only, saving with dashboard (spec 2.1)
    [MENSUEL, 0, 0],
    [TRIMESTRIEL, 10, 13],
    [SEMESTRIEL, 20, 26],
    [ANNUEL, 33, 40],
  ])('%s: saving against the monthly plan', (p, visibility, bundle) => {
    expect(
      savingPercent(
        p.priceVisibilityMillimes,
        p.durationDays,
        MENSUEL.priceVisibilityMillimes,
      ),
    ).toBe(visibility);
    expect(
      savingPercent(
        p.priceWithDashboardMillimes,
        p.durationDays,
        MENSUEL.priceWithDashboardMillimes,
      ),
    ).toBe(bundle);
  });
});

describe('Dashboard added mid-term (spec 2.2)', () => {
  it('price = add-on x remaining days / plan days, rounded to 0.5 DT', () => {
    // Annual add-on = 180 - 120 = 60 DT. 100 days left of 365: 16.438 DT -> 16.500 DT.
    expect(upgradePrice(ANNUEL, 100)).toBe(16500);
    // Whole term left: exactly the add-on.
    expect(upgradePrice(ANNUEL, 365)).toBe(60000);
    expect(upgradePrice(TRIMESTRIEL, 90)).toBe(24500);
    // Half of a quarter: 24.5 / 2 = 12.25 -> 12.5
    expect(upgradePrice(TRIMESTRIEL, 45)).toBe(12500);
    expect(upgradePrice(MENSUEL, 0)).toBe(0);
  });
});

describe('entitlement dates', () => {
  const NOW = new Date('2026-10-26T10:00:00.000Z');
  const inDays = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

  it('extends from the later of now and the current end (spec 2.2, test 10)', () => {
    // Renewing 10 days before the end adds the FULL duration after the current end.
    expect(extendUntil(inDays(10), 90, NOW)).toEqual(inDays(100));
    // Already over, or never had one: counted from now.
    expect(extendUntil(inDays(-5), 30, NOW)).toEqual(inDays(30));
    expect(extendUntil(null, 30, NOW)).toEqual(inDays(30));
    // Ends exactly now: from now.
    expect(extendUntil(NOW, 30, NOW)).toEqual(inDays(30));
  });

  it('counts whole days left, rounded up', () => {
    expect(daysLeft(null, NOW)).toBe(0);
    expect(daysLeft(inDays(-1), NOW)).toBe(0);
    expect(daysLeft(NOW, NOW)).toBe(0);
    expect(daysLeft(new Date(NOW.getTime() + 1), NOW)).toBe(1);
    expect(daysLeft(inDays(10), NOW)).toBe(10);
    expect(daysLeft(new Date(inDays(10).getTime() - 1), NOW)).toBe(10);
  });

  it('visibility is active only while its end is in the future', () => {
    expect(visibilityActive(null, NOW)).toBe(false);
    expect(visibilityActive(inDays(1), NOW)).toBe(true);
    expect(visibilityActive(NOW, NOW)).toBe(false);
  });

  it('the Dashboard: full, then read-only for 30 days, then locked (spec 2.5, test 12)', () => {
    expect(GRACE_DAYS).toBe(30);
    expect(dashboardAccess(null, NOW)).toBe('none');
    expect(dashboardAccess(inDays(5), NOW)).toBe('full');
    expect(dashboardAccess(inDays(-1), NOW)).toBe('read_only');
    expect(dashboardAccess(inDays(-30), NOW)).toBe('read_only'); // the 30th day still counts
    expect(dashboardAccess(new Date(inDays(-30).getTime() - 1), NOW)).toBe(
      'none',
    );
    expect(dashboardAccess(inDays(-31), NOW)).toBe('none');
  });
});

describe('activation codes (spec 2.4)', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('look like TTP-XXXX-XXXX-XXXX with the 32-character alphabet', () => {
    const code = deriveActivationCode(id);
    expect(code).toMatch(
      /^TTP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    );
    for (const char of code.slice(4).replace(/-/g, ''))
      expect(CODE_ALPHABET).toContain(char);
  });

  it('are the same for one id and different for another, and are stored as a hash', () => {
    expect(deriveActivationCode(id)).toBe(deriveActivationCode(id));
    expect(
      deriveActivationCode('99999999-2222-3333-4444-555555555555'),
    ).not.toBe(deriveActivationCode(id));
    const hash = hashActivationCode(deriveActivationCode(id));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(deriveActivationCode(id).replace(/-/g, ''));
  });

  it('are different from the WhatsApp verification codes', () => {
    // TTP-XXXX-XXXX-XXXX is 18 characters; a WhatsApp code (TTP-XXXX) is 8.
    expect(deriveActivationCode(id).length).toBe(18);
  });

  it('are read with or without dashes, spaces and any case', () => {
    const code = deriveActivationCode(id);
    const compact = code.replace(/-/g, '');
    expect(normalizeActivationCode(code.toLowerCase())).toBe(code);
    expect(normalizeActivationCode(compact)).toBe(code);
    expect(normalizeActivationCode(`  ${code.replace(/-/g, ' ')}  `)).toBe(
      code,
    );
  });

  it('are refused when the shape is wrong or a forbidden character is used', () => {
    for (const bad of [
      '',
      'hello',
      'TTP-ABCD-EFGH',
      'TTP-ABCD-EFGH-JKLMN',
      'XYZ-ABCD-EFGH-JKLM',
      'TTP-0BCD-EFGH-JKLM',
      'TTP-OBCD-EFGH-JKLM',
      'TTP-1BCD-EFGH-JKLM',
      'TTP-IBCD-EFGH-JKLM',
    ]) {
      expect(normalizeActivationCode(bad), bad).toBeNull();
    }
  });
});
