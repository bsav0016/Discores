// Live rounds: rounds that are still being played, scored on more than one phone. Pure logic, so every case can be
// unit tested; the database and network calls are passed in.
//
//  - The owner's phone scores everyone as it always did (sync_round). It also pulls what friends entered.
//  - A friend who opens the round on their own phone holds a copy (shared = 1, live = 1) and writes only their
//    own seat, through sync_my_seat. Every other seat on that copy is read-only.
//  - Scores merge per hole, the newer updated_at wins, the same rule the server uses, so a pull can never throw
//    away a local edit that is newer than what the server has.

export type LiveRemoteScore = { hole_number: number; strokes: number; updated_at: string };

/** One round from list_live_rounds(). */
export type LiveRemoteRound = {
  id: string;
  layout_id: string;
  course_name: string;
  hole_count: number;
  pars: number[];
  started_at: string;
  finished_at: string | null;
  is_owner: boolean;
  owner_name: string;
  players: {
    id: string; position: number; is_me: boolean; user_id?: string | null; name: string; scores: LiveRemoteScore[];
  }[];
};

/** What the phone holds for one round the signed-in user owns or follows. */
export type LiveLocalRound = {
  id: string;
  /** 'owned': our own round. 'live': someone else's round we follow. 'history': a finished shared round. */
  kind: 'owned' | 'live' | 'history';
  dirty: boolean;
  pendingDelete: boolean;
  finishedAt: string | null;
  playerIds: string[];
  /** updated_at of each local score, keyed `${playerId}:${hole}`. */
  scores: Record<string, string>;
};

export type LiveAction =
  | { type: 'insert'; round: LiveRemoteRound }
  | { type: 'drop'; id: string }
  | {
      type: 'merge';
      id: string;
      finishedAt: string | null;
      players: LiveRemoteRound['players'];
      scores: { playerId: string; hole: number; strokes: number; updatedAt: string }[];
    };

const key = (playerId: string, hole: number) => `${playerId}:${hole}`;
const isNewer = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/**
 * Decides what to change on the phone after list_live_rounds().
 *  - A live round we do not have yet, still unfinished: start following it. One that is already finished is left
 *    to the normal "confirm a finished round" flow.
 *  - A round we hold (ours, or one we follow): take every score the server has that is newer than ours. Seats we
 *    do not know yet are added to a followed round (never to our own: the owner's phone already has every seat).
 *    The finish time is the earliest one, as on the server.
 *  - A followed round the server no longer lists (finished long ago, deleted, we were removed or blocked) goes
 *    away, unless it holds scores we have not sent yet.
 *  - A finished round already in the user's history is never touched.
 */
export function planLive(local: LiveLocalRound[], remote: LiveRemoteRound[]): LiveAction[] {
  const byId = new Map(local.map((r) => [r.id, r]));
  const actions: LiveAction[] = [];
  const listed = new Set(remote.map((r) => r.id));

  for (const mine of local) {
    if (mine.kind === 'live' && !listed.has(mine.id) && !mine.dirty) actions.push({ type: 'drop', id: mine.id });
  }

  for (const round of remote) {
    const mine = byId.get(round.id);
    if (!mine) {
      if (!round.is_owner && round.finished_at === null) actions.push({ type: 'insert', round });
      continue;
    }
    if (mine.kind === 'history' || mine.pendingDelete) continue;

    const have = new Set(mine.playerIds);
    const players = mine.kind === 'live' ? round.players.filter((p) => !have.has(p.id)) : [];
    const scores = round.players.flatMap((p) =>
      p.scores
        .filter((s) => {
          const local = mine.scores[key(p.id, s.hole_number)];
          return local === undefined || isNewer(s.updated_at, local);
        })
        .map((s) => ({ playerId: p.id, hole: s.hole_number, strokes: s.strokes, updatedAt: s.updated_at })));
    const finishedAt =
      round.finished_at !== null && (mine.finishedAt === null || isNewer(mine.finishedAt, round.finished_at))
        ? round.finished_at
        : null;
    if (players.length || scores.length || finishedAt) {
      actions.push({ type: 'merge', id: round.id, finishedAt, players, scores });
    }
  }
  return actions;
}

// ------------------------------------------------------------ pushing our own seat

/** The scores of our own seat, in the shape sync_my_seat() takes. */
export function buildSeatPayload(
  scores: { hole_number: number; strokes: number; updated_at: string }[],
) {
  return scores.map((s) => ({ hole_number: s.hole_number, strokes: s.strokes, updated_at: s.updated_at }));
}

export type SeatDeps = {
  listDirtyLiveRoundIds: () => Promise<string[]>;
  /** Our own seat's scores in the round, and the revision they were read at. */
  getSeat: (roundId: string) => Promise<{ scores: { hole_number: number; strokes: number; updated_at: string }[]; rev: number }>;
  /** Calls sync_my_seat(): resolves with its answer ('ok', 'not_found', 'closed', 'not_signed_in'). */
  pushSeat: (roundId: string, scores: ReturnType<typeof buildSeatPayload>) => Promise<{ result: string | null; error: unknown | null }>;
  markSynced: (roundId: string, rev: number) => Promise<void>;
};

/**
 * Sends our own seat of every followed round that has unsent scores. 'ok' is done. 'closed' (the round ended more
 * than the grace window ago) and 'not_found' (removed, blocked, deleted) will never succeed, so they stop retrying
 * too. Anything else (offline, signed out, a server error) leaves the round dirty for the next pass. One failure
 * never blocks the others.
 */
export async function syncLiveSeats(deps: SeatDeps): Promise<{ pushed: number; failed: number }> {
  const out = { pushed: 0, failed: 0 };
  for (const id of await deps.listDirtyLiveRoundIds()) {
    try {
      const seat = await deps.getSeat(id);
      const { result, error } = await deps.pushSeat(id, buildSeatPayload(seat.scores));
      if (error || (result !== 'ok' && result !== 'closed' && result !== 'not_found')) {
        out.failed++;
        continue;
      }
      await deps.markSynced(id, seat.rev);
      out.pushed++;
    } catch {
      out.failed++; // offline or transient; stays dirty
    }
  }
  return out;
}
