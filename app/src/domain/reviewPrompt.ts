import { holesScored, relativeToPar } from './scoring';
import type { StatRound } from './stats';

/** Finished rounds a player needs before the app asks for a store review. */
export const MIN_ROUNDS = 5;
/** Days to wait after one ask before another (the stores also limit how often the prompt really shows). */
export const COOLDOWN_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

const isComplete = (r: StatRound) => r.pars.length > 0 && holesScored(r.scores) >= r.pars.length;

/**
 * Whether to ask for a store review right after the player finished the round `justFinishedId`.
 * Asks only at a good moment: the player has finished at least MIN_ROUNDS rounds, the round just finished was
 * played at least as well as their average on the same course, and they have not been asked in the last
 * COOLDOWN_DAYS days.
 */
export function shouldAskForReview(args: {
  rounds: StatRound[];
  justFinishedId: string;
  lastAskedAt: string | null;
  now: Date;
}): boolean {
  const { rounds, justFinishedId, lastAskedAt, now } = args;
  if (lastAskedAt) {
    const last = Date.parse(lastAskedAt);
    if (!Number.isNaN(last) && now.getTime() - last < COOLDOWN_DAYS * DAY_MS) return false;
  }
  const complete = rounds.filter(isComplete);
  if (complete.length < MIN_ROUNDS) return false;
  const just = complete.find((r) => r.id === justFinishedId);
  if (!just) return false;
  // Compare with the player's other rounds on this course; with none to compare, it is not a known good day.
  const others = complete.filter((r) => r.id !== just.id && r.layoutId === just.layoutId);
  if (others.length === 0) return false;
  const average = others.reduce((sum, r) => sum + relativeToPar(r.pars, r.scores), 0) / others.length;
  return relativeToPar(just.pars, just.scores) <= average;
}
