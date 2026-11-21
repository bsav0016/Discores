import type { CourseBoard, FriendRecord } from './together';

/** "3 ahead", "2 behind" or "Level" for your strokes minus theirs (negative = you are ahead). */
export function gapLabel(diff: number): string {
  const n = Math.abs(diff);
  const rounded = Math.round(n * 10) / 10;
  if (rounded === 0) return 'Level';
  return `${rounded} ${diff < 0 ? 'ahead' : 'behind'}`;
}

/** "2-1-0": wins, ties, losses. */
export function recordLabel(f: Pick<FriendRecord, 'wins' | 'ties' | 'losses'>): string {
  return `${f.wins}-${f.ties}-${f.losses}`;
}

/** "5 rounds together", "1 round together". */
export function togetherLabel(n: number): string {
  return `${n} round${n === 1 ? '' : 's'} together`;
}

/**
 * Keeps only you and the people who are your friends now. A round played with someone you later removed or blocked
 * stays in your history, but they should not show up in "your group". Boards left with fewer than two people go.
 */
export function onlyCurrentFriends(boards: CourseBoard[], friendIds: ReadonlySet<string>): CourseBoard[] {
  return boards
    .map((b) => ({ ...b, entries: b.entries.filter((e) => e.isMe || friendIds.has(e.userId)) }))
    .filter((b) => b.entries.length >= 2);
}
