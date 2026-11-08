import { buildSyncPayload, classifySyncError, syncDirtyRounds, type SyncDeps, type SyncSource } from './engine';

const src = (id: string, rev = 1): SyncSource => ({
  round: { id, layout_id: 'L1', started_at: '2026-10-04T10:00:00Z', finished_at: null, rev },
  players: [{ id: `${id}-p0`, user_id: 'u1', guest_name: null, position: 0 }],
  scores: [{ round_player_id: `${id}-p0`, hole_number: 1, strokes: 3, updated_at: '2026-10-04T10:05:00Z' }],
});

function deps(over: Partial<SyncDeps> = {}): SyncDeps & { synced: [string, number][] } {
  const synced: [string, number][] = [];
  return {
    synced,
    listPendingDeleteIds: async () => [],
    deleteRemote: async () => ({ result: 'ok', error: null }),
    finishDelete: async () => {},
    listDirtyRoundIds: async () => ['a', 'b'],
    getSource: async (id) => src(id, id === 'a' ? 2 : 5),
    push: async () => ({ error: null }),
    markSynced: async (id, rev) => void synced.push([id, rev]),
    recordFailure: async () => {},
    ...over,
  };
}

describe('buildSyncPayload', () => {
  it('maps a local round to the RPC payload without leaking local-only fields', () => {
    const p = buildSyncPayload(src('a'));
    expect(p.round).toEqual({
      id: 'a', layout_id: 'L1', started_at: '2026-10-04T10:00:00Z', finished_at: null,
    });
    expect(p.scores[0]).toEqual({
      round_player_id: 'a-p0', hole_number: 1, strokes: 3, updated_at: '2026-10-04T10:05:00Z',
    });
  });
});

describe('buildSyncPayload pars', () => {
  it("sends the round's own pars, whether they are an array or the local JSON text", () => {
    const asArray = src('a');
    asArray.round.pars = [3, 4, 3];
    expect(buildSyncPayload(asArray).round.pars).toEqual([3, 4, 3]);
    const asText = src('a');
    asText.round.pars = '[4,3,3,5]';
    expect(buildSyncPayload(asText).round.pars).toEqual([4, 3, 3, 5]);
  });

  it('leaves pars out when there are none, so the server keeps what it has', () => {
    for (const pars of [undefined, null, '', '[]', 'not json', '[3,"x"]', [], [3.5]] as any[]) {
      const s = src('a');
      s.round.pars = pars;
      expect('pars' in buildSyncPayload(s).round).toBe(false);
    }
  });
});

describe('buildSyncPayload players', () => {
  it('sends the display name of registered players as a fallback for the server', () => {
    const s = src('a');
    s.players = [
      { id: 'p0', user_id: 'me', guest_name: null, name: 'You', position: 0 },
      { id: 'p1', user_id: 'friend', guest_name: null, name: 'Sam', position: 1 },
      { id: 'p2', user_id: null, guest_name: 'Alex', position: 2 },
    ];
    expect(buildSyncPayload(s).players).toEqual([
      { id: 'p0', user_id: 'me', guest_name: null, name: 'You', position: 0 },
      { id: 'p1', user_id: 'friend', guest_name: null, name: 'Sam', position: 1 },
      { id: 'p2', user_id: null, guest_name: 'Alex', name: null, position: 2 },
    ]);
  });
});

describe('syncDirtyRounds', () => {
  it('pushes dirty rounds and marks them synced at the pushed revision', async () => {
    const d = deps();
    expect(await syncDirtyRounds(d)).toEqual({ pushed: 2, failed: 0 });
    expect(d.synced).toEqual([['a', 2], ['b', 5]]);
  });

  it('leaves a round dirty when offline, and keeps going', async () => {
    const d = deps({
      push: async (p) => {
        if (p.round.id === 'a') throw new Error('Network request failed');
        return { error: null };
      },
    });
    expect(await syncDirtyRounds(d)).toEqual({ pushed: 1, failed: 1 });
    expect(d.synced).toEqual([['b', 5]]);
  });

  it('treats a server error as a failure and does not mark synced', async () => {
    const d = deps({ push: async () => ({ error: { message: 'rls' } }) });
    expect(await syncDirtyRounds(d)).toEqual({ pushed: 0, failed: 2 });
    expect(d.synced).toEqual([]);
  });

  it('shares one result between concurrent callers and queues a single follow-up pass', async () => {
    let calls = 0;
    const d = deps({
      listDirtyRoundIds: async () => {
        calls++;
        return ['a'];
      },
    });
    const p1 = syncDirtyRounds(d);
    const p2 = syncDirtyRounds(d);
    const p3 = syncDirtyRounds(d);
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    await p1;
    expect(calls).toBe(2); // the in-flight run plus one rerun, however many callers piled on
  });

  it('picks up an edit made while a push is in flight', async () => {
    const dirty = new Set(['a']);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const d = deps({
      listDirtyRoundIds: async () => [...dirty],
      push: async () => {
        if (first) {
          first = false;
          await gate;
        }
        return { error: null };
      },
      markSynced: async (id) => void dirty.delete(id),
    });
    const run = syncDirtyRounds(d);
    await Promise.resolve();
    dirty.add('b'); // scored a hole mid-push
    const late = syncDirtyRounds(d);
    release();
    await Promise.all([run, late]);
    expect(dirty.size).toBe(0);
  });
});

