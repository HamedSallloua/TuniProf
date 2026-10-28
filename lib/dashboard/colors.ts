// Group colours (spec 5.2: "a colour is assigned automatically"). Ten distinct colours that
// stay readable as a thin border next to dark text on a light tinted background.

export const GROUP_COLORS = [
  '#1d4ed8',
  '#b91c1c',
  '#047857',
  '#b45309',
  '#7e22ce',
  '#0e7490',
  '#be185d',
  '#4d7c0f',
  '#334155',
  '#a16207',
] as const;

/** The first colour not used by the teacher's active groups; the least used one after that. */
export function pickColor(used: string[]): string {
  const counts = new Map<string, number>(GROUP_COLORS.map((c) => [c, 0]));
  for (const color of used)
    if (counts.has(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
  let best: string = GROUP_COLORS[0];
  for (const color of GROUP_COLORS) {
    if ((counts.get(color) ?? 0) < (counts.get(best) ?? 0)) best = color;
  }
  return best;
}
