import { computeStats, type StatRound } from './stats';

const pars = [3, 3, 4];
const round = (id: string, day: number, scores: Record<number, number>, layoutId = 'L1'): StatRound => ({
  id, layoutId, courseName: 'Test Course', pars, startedAt: `2026-01-${String(day).padStart(2, '0')}T10:00:00Z`, scores,
});

describe('computeStats', () => {
  it('handles no rounds', () => {
    const s = computeStats([]);
    expect(s).toEqual({
      rounds: 0, holes: 0, best: null, courses: [],
      outcomes: { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 },
    });
  });

  it('counts outcomes against par and ignores rounds with no scores', () => {
    const s = computeStats([round('a', 1, { 1: 2, 2: 3, 3: 6 }), round('b', 2, {})]);
    expect(s.rounds).toBe(1);
    expect(s.holes).toBe(3);
    expect(s.outcomes).toEqual({ eagle: 0, birdie: 1, par: 1, bogey: 0, double: 1 });
  });

  it('finds the best and average from complete rounds only', () => {
    const s = computeStats([
      round('a', 1, { 1: 3, 2: 3, 3: 4 }), // E
      round('b', 2, { 1: 2, 2: 3, 3: 5 }), // E
      round('c', 3, { 1: 2, 2: 2, 3: 3 }), // -3
      round('d', 4, { 1: 1 }),             // partial: never best
    ]);
    const c = s.courses[0];
    expect(c.rounds.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(c.bestRelative).toBe(-3);
    expect(c.bestTotal).toBe(7);
    expect(c.averageRelative).toBe(-1);
    expect(s.best).toEqual({ courseName: 'Test Course', relative: -3, total: 7 });
  });

  it('averages each hole against par across rounds, including partial ones', () => {
    const s = computeStats([round('a', 1, { 1: 4, 2: 3, 3: 4 }), round('b', 2, { 1: 3 })]);
    expect(s.courses[0].holeAverages).toEqual([0.5, 0, 0]);
  });

  it('keeps courses apart and lists the most played first', () => {
    const s = computeStats([
      round('a', 1, { 1: 3 }, 'L1'), round('b', 2, { 1: 3 }, 'L2'), round('c', 3, { 1: 3 }, 'L2'),
    ]);
    expect(s.courses.map((c) => c.layoutId)).toEqual(['L2', 'L1']);
  });

  it('has no best when no round is complete', () => {
    const s = computeStats([round('a', 1, { 1: 3 })]);
    expect(s.best).toBeNull();
    expect(s.courses[0].averageRelative).toBeNull();
  });
});
