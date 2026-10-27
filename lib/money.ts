// Money is always an integer number of millimes: 40.500 DT = 40500 (spec 2.1).

/** 40500 -> "40.500 DT" (French) or "40.500 د.ت" (Arabic). Always three decimals. */
export function formatMillimes(
  millimes: number,
  locale: 'fr' | 'ar' | string = 'fr',
): string {
  const sign = millimes < 0 ? '-' : '';
  const abs = Math.abs(millimes);
  const whole = Math.floor(abs / 1000);
  const rest = String(abs % 1000).padStart(3, '0');
  return `${sign}${whole}.${rest} ${locale === 'ar' ? 'د.ت' : 'DT'}`;
}

/** Rounds to the nearest 0.5 DT (500 millimes), halves rounding up (spec 2.2). */
export function roundToHalfDinar(millimes: number): number {
  return Math.floor(millimes / 500 + 0.5) * 500;
}
