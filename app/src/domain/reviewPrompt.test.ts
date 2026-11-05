import { COOLDOWN_DAYS, MIN_ROUNDS, shouldAskForReview } from './reviewPrompt';
import type { StatRound } from './stats';

const pars = [3, 3, 4]; // par 10
const round = (id: string, strokes: [number, number, number], layoutId = 'L1'): StatRound => ({
  id, layoutId, courseName: 'Test Course', pars, startedAt: '2026-01-01T10:00:00Z',
  scores: { 1: strokes[0], 2: strokes[1], 3: strokes[2] },
});

const NOW = new Date('2026-06-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

// Five finished rounds on one course: +2, +2, +2, +2 and then a good one at even par.
const usual = (n: number) => Array.from({ length: n }, (_, i) => round(`r${i}`, [4, 4, 4]));
const good = round('good', [3, 3, 4]);
const bad = round('bad', [5, 5, 6]);

const ask = (rounds: StatRound[], justFinishedId: string, lastAskedAt: string | null = null) =>
  shouldAskForReview({ rounds, justFinishedId, lastAskedAt, now: NOW });

describe('shouldAskForReview', () => {
  it('asks after a better-than-usual round once the player has enough rounds', () => {
    expect(MIN_ROUNDS).toBe(5);
    expect(ask([...usual(4), good], 'good')).toBe(true);
  });

  it('asks after a round that matches the usual score', () => {
    expect(ask([...usual(4), round('same', [4, 4, 4])], 'same')).toBe(true);
  });

  it('does not ask after a worse-than-usual round', () => {
    expect(ask([...usual(4), bad], 'bad')).toBe(false);
  });

  it('does not ask before the player has finished enough rounds', () => {
    expect(ask([...usual(3), good], 'good')).toBe(false);
  });

  it('does not count a half-played round', () => {
    const half: StatRound = { ...round('half', [3, 3, 4]), scores: { 1: 3 } };
    expect(ask([...usual(3), half, good], 'good')).toBe(false);
  });

  it('does not ask after a round that is not finished', () => {
    const half: StatRound = { ...round('half', [3, 3, 4]), scores: { 1: 3 } };
    expect(ask([...usual(5), half], 'half')).toBe(false);
  });

  it('does not ask when the finished round is not in the list', () => {
    expect(ask(usual(6), 'missing')).toBe(false);
  });

  it('compares only with rounds on the same course, and needs one to compare with', () => {
    const elsewhere = Array.from({ length: 5 }, (_, i) => round(`e${i}`, [4, 4, 4], 'L2'));
    expect(ask([...elsewhere, good], 'good')).toBe(false); // first round on L1: nothing to compare with
    expect(ask([...elsewhere, round('o', [4, 4, 4]), good], 'good')).toBe(true);
  });

  it('waits out the cool-down after an ask', () => {
    const rounds = [...usual(4), good];
    expect(COOLDOWN_DAYS).toBe(120);
    expect(ask(rounds, 'good', daysAgo(30))).toBe(false);
    expect(ask(rounds, 'good', daysAgo(119))).toBe(false);
    expect(ask(rounds, 'good', daysAgo(121))).toBe(true);
  });

  it('treats an unreadable last-asked date as never asked', () => {
    expect(ask([...usual(4), good], 'good', 'not a date')).toBe(true);
  });
});
