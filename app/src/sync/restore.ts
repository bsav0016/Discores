// Merging our own rounds from the server (pull_my_rounds) into the phone. Pure, so every case can be unit tested.

export type RemoteScore = { hole_number: number; strokes: number; updated_at: string };

export type RemoteRound = {
  id: string;
  layout_id: string;
  course_name: string;
  hole_count: number;
  pars: number[];
  started_at: string;
  finished_at: string | null;
  players: {
    id: string;
    position: number;
    user_id: string | null;
    guest_name: string | null;
    /** Display name of a registered player. */
    name: string | null;
    scores: RemoteScore[];
  }[];
};

export type PullMyRounds = { rounds: RemoteRound[]; deleted: string[] };

/** What the phone has for one of our own rounds. */
export type LocalRoundState = {
  id: string;
  dirty: boolean;
  pendingDelete: boolean;
  finishedAt: string | null;
  playerIds: string[];
  /** updated_at of each local score, keyed `${playerId}:${hole}`. */
  scores: Record<string, string>;
};

export type RestoreAction =
  | { type: 'insert'; round: RemoteRound }
  | { type: 'drop'; id: string }
  | {
      type: 'merge';
      id: string;
      finishedAt: string | null;
      players: RemoteRound['players'];
      scores: { playerId: string; hole: number; strokes: number; updatedAt: string }[];
    };

export const scoreKey = (playerId: string, hole: number) => `${playerId}:${hole}`;

const isNewer = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/**
 * Decides what to change on the phone.
 *  - Deleted on the server (tombstone): drop it here, even with unsynced edits; the server refuses to take it back.
 *  - Not on the phone: restore it (new phone, reinstall).
 *  - On the phone and in sync: take whatever the server has that is newer (another device scored more holes or
 *    finished the round). Scores are last-write-wins per hole by updated_at, the same rule the server uses.
 *  - On the phone with unsynced edits, or queued for delete: leave it. The next push sends our edits (the server
 *    merges them), and the pull after that picks up the result.
 */
export function planRestore(local: LocalRoundState[], pulled: PullMyRounds): RestoreAction[] {
  const byId = new Map(local.map((r) => [r.id, r]));
  const actions: RestoreAction[] = [];
  const deleted = new Set(pulled.deleted);

  for (const id of deleted) {
    if (byId.has(id)) actions.push({ type: 'drop', id });
  }

  for (const remote of pulled.rounds) {
    if (deleted.has(remote.id)) continue;
    const mine = byId.get(remote.id);
    if (!mine) {
      actions.push({ type: 'insert', round: remote });
      continue;
    }
    if (mine.dirty || mine.pendingDelete) continue;

    const have = new Set(mine.playerIds);
    const players = remote.players.filter((p) => !have.has(p.id));
    const scores = remote.players.flatMap((p) =>
      p.scores
        .filter((s) => {
          const local = mine.scores[scoreKey(p.id, s.hole_number)];
          return local === undefined || isNewer(s.updated_at, local);
        })
        .map((s) => ({ playerId: p.id, hole: s.hole_number, strokes: s.strokes, updatedAt: s.updated_at })));
    const finishedAt = mine.finishedAt === null && remote.finished_at !== null ? remote.finished_at : null;

    if (players.length || scores.length || finishedAt) {
      actions.push({ type: 'merge', id: remote.id, finishedAt, players, scores });
    }
  }
  return actions;
}
