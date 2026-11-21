import { isComplete, relativeToPar, totalStrokes, type ScoreMap } from './scoring';

// Playing with your group: records against each friend and a best-rounds board per course, worked out on the phone
// from finished rounds already there (see listTogetherRounds). Only people with an account id take part: a guest
// typed in by name, or a stranger in a shared round, has none, and display names repeat and change, so nobody is
// matched by name.
//
// A round counts for a comparison only when it is complete for both people (every hole of the round's own pars
// scored), because a half-finished round is not comparable. The winner is the lower total strokes; both played the
// same holes with the same pars, so strokes and strokes-to-par rank the pair the same way. Strokes-to-par is shown
// on the course board, where rounds of different layouts are never mixed.

/** A finished round with every seat, as returned by listTogetherRounds(). */
export type TogetherInput = {
  id: string;
  layoutId: string;
  courseName: string;
  pars: number[];
  startedAt: string;
  players: { userId: string | null; name: string; scores: ScoreMap }[];
};

export type HeadToHeadRound = {
  roundId: string;
  courseName: string;
  startedAt: string;
  /** Your strokes minus theirs: negative means you were ahead. */
  diff: number;
  myTotal: number;
  theirTotal: number;
};

export type FriendRecord = {
  userId: string;
  /** The name they had in the most recent round you shared. */
  name: string;
  /** Finished rounds where you both had a seat, complete or not. */
  roundsTogether: number;
  /** Rounds where you both scored every hole; the record and the average use only these. */
  compared: number;
  wins: number;
  ties: number;
  losses: number;
  /** Average of (your strokes - theirs) over the compared rounds; negative means you are ahead. Null with none. */
  averageDiff: number | null;
  /** Your best round against them: the most strokes ahead (or fewest behind). Null with none. */
  bestRound: HeadToHeadRound | null;
  /** The compared rounds, newest first. */
  rounds: HeadToHeadRound[];
  lastPlayed: string;
};

const completeFor = (r: TogetherInput, scores: ScoreMap) => r.pars.length > 0 && isComplete(r.pars.length, [scores]);

/** One record for each friend you have shared a finished round with, the most recently played first. */
export function headToHead(rounds: TogetherInput[], myId: string): FriendRecord[] {
  const byFriend = new Map<string, FriendRecord & { nameAt: string }>();
  for (const r of rounds) {
    const me = r.players.find((p) => p.userId === myId);
    if (!me) continue;
    const seen = new Set<string>();
    for (const other of r.players) {
      if (!other.userId || other.userId === myId || seen.has(other.userId)) continue;
      seen.add(other.userId);
      const rec = byFriend.get(other.userId) ?? {
        userId: other.userId, name: other.name, roundsTogether: 0, compared: 0, wins: 0, ties: 0, losses: 0,
        averageDiff: null, bestRound: null, rounds: [], lastPlayed: r.startedAt, nameAt: '',
      };
      rec.roundsTogether++;
      if (r.startedAt >= rec.nameAt) {
        rec.name = other.name;
        rec.nameAt = r.startedAt;
      }
      if (r.startedAt > rec.lastPlayed) rec.lastPlayed = r.startedAt;
      if (completeFor(r, me.scores) && completeFor(r, other.scores)) {
        const myTotal = totalStrokes(me.scores);
        const theirTotal = totalStrokes(other.scores);
        const diff = myTotal - theirTotal;
        rec.compared++;
        if (diff < 0) rec.wins++;
        else if (diff > 0) rec.losses++;
        else rec.ties++;
        rec.rounds.push({ roundId: r.id, courseName: r.courseName, startedAt: r.startedAt, diff, myTotal, theirTotal });
      }
      byFriend.set(other.userId, rec);
    }
  }
  return [...byFriend.values()].map(({ nameAt: _nameAt, ...rec }) => {
    const rs = [...rec.rounds].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return {
      ...rec,
      rounds: rs,
      averageDiff: rs.length ? rs.reduce((sum, x) => sum + x.diff, 0) / rs.length : null,
      bestRound: rs.length ? rs.reduce((best, x) => (x.diff < best.diff ? x : best)) : null,
    };
  }).sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed) || a.name.localeCompare(b.name));
}

export type BoardEntry = {
  userId: string;
  name: string;
  isMe: boolean;
  /** Their best complete round on this layout. */
  total: number;
  relative: number;
  roundId: string;
  startedAt: string;
};

export type CourseBoard = {
  layoutId: string;
  courseName: string;
  holeCount: number;
  /** Best round first: fewest strokes, then the earlier round. */
  entries: BoardEntry[];
};

/**
 * Per layout, each person's best complete round among you and the friends you have shared a round with. Only
 * layouts where at least two people have a complete round are listed, since a board of one is just your own best.
 * Layouts are never mixed, even when two have the same course name.
 */
export function groupBoards(rounds: TogetherInput[], myId: string): CourseBoard[] {
  const friends = new Set(headToHead(rounds, myId).map((f) => f.userId));
  const boards = new Map<string, CourseBoard & {
    best: Map<string, BoardEntry>; names: Map<string, string>; nameAt: Map<string, string>;
  }>();
  for (const r of rounds) {
    if (!r.players.some((p) => p.userId === myId)) continue;
    for (const p of r.players) {
      if (!p.userId || (p.userId !== myId && !friends.has(p.userId))) continue;
      if (!completeFor(r, p.scores)) continue;
      const board = boards.get(r.layoutId) ?? {
        layoutId: r.layoutId, courseName: r.courseName, holeCount: r.pars.length, entries: [], best: new Map(),
        names: new Map(), nameAt: new Map(),
      };
      const entry: BoardEntry = {
        userId: p.userId, name: p.userId === myId ? 'You' : p.name, isMe: p.userId === myId,
        total: totalStrokes(p.scores), relative: relativeToPar(r.pars, p.scores), roundId: r.id, startedAt: r.startedAt,
      };
      const have = board.best.get(p.userId);
      if (!have || entry.total < have.total || (entry.total === have.total && entry.startedAt < have.startedAt)) {
        board.best.set(p.userId, entry);
      }
      // Show the name they use now, whichever round their best was.
      if (!entry.isMe && entry.startedAt >= (board.nameAt.get(p.userId) ?? '')) {
        board.nameAt.set(p.userId, entry.startedAt);
        board.names.set(p.userId, entry.name);
      }
      boards.set(r.layoutId, board);
    }
  }
  return [...boards.values()]
    .map(({ best, names, nameAt: _nameAt, ...board }) => ({
      ...board,
      entries: [...best.values()]
        .map((e) => (e.isMe ? e : { ...e, name: names.get(e.userId) ?? e.name }))
        .sort((a, b) => a.total - b.total || a.startedAt.localeCompare(b.startedAt)),
    }))
    .filter((b) => b.entries.length >= 2)
    .sort((a, b) => a.courseName.localeCompare(b.courseName));
}
