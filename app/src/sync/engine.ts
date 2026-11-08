export type SyncSource = {
  round: {
    id: string; layout_id: string; started_at: string; finished_at: string | null; rev: number;
    /** The pars this round was played with. The local database stores them as JSON text. */
    pars?: number[] | string | null;
  };
  players: { id: string; user_id: string | null; guest_name: string | null; name?: string | null; position: number }[];
  scores: { round_player_id: string; hole_number: number; strokes: number; updated_at: string }[];
};

/** The round's pars as an array of numbers, or undefined when there are none worth sending. */
function roundPars(raw: SyncSource['round']['pars']): number[] | undefined {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return undefined; }
  }
  return Array.isArray(value) && value.length > 0 && value.every((n) => Number.isInteger(n)) ? (value as number[]) : undefined;
}

/** Shape expected by the sync_round() Postgres function. */
export function buildSyncPayload(src: SyncSource) {
  const pars = roundPars(src.round.pars);
  return {
    round: {
      id: src.round.id,
      layout_id: src.round.layout_id,
      started_at: src.round.started_at,
      finished_at: src.round.finished_at,
      // The holes and pars this round was played with (the server keeps them with the round, so a later change to
      // the course does not rewrite it). Left out when unknown; the server then keeps what it has.
      ...(pars ? { pars } : {}),
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

/** 'offline': the server was not reached (try again later). 'rejected': the server answered and refused the round. */
export type SyncErrorKind = 'offline' | 'rejected';
export type SyncFailure = { kind: SyncErrorKind; message: string };

const MAX_MESSAGE = 200;

/**
 * Tells a network failure from a refusal. supabase-js returns the server's refusals (Postgres errors, auth errors)
 * with a non-empty `code`; a request that never got an answer has none, and a thrown exception is always a
 * network problem.
 */
export function classifySyncError(error: unknown, thrown = false): SyncFailure {
  const e = (error ?? {}) as { message?: unknown; code?: unknown };
  const message = (typeof e.message === 'string' ? e.message : String(error ?? 'unknown')).slice(0, MAX_MESSAGE);
  const answered = !thrown && typeof e.code === 'string' && e.code.length > 0;
  return { kind: answered ? 'rejected' : 'offline', message };
}

export type SyncDeps = {
  listDirtyRoundIds: () => Promise<string[]>;
  getSource: (roundId: string) => Promise<SyncSource>;
  push: (payload: ReturnType<typeof buildSyncPayload>) => Promise<{ error: unknown | null }>;
  markSynced: (roundId: string, rev: number) => Promise<void>;
  /** Remembers why the latest attempt to sync this round failed. markSynced clears it. */
  recordFailure: (roundId: string, failure: SyncFailure) => Promise<void>;
  /** Rounds the user deleted that the server has not been told about yet. */
  listPendingDeleteIds: () => Promise<string[]>;
  /** Calls delete_round(): resolves with its answer ('ok', 'not_found', 'not_signed_in'). */
  deleteRemote: (roundId: string) => Promise<{ result: string | null; error: unknown | null }>;
  finishDelete: (roundId: string) => Promise<void>;
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

/**
 * Tells the server about deleted rounds, then forgets them locally. 'not_found' counts as done: the round was never
 * synced, or is already gone. Anything else (offline, signed out) leaves it queued for the next pass.
 */
async function runDeletes(deps: SyncDeps): Promise<number> {
  let failed = 0;
  for (const id of await deps.listPendingDeleteIds()) {
    try {
      const { result, error } = await deps.deleteRemote(id);
      if (error || (result !== 'ok' && result !== 'not_found')) {
        failed++;
        continue;
      }
      await deps.finishDelete(id);
    } catch {
      failed++; // offline or transient; stays queued
    }
  }
  return failed;
}

async function run(deps: SyncDeps): Promise<SyncResult> {
  // Deletes go first, so a round the user just deleted is never pushed again by the loop below.
  const result: SyncResult = { pushed: 0, failed: await runDeletes(deps) };
  for (const id of await deps.listDirtyRoundIds()) {
    try {
      const src = await deps.getSource(id);
      const { error } = await deps.push(buildSyncPayload(src));
      if (error) {
        result.failed++;
        await remember(deps, id, classifySyncError(error));
        continue;
      }
      await deps.markSynced(id, src.round.rev);
      result.pushed++;
    } catch (e) {
      result.failed++; // offline or transient; stays dirty
      await remember(deps, id, classifySyncError(e, true));
    }
  }
  return result;
}

/** Saving the reason must never turn one failed round into a failed run. */
async function remember(deps: SyncDeps, id: string, failure: SyncFailure) {
  try {
    await deps.recordFailure(id, failure);
  } catch {
    // The round stays dirty either way.
  }
}
