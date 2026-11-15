import { buildSeatPayload, planLive, syncLiveSeats, type LiveLocalRound, type LiveRemoteRound } from './live';

const remote = (over: Partial<LiveRemoteRound> = {}): LiveRemoteRound => ({
  id: 'r1', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 3, pars: [3, 4, 3],
  started_at: '2026-11-15T10:00:00Z', finished_at: null, is_owner: false, owner_name: 'Brian',
  players: [
    { id: 'pb', position: 0, is_me: false, name: 'Brian', scores: [{ hole_number: 1, strokes: 3, updated_at: '2026-11-15T10:05:00Z' }] },
    { id: 'pj', position: 1, is_me: true, name: 'John', scores: [] },
  ],
  ...over,
});

const local = (over: Partial<LiveLocalRound> = {}): LiveLocalRound => ({
  id: 'r1', kind: 'live', dirty: false, pendingDelete: false, finishedAt: null, playerIds: ['pb', 'pj'], scores: {}, ...over,
});

describe('planLive', () => {
  it('starts following an unfinished round someone else owns', () => {
    expect(planLive([], [remote()])).toEqual([{ type: 'insert', round: remote() }]);
  });

  it('does not follow a round that is already finished (that is the confirm flow) or one we own and lack', () => {
    expect(planLive([], [remote({ finished_at: '2026-11-15T11:00:00Z' })])).toEqual([]);
    expect(planLive([], [remote({ is_owner: true })])).toEqual([]);
  });

  it('takes newer scores, keeps newer local ones, and adds new holes', () => {
    const l = local({ scores: { 'pb:1': '2026-11-15T10:01:00Z', 'pj:2': '2026-11-15T10:30:00Z' } });
    const r = remote({
      players: [
        { id: 'pb', position: 0, is_me: false, name: 'Brian', scores: [
          { hole_number: 1, strokes: 3, updated_at: '2026-11-15T10:05:00Z' },     // newer than ours: taken
          { hole_number: 2, strokes: 5, updated_at: '2026-11-15T10:06:00Z' }] },  // new hole: taken
        { id: 'pj', position: 1, is_me: true, name: 'John', scores: [
          { hole_number: 2, strokes: 9, updated_at: '2026-11-15T10:10:00Z' }] },  // older than our own edit: ignored
      ],
    });
    const [a] = planLive([l], [r]);
    expect(a).toMatchObject({ type: 'merge', id: 'r1', finishedAt: null, players: [] });
    expect((a as any).scores).toEqual([
      { playerId: 'pb', hole: 1, strokes: 3, updatedAt: '2026-11-15T10:05:00Z' },
      { playerId: 'pb', hole: 2, strokes: 5, updatedAt: '2026-11-15T10:06:00Z' },
    ]);
  });

  it('does nothing when the phone is already up to date', () => {
    const l = local({ scores: { 'pb:1': '2026-11-15T10:05:00Z' } });
    expect(planLive([l], [remote()])).toEqual([]);
  });

  it('the owner phone takes the friend\'s scores but never adds seats', () => {
    const l = local({ kind: 'owned', dirty: true, playerIds: ['pb'] });
    const r = remote({
      is_owner: true,
      players: [
        { id: 'pb', position: 0, is_me: true, name: 'Brian', scores: [] },
        { id: 'pj', position: 1, is_me: false, name: 'John',
          scores: [{ hole_number: 1, strokes: 4, updated_at: '2026-11-15T10:07:00Z' }] },
      ],
    });
    const [a] = planLive([l], [r]);
    expect((a as any).players).toEqual([]);
    expect((a as any).scores).toEqual([{ playerId: 'pj', hole: 1, strokes: 4, updatedAt: '2026-11-15T10:07:00Z' }]);
  });

  it('adds seats we do not know on a followed round', () => {
    const [a] = planLive([local({ playerIds: ['pb'] })], [remote()]);
    expect((a as any).players.map((p: any) => p.id)).toEqual(['pj']);
  });

  it('takes the earliest finish time and never un-finishes', () => {
    const fin = '2026-11-15T12:00:00Z';
    expect((planLive([local()], [remote({ finished_at: fin })])[0] as any).finishedAt).toBe(fin);
    expect(planLive([local({ finishedAt: '2026-11-15T11:00:00Z', scores: { 'pb:1': '2026-11-15T10:05:00Z' } })],
                    [remote({ finished_at: fin })])).toEqual([]);
    expect((planLive([local({ finishedAt: fin, scores: { 'pb:1': '2026-11-15T10:05:00Z' } })],
                     [remote({ finished_at: '2026-11-15T11:00:00Z' })])[0] as any).finishedAt).toBe('2026-11-15T11:00:00Z');
  });

  it('drops a followed round the server no longer lists, unless it holds unsent scores', () => {
    expect(planLive([local()], [])).toEqual([{ type: 'drop', id: 'r1' }]);
    expect(planLive([local({ dirty: true })], [])).toEqual([]);
  });

  it('never drops our own round or a finished shared round that is not listed', () => {
    expect(planLive([local({ kind: 'owned' }), local({ id: 'r2', kind: 'history' })], [])).toEqual([]);
  });

  it('leaves history rounds and rounds queued for delete alone', () => {
    expect(planLive([local({ kind: 'history' })], [remote()])).toEqual([]);
    expect(planLive([local({ kind: 'owned', pendingDelete: true })], [remote({ is_owner: true })])).toEqual([]);
  });
});

describe('syncLiveSeats', () => {
  const seat = { scores: [{ hole_number: 1, strokes: 4, updated_at: 'T' }, { hole_number: 2, strokes: 5, updated_at: 'T' }], rev: 7 };

  function deps(answer: (id: string) => any) {
    const synced: [string, number][] = [];
    const sent: any[] = [];
    return {
      synced, sent,
      d: {
        listDirtyLiveRoundIds: async () => ['a', 'b'],
        getSeat: async () => seat,
        pushSeat: async (id: string, scores: any) => { sent.push([id, scores]); return answer(id); },
        markSynced: async (id: string, rev: number) => void synced.push([id, rev]),
      },
    };
  }

  it('sends only our own seat and marks the round synced at the revision it read', async () => {
    const x = deps(() => ({ result: 'ok', error: null }));
    expect(await syncLiveSeats(x.d)).toEqual({ pushed: 2, failed: 0 });
    expect(x.sent[0]).toEqual(['a', buildSeatPayload(seat.scores)]);
    expect(x.synced).toEqual([['a', 7], ['b', 7]]);
  });

  it('stops retrying a round that is closed or gone, but retries an error or an offline phone', async () => {
    const x = deps((id) => (id === 'a' ? { result: 'closed', error: null } : { result: null, error: { code: '500' } }));
    expect(await syncLiveSeats(x.d)).toEqual({ pushed: 1, failed: 1 });
    expect(x.synced).toEqual([['a', 7]]);

    const y = deps((id) => (id === 'a' ? { result: 'not_found', error: null } : { result: 'not_signed_in', error: null }));
    expect(await syncLiveSeats(y.d)).toEqual({ pushed: 1, failed: 1 });
  });

  it('one thrown failure does not block the next round', async () => {
    const x = deps((id) => { if (id === 'a') throw new TypeError('Network request failed'); return { result: 'ok', error: null }; });
    expect(await syncLiveSeats(x.d)).toEqual({ pushed: 1, failed: 1 });
    expect(x.synced).toEqual([['b', 7]]);
  });
});
