import { groupBoards, headToHead, type TogetherInput } from './together';

const pars = [3, 4, 3];
type Seat = { userId: string | null; name: string; scores: Record<number, number> };
const seat = (userId: string | null, name: string, ...strokes: number[]): Seat => ({
  userId, name, scores: Object.fromEntries(strokes.map((s, i) => [i + 1, s])),
});
const round = (id: string, day: number, players: Seat[], over: Partial<TogetherInput> = {}): TogetherInput => ({
  id, layoutId: 'L1', courseName: 'Maple Hill', pars, startedAt: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`,
  players, ...over,
});
const me = (...s: number[]) => seat('me', 'You', ...s);

describe('headToHead', () => {
  it('is empty with no rounds, with rounds without you, and with only guests and strangers', () => {
    expect(headToHead([], 'me')).toEqual([]);
    expect(headToHead([round('a', 1, [seat('x', 'Xi', 3, 4, 3), seat('y', 'Yo', 3, 4, 3)])], 'me')).toEqual([]);
    expect(headToHead([round('a', 1, [me(3, 4, 3), seat(null, 'Gus', 3, 4, 3)])], 'me')).toEqual([]);
  });

  it('counts wins, ties and losses by total strokes and averages the difference', () => {
    const rounds = [
      round('a', 1, [me(3, 4, 3), seat('f', 'Fay', 4, 4, 3)]), // win by 1
      round('b', 2, [me(3, 4, 3), seat('f', 'Fay', 3, 4, 3)]), // tie
      round('c', 3, [me(5, 5, 4), seat('f', 'Fay', 3, 4, 3)]), // lose by 4
    ];
    const [f] = headToHead(rounds, 'me');
    expect(f).toMatchObject({ userId: 'f', name: 'Fay', roundsTogether: 3, compared: 3, wins: 1, ties: 1, losses: 1 });
    expect(f.averageDiff).toBeCloseTo((-1 + 0 + 4) / 3);
    expect(f.rounds.map((r) => r.roundId)).toEqual(['c', 'b', 'a']);
    expect(f.bestRound).toMatchObject({ roundId: 'a', diff: -1, myTotal: 10, theirTotal: 11 });
    expect(f.lastPlayed).toBe('2026-11-03T10:00:00Z');
  });

  it('counts an unfinished round as played together but leaves it out of the record', () => {
    const [f] = headToHead([
      round('a', 1, [me(3, 4, 3), seat('f', 'Fay', 4, 4)]),   // Fay stopped early
      round('b', 2, [me(3, 4), seat('f', 'Fay', 4, 4, 3)]),   // you stopped early
      round('c', 3, [me(3, 4, 3), seat('f', 'Fay', 4, 4, 3)]),
    ], 'me');
    expect(f).toMatchObject({ roundsTogether: 3, compared: 1, wins: 1, losses: 0, ties: 0 });
  });

  it('with nothing comparable has no average or best round', () => {
    const [f] = headToHead([round('a', 1, [me(3), seat('f', 'Fay', 3)])], 'me');
    expect(f).toMatchObject({ roundsTogether: 1, compared: 0, averageDiff: null, bestRound: null, rounds: [] });
  });

  it("uses each round's own pars, so a round with edited pars is judged by its own hole count", () => {
    const four = round('a', 1, [me(3, 4, 3, 5), seat('f', 'Fay', 3, 4, 3, 4)], { pars: [3, 4, 3, 4] });
    const [f] = headToHead([four, round('b', 2, [me(3, 4, 3), seat('f', 'Fay', 3, 4, 3)])], 'me');
    expect(f.compared).toBe(2);
    expect(f.rounds.find((r) => r.roundId === 'a')).toMatchObject({ diff: 1 });
  });

  it('matches people by account id, not name: two friends with one name stay apart, a renamed friend stays one', () => {
    const recs = headToHead([
      round('a', 1, [me(3, 4, 3), seat('f1', 'Sam', 3, 4, 3)]),
      round('b', 2, [me(3, 4, 3), seat('f2', 'Sam', 5, 5, 5)]),
      round('c', 3, [me(3, 4, 3), seat('f1', 'Samuel', 4, 4, 4)]),
    ], 'me');
    expect(recs.map((r) => [r.userId, r.name, r.roundsTogether])).toEqual([['f1', 'Samuel', 2], ['f2', 'Sam', 1]]);
  });

  it('keeps one record per friend in a round with several friends, and ignores guests and strangers there', () => {
    const recs = headToHead([round('a', 1, [
      me(3, 4, 3), seat('f1', 'Ann', 3, 4, 3), seat('f2', 'Bo', 4, 4, 3), seat(null, 'Gus', 2, 2, 2), seat(null, 'Stranger', 3, 3, 3),
    ])], 'me');
    expect(recs.map((r) => r.userId).sort()).toEqual(['f1', 'f2']);
  });

  it('lists the friend you played most recently first', () => {
    const recs = headToHead([
      round('a', 1, [me(3, 4, 3), seat('f1', 'Ann', 3, 4, 3)]),
      round('b', 5, [me(3, 4, 3), seat('f2', 'Bo', 3, 4, 3)]),
    ], 'me');
    expect(recs.map((r) => r.userId)).toEqual(['f2', 'f1']);
  });
});

describe('groupBoards', () => {
  it('is empty when nobody but you has a complete round', () => {
    expect(groupBoards([], 'me')).toEqual([]);
    expect(groupBoards([round('a', 1, [me(3, 4, 3), seat('f', 'Fay', 3, 4)])], 'me')).toEqual([]);
  });

  it("ranks each person's best complete round on a course, fewest strokes first, you included", () => {
    const boards = groupBoards([
      round('a', 1, [me(4, 4, 4), seat('f', 'Fay', 3, 4, 3)]),
      round('b', 2, [me(3, 4, 3), seat('f', 'Fay', 5, 5, 5)]),
    ], 'me');
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ layoutId: 'L1', courseName: 'Maple Hill', holeCount: 3 });
    // Both best rounds are 10 strokes; Fay's was played first, so she ranks ahead.
    expect(boards[0].entries.map((e) => [e.name, e.total, e.relative, e.roundId, e.isMe])).toEqual([
      ['Fay', 10, 0, 'a', false],
      ['You', 10, 0, 'b', true],
    ]);
  });

  it('leaves out guests, strangers, and people you have never shared a round with', () => {
    const boards = groupBoards([
      round('a', 1, [me(3, 4, 3), seat('f', 'Fay', 4, 4, 3), seat(null, 'Gus', 2, 2, 2)]),
      round('b', 2, [seat('z', 'Zed', 1, 1, 1), seat('y', 'Yan', 2, 2, 2)]), // a round you were not in
    ], 'me');
    expect(boards[0].entries.map((e) => e.name)).toEqual(['You', 'Fay']);
  });

  it('includes every friend you have a shared round with, each ranked by their best round', () => {
    const boards = groupBoards([
      round('a', 1, [me(4, 4, 4), seat('f', 'Fay', 4, 4, 4)]),
      round('c', 3, [me(3, 4, 4), seat('g', 'Gil', 3, 4, 3)]),
    ], 'me');
    expect(boards[0].entries.map((e) => e.name)).toEqual(['Gil', 'You', 'Fay']);
  });

  it('keeps layouts apart even when the course name is the same, and drops a layout with only one person', () => {
    const boards = groupBoards([
      round('a', 1, [me(3, 4, 3), seat('f', 'Fay', 3, 4, 3)]),
      round('b', 2, [me(2, 3, 2), seat('f', 'Fay', 3, 3, 2)], { layoutId: 'L2', pars: [3, 3, 3] }),
      round('c', 3, [me(3, 3, 3)], { layoutId: 'L3' }),
    ], 'me');
    expect(boards.map((b) => b.layoutId)).toEqual(['L1', 'L2']);
    expect(boards.find((b) => b.layoutId === 'L2')!.entries[0]).toMatchObject({ name: 'You', total: 7, relative: -2 });
  });

  it("shows a friend's current name, from their latest round, even when an older round was their best", () => {
    const [b] = groupBoards([
      round('a', 1, [me(5, 5, 5), seat('f', 'Sam', 3, 4, 3)]),
      round('b', 9, [me(5, 5, 5), seat('f', 'Samuel', 5, 5, 5)]),
    ], 'me');
    const fay = b.entries.find((e) => !e.isMe)!;
    expect(fay).toMatchObject({ name: 'Samuel', total: 10, roundId: 'a' });
  });
});
