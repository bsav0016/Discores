export type ScoreMap = Record<number, number>; // hole number -> strokes

export function totalStrokes(scores: ScoreMap): number {
  return Object.values(scores).reduce((sum, s) => sum + s, 0);
}

/** Par for only the holes that have a score, so a half-finished round compares fairly. */
export function parThroughScored(pars: number[], scores: ScoreMap): number {
  return pars.reduce((sum, par, i) => (scores[i + 1] !== undefined ? sum + par : sum), 0);
}

export function relativeToPar(pars: number[], scores: ScoreMap): number {
  return totalStrokes(scores) - parThroughScored(pars, scores);
}

export function formatRelative(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

export function holesScored(scores: ScoreMap): number {
  return Object.keys(scores).length;
}

export function isComplete(holeCount: number, playerScores: ScoreMap[]): boolean {
  return playerScores.length > 0 && playerScores.every((s) => holesScored(s) >= holeCount);
}

export const MIN_STROKES = 1;
export const MAX_STROKES = 30;

export function clampStrokes(n: number): number {
  return Math.min(MAX_STROKES, Math.max(MIN_STROKES, Math.round(n)));
}

export const MIN_AGE = 13;

export function isOldEnough(birthYear: number, now = new Date()): boolean {
  // We store birth year only, so this is a sanity check; the explicit "I am 13 or older"
  // confirmation is the real attestation. Mirrors the server-side check in handle_new_user().
  return now.getFullYear() - birthYear >= MIN_AGE;
}
