// Rules for editing the holes and pars of a round. The server enforces the same limits (migration 0022).

export const MIN_HOLES = 1;
export const MAX_HOLES = 36;
export const MIN_PAR = 2;
export const MAX_PAR = 6;
export const DEFAULT_PAR = 3;

/** The highest hole that has a score from any player (0 when nothing is scored). A round cannot shrink below it. */
export function highestScoredHole(playerScores: Record<number, number>[]): number {
  let highest = 0;
  for (const scores of playerScores) {
    for (const hole of Object.keys(scores)) highest = Math.max(highest, Number(hole));
  }
  return highest;
}

/** Why these pars cannot be saved for a round, or null when they can. */
export function parsError(pars: number[], scoredThrough: number): string | null {
  if (pars.length < MIN_HOLES || pars.length > MAX_HOLES) return `A round needs ${MIN_HOLES} to ${MAX_HOLES} holes.`;
  if (pars.some((p) => !Number.isInteger(p) || p < MIN_PAR || p > MAX_PAR)) {
    return `Par must be between ${MIN_PAR} and ${MAX_PAR}.`;
  }
  if (pars.length < scoredThrough) {
    return `Hole ${scoredThrough} already has a score, so the round cannot have fewer than ${scoredThrough} holes.`;
  }
  return null;
}

/** The same pars with `count` holes: extra holes are par 3, removed holes come off the end. */
export function withHoleCount(pars: number[], count: number): number[] {
  const n = Math.min(MAX_HOLES, Math.max(MIN_HOLES, Math.trunc(count)));
  return Array.from({ length: n }, (_, i) => pars[i] ?? DEFAULT_PAR);
}

export const samePars = (a: number[], b: number[]) => a.length === b.length && a.every((p, i) => p === b[i]);
