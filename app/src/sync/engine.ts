export type SyncSource = {
  round: { id: string; layout_id: string; started_at: string; finished_at: string | null; rev: number };
  players: { id: string; user_id: string | null; guest_name: string | null; name?: string | null; position: number }[];
  scores: { round_player_id: string; hole_number: number; strokes: number; updated_at: string }[];
};

/** Shape expected by the sync_round() Postgres function. */
export function buildSyncPayload(src: SyncSource) {
  return {
    round: {
      id: src.round.id,
      layout_id: src.round.layout_id,
      started_at: src.round.started_at,
      finished_at: src.round.finished_at,
    },
    players: src.players.map((p) => ({
      id: p.id,
      user_id: p.user_id,
      guest_name: p.guest_name,
      // Display name of a registered player. The server only keeps it if that person turns out not to be
      // an accepted friend any more (they become a guest with this name instead of blocking the sync).
      name: p.name ?? null,
      position: p.position,
    })),
    scores: src.scores.map((s) => ({
      round_player_id: s.round_player_id,
      hole_number: s.hole_number,
      strokes: s.strokes,
      updated_at: s.updated_at,
    })),
  };
}

export type SyncDeps = {
  listDirtyRoundIds: () => Promise<string[]>;
  getSource: (roundId: string) => Promise<SyncSource>;
  push: (payload: ReturnType<typeof buildSyncPayload>) => Promise<{ error: unknown | null }>;
  markSynced: (roundId: string, rev: number) => Promise<void>;
};

export type SyncResult = { pushed: number; failed: number };

let running: Promise<SyncResult> | null = null;
let rerunRequested = false;

/**
 * Pushes every dirty round. Safe to call repeatedly (e.g. on app foreground, network regain, after each
 * scored hole): concurrent calls share one result, the server upsert is idempotent, and a failed round
 * stays dirty so it is retried next time without blocking the others.
 *
 * A call that arrives while a run is in flight may be reporting an edit the run already skipped past, so it
 * queues exactly one follow-up pass instead of being dropped.
 */
export function syncDirtyRounds(deps: SyncDeps): Promise<SyncResult> {
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    try {
      const total = await run(deps);
      while (rerunRequested) {
        rerunRequested = false;
        const next = await run(deps);
        total.pushed += next.pushed;
        total.failed += next.failed;
      }
      return total;
    } finally {
      running = null;
      rerunRequested = false;
    }
  })();
  return running;
}

async function run(deps: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, failed: 0 };
  for (const id of await deps.listDirtyRoundIds()) {
    try {
      const src = await deps.getSource(id);
      const { error } = await deps.push(buildSyncPayload(src));
      if (error) {
        result.failed++;
        continue;
      }
      await deps.markSynced(id, src.round.rev);
      result.pushed++;
    } catch {
      result.failed++; // offline or transient; stays dirty
    }
  }
  return result;
}
