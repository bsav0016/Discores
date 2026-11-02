import { DEFAULT_PAR, highestScoredHole, parsError, samePars, withHoleCount } from './pars';

describe('highestScoredHole', () => {
  it('is the highest hole any player has scored, or 0', () => {
    expect(highestScoredHole([])).toBe(0);
    expect(highestScoredHole([{}, {}])).toBe(0);
    expect(highestScoredHole([{ 1: 3, 4: 5 }, { 2: 4 }])).toBe(4);
  });
});

describe('parsError', () => {
  it('accepts 1 to 36 holes of par 2 to 6', () => {
    expect(parsError([3], 0)).toBeNull();
    expect(parsError([2, 3, 4, 5, 6], 5)).toBeNull();
    expect(parsError(Array(36).fill(3), 0)).toBeNull();
  });

  it('refuses a wrong number of holes or a par out of range', () => {
    expect(parsError([], 0)).toMatch(/1 to 36/);
    expect(parsError(Array(37).fill(3), 0)).toMatch(/1 to 36/);
    expect(parsError([3, 1], 0)).toMatch(/between 2 and 6/);
    expect(parsError([3, 7], 0)).toMatch(/between 2 and 6/);
    expect(parsError([3, 3.5], 0)).toMatch(/between 2 and 6/);
  });

  it('refuses to cut below a hole that has a score', () => {
    expect(parsError([3, 3], 3)).toMatch(/Hole 3 already has a score/);
    expect(parsError([3, 3, 3], 3)).toBeNull();
  });
});

describe('withHoleCount', () => {
  it('adds par 3 holes at the end and removes holes from the end', () => {
    expect(withHoleCount([4, 5], 4)).toEqual([4, 5, DEFAULT_PAR, DEFAULT_PAR]);
    expect(withHoleCount([4, 5, 3, 3], 2)).toEqual([4, 5]);
  });

  it('keeps the count within 1 to 36', () => {
    expect(withHoleCount([4, 5], 0)).toEqual([4]);
    expect(withHoleCount([4], 99)).toHaveLength(36);
  });
});

describe('samePars', () => {
  it('compares hole by hole', () => {
    expect(samePars([3, 4], [3, 4])).toBe(true);
    expect(samePars([3, 4], [3, 5])).toBe(false);
    expect(samePars([3, 4], [3])).toBe(false);
  });
});
