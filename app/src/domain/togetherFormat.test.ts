import type { CourseBoard } from './together';
import { gapLabel, onlyCurrentFriends, recordLabel, togetherLabel } from './togetherFormat';

describe('gapLabel', () => {
  it('says who is ahead, rounding to one decimal', () => {
    expect(gapLabel(-3)).toBe('3 ahead');
    expect(gapLabel(2)).toBe('2 behind');
    expect(gapLabel(-1.3333)).toBe('1.3 ahead');
    expect(gapLabel(0)).toBe('Level');
    expect(gapLabel(0.04)).toBe('Level');
  });
});

describe('labels', () => {
  it('writes the record and the rounds together', () => {
    expect(recordLabel({ wins: 2, ties: 1, losses: 0 })).toBe('2-1-0');
    expect(togetherLabel(1)).toBe('1 round together');
    expect(togetherLabel(4)).toBe('4 rounds together');
  });
});

describe('onlyCurrentFriends', () => {
  const entry = (userId: string, isMe = false) => ({
    userId, name: userId, isMe, total: 10, relative: 0, roundId: 'r', startedAt: '2026-11-01T10:00:00Z',
  });
  const board = (...entries: ReturnType<typeof entry>[]): CourseBoard => ({ layoutId: 'L1', courseName: 'Maple Hill', holeCount: 3, entries });

  it('drops people who are no longer friends and boards left with fewer than two', () => {
    const boards = [board(entry('me', true), entry('f1'), entry('old')), board(entry('me', true), entry('old'))];
    const out = onlyCurrentFriends(boards, new Set(['f1']));
    expect(out).toHaveLength(1);
    expect(out[0].entries.map((e) => e.userId)).toEqual(['me', 'f1']);
  });

  it('keeps nothing when you have no friends now', () => {
    expect(onlyCurrentFriends([board(entry('me', true), entry('old'))], new Set())).toEqual([]);
  });
});