describe('syncDirtyRounds deletes', () => {
  it('tells the server about a deleted round, then forgets it locally', async () => {
    const calls: string[] = [];
    const d = deps({
      listDirtyRoundIds: async () => [],
      listPendingDeleteIds: async () => ['gone'],
      deleteRemote: async (id) => (calls.push(`remote ${id}`), { result: 'ok', error: null }),
      finishDelete: async (id) => void calls.push(`local ${id}`),
    });
    expect(await syncDirtyRounds(d)).toEqual({ pushed: 0, failed: 0 });
    expect(calls).toEqual(['remote gone', 'local gone']);
  });

  it('treats not_found as done: the round never reached the server', async () => {
    const finished: string[] = [];
    const d = deps({
      listDirtyRoundIds: async () => [],
      listPendingDeleteIds: async () => ['never-synced'],
      deleteRemote: async () => ({ result: 'not_found', error: null }),
      finishDelete: async (id) => void finished.push(id),
    });
    expect(await syncDirtyRounds(d)).toEqual({ pushed: 0, failed: 0 });
    expect(finished).toEqual(['never-synced']);
  });

  it('keeps the delete queued when offline, signed out or erroring, and keeps going', async () => {
    const finished: string[] = [];
    const d = deps({
      listDirtyRoundIds: async () => [],
      listPendingDeleteIds: async () => ['offline', 'signed-out', 'error', 'fine'],
      deleteRemote: async (id) => {
        if (id === 'offline') throw new Error('Network request failed');
        if (id === 'signed-out') return { result: 'not_signed_in', error: null };
        if (id === 'error') return { result: null, error: new Error('500') };
        return { result: 'ok', error: null };
      },
      finishDelete: async (id) => void finished.push(id),
    });
    expect(await syncDirtyRounds(d)).toEqual({ pushed: 0, failed: 3 });
    expect(finished).toEqual(['fine']);
  });

  it('processes deletes before pushing, so a deleted round is not pushed again', async () => {
    const order: string[] = [];
    const d = deps({
      listDirtyRoundIds: async () => ['a'],
      listPendingDeleteIds: async () => ['gone'],
      deleteRemote: async () => (order.push('delete'), { result: 'ok', error: null }),
      push: async () => (order.push('push'), { error: null }),
    });
    await syncDirtyRounds(d);
    expect(order).toEqual(['delete', 'push']);
  });
});

describe('sync failures', () => {
  it('tells a refusal (error with a code) from a network failure (no code, or thrown)', () => {
    expect(classifySyncError({ message: 'round belongs to another user', code: 'P0001' })).toEqual({
      kind: 'rejected', message: 'round belongs to another user',
    });
    expect(classifySyncError({ message: 'TypeError: Network request failed', code: '' }).kind).toBe('offline');
    expect(classifySyncError(new Error('boom'), true).kind).toBe('offline');
    expect(classifySyncError({ message: 'x', code: 'P0001' }, true).kind).toBe('offline');
  });

  it('caps the stored message', () => {
    expect(classifySyncError({ message: 'x'.repeat(500), code: 'P0001' }).message).toHaveLength(200);
  });

  it('records why each round failed and keeps going', async () => {
    const recorded: [string, string][] = [];
    const d = deps({
      push: async (p) => (p.round.id === 'a'
        ? { error: { message: 'nope', code: 'P0001' } }
        : { error: { message: 'Network request failed', code: '' } }),
      recordFailure: async (id, f) => void recorded.push([id, f.kind]),
    });
    expect(await syncDirtyRounds(d)).toEqual({ pushed: 0, failed: 2 });
    expect(recorded).toEqual([['a', 'rejected'], ['b', 'offline']]);
  });

  it('records a thrown push as offline, and a failing recorder does not break the run', async () => {
    const recorded: string[] = [];
    const d = deps({
      push: async (p) => { if (p.round.id === 'a') throw new Error('offline'); return { error: null }; },
      recordFailure: async (id, f) => { recorded.push(`${id}:${f.kind}`); throw new Error('disk'); },
    });
    expect(await syncDirtyRounds(d)).toEqual({ pushed: 1, failed: 1 });
    expect(recorded).toEqual(['a:offline']);
  });
});
