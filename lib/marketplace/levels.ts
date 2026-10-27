// "Primaire 1-6, Secondaire 1-4": the levels of a teacher, shortened for the card and profile.

export const CYCLE_ORDER = [
  'primaire',
  'preparatoire',
  'secondaire',
  'universite',
] as const;
export type Cycle = (typeof CYCLE_ORDER)[number];

export type LevelRef = { cycle: string; grade: number };
export type LevelGroup = { cycle: Cycle; grades: string };

/** [1,2,3,5] -> "1-3, 5"; with a prefix ("L") -> "L1-L3, L5". */
function runs(grades: number[], prefix: string): string {
  const sorted = [...new Set(grades)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i === sorted.length || sorted[i] !== sorted[i - 1] + 1) {
      const from = sorted[start];
      const to = sorted[i - 1];
      parts.push(
        from === to ? `${prefix}${from}` : `${prefix}${from}-${prefix}${to}`,
      );
      start = i;
    }
  }
  return parts.join(', ');
}

/** One entry per cycle, in school order. Université levels are written L1, L2, L3. */
export function summarizeLevels(levels: LevelRef[]): LevelGroup[] {
  return CYCLE_ORDER.flatMap((cycle) => {
    const grades = levels.filter((l) => l.cycle === cycle).map((l) => l.grade);
    if (grades.length === 0) return [];
    return [{ cycle, grades: runs(grades, cycle === 'universite' ? 'L' : '') }];
  });
}
