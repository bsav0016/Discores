import {
  GUEST_ID, createRound, deleteRound, finishPendingDelete, listDirtyRoundIds, listPendingDeleteIds, listRounds,
  listStatRounds, recordSyncFailure, markSynced, listLayouts, upsertLayout, replaceLayouts, setRoundPars, getSyncSource, isLayoutVerified, listPendingSuggestions, clearSuggestion, replaceSharedRounds, applyRestore, listRestoreState, setScore, wipeLocalData, finishRound, getRound,
  applyLive, getLiveSeat, listDirtyLiveRoundIds, listLiveState, setLiveScore, listTogetherRounds,
} from './local';
import { planLive, type LiveRemoteRound } from '@/sync/live';
import { planRestore } from '@/sync/restore';

// The real database code, run on Node's SQLite instead of expo-sqlite.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => require('./testDb').createTestDb(),
}));

const layout = { layout_id: 'L1', course_id: 'C1', course_name: 'Maple Hill', area: null, hole_count: 2, pars: [3, 3], verified: false };

async function ownRound(id: string, ownerId = 'me') {
  await createRound({
    id, ownerId, layout, startedAt: '2026-10-04T10:00:00Z',
    players: [{ id: `${id}-p0`, userId: ownerId, guestName: null, name: 'You' }],
  });
  await setScore(`${id}-p0`, id, 1, 3, '2026-10-04T10:05:00Z');
  await finishRound(id, '2026-10-04T11:00:00Z');
}

beforeEach(() => wipeLocalData());

describe('layouts', () => {
  it('stores the verified flag and updates it when the course is confirmed later', async () => {
    await upsertLayout(layout);
    expect((await listLayouts())[0].verified).toBe(false);

    await upsertLayout({ ...layout, verified: true, pars: [4, 3] });
    const [row] = await listLayouts();
    expect(row).toMatchObject({ verified: true, pars: [4, 3] });
  });

  it('keeps the flag when the cache is replaced', async () => {
    await replaceLayouts([{ ...layout, verified: true }]);
    expect((await listLayouts())[0].verified).toBe(true);
  });
});

describe('finishRound', () => {
  it('keeps the first finish time when a round is finished again', async () => {
    await ownRound('r1');
    await finishRound('r1', '2026-10-04T12:00:00Z');
    expect((await getRound('r1'))?.finished_at).toBe('2026-10-04T11:00:00Z');
  });
});

describe('sync failures', () => {
  it('keeps the reason a round failed to sync and clears it once the round syncs', async () => {
    await ownRound('r1');
    expect((await listRounds('me'))[0].sync_error).toBeNull();

    await recordSyncFailure('r1', { kind: 'rejected', message: 'round belongs to another user' });
    expect((await listRounds('me'))[0].sync_error).toMatchObject({ kind: 'rejected', message: 'round belongs to another user' });
    expect((await getRound('r1'))?.sync_error?.kind).toBe('rejected');

    const { round } = await getSyncSource('r1');
    await markSynced('r1', round.rev);
    const [row] = await listRounds('me');
    expect(row.dirty).toBe(false);
    expect(row.sync_error).toBeNull();
  });

  it('keeps the error when a newer edit means the round is still dirty', async () => {
    await ownRound('r1');
    await recordSyncFailure('r1', { kind: 'offline', message: 'x' });
    await markSynced('r1', -1);
    expect((await listRounds('me'))[0].sync_error?.kind).toBe('offline');
  });
});

describe('deleteRound', () => {
  it('hides one of your own rounds everywhere and queues the delete for the server', async () => {
    await ownRound('r1');
    await ownRound('r2');

    expect(await deleteRound('r1')).toBe('queued');

    expect((await listRounds('me')).map((r) => r.id)).toEqual(['r2']);
    expect((await listStatRounds('me')).map((r) => r.id)).toEqual(['r2']);
    expect(await listDirtyRoundIds('me')).toEqual(['r2']); // the deleted round is never pushed again
    expect(await listPendingDeleteIds('me')).toEqual(['r1']);
  });

  it('keeps the round on the phone until the server has confirmed the delete', async () => {
    await ownRound('r1');
    await deleteRound('r1');
    expect(await getRound('r1')).not.toBeNull();

    await finishPendingDelete('r1');

    expect(await getRound('r1')).toBeNull();
    expect(await listPendingDeleteIds('me')).toEqual([]);
  });

  it('removes a guest round at once, since it never left the phone', async () => {
    await ownRound('g1', GUEST_ID);
    expect(await deleteRound('g1')).toBe('removed');
    expect(await getRound('g1')).toBeNull();
    expect(await listPendingDeleteIds(GUEST_ID)).toEqual([]);
  });

  it('removes a round shared with you at once, and does not queue a server delete for it', async () => {
    await replaceSharedRounds('me', [{
      id: 's1', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
      started_at: '2026-10-04T10:00:00Z', finished_at: '2026-10-04T11:00:00Z',
      players: [{ id: 's1-p0', position: 0, is_me: true, name: 'You', scores: [] }],
    }]);
    expect(await deleteRound('s1')).toBe('removed');
    expect(await getRound('s1')).toBeNull();
    expect(await listPendingDeleteIds('me')).toEqual([]);
  });

  it('ignores a round that is not there', async () => {
    expect(await deleteRound('nope')).toBe('removed');
  });

  it('does not touch the other rounds of the same person', async () => {
    await ownRound('r1');
    await ownRound('r2');
    await deleteRound('r1');
    await finishPendingDelete('r1');
    expect((await getRound('r2'))?.players[0].scores).toEqual({ 1: 3 });
  });
});

describe('restoring your own rounds', () => {
  const pulled = {
    rounds: [{
      id: 'r1', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
      started_at: '2026-10-04T10:00:00+00:00', finished_at: '2026-10-04T11:00:00+00:00',
      players: [
        { id: 'r1-p0', position: 0, user_id: 'me', guest_name: null, name: 'Me',
          scores: [{ hole_number: 1, strokes: 3, updated_at: '2026-10-04T10:05:00+00:00' }] },
        { id: 'r1-p1', position: 1, user_id: null, guest_name: 'Janet', name: null,
          scores: [{ hole_number: 1, strokes: 4, updated_at: '2026-10-04T10:05:00+00:00' }] },
      ],
    }],
    deleted: [] as string[],
  };

  it('puts a round on an empty phone as your own, in sync, and shows it in history and stats', async () => {
    await applyRestore('me', planRestore(await listRestoreState('me'), pulled));

    const round = await getRound('r1');
    expect(round).toMatchObject({ owner_id: 'me', dirty: false, shared: false, finished_at: '2026-10-04T11:00:00+00:00' });
    expect(round!.players.map((p) => [p.display_name, p.scores[1]])).toEqual([['You', 3], ['Janet', 4]]);
    expect((await listRounds('me')).map((r) => r.id)).toEqual(['r1']);
    expect((await listStatRounds('me')).map((r) => r.id)).toEqual(['r1']);
    expect(await listDirtyRoundIds('me')).toEqual([]); // nothing to push back
  });

  it('is repeatable: a second pull of the same data changes nothing', async () => {
    await applyRestore('me', planRestore(await listRestoreState('me'), pulled));
    expect(planRestore(await listRestoreState('me'), pulled)).toEqual([]);
  });

  it('merges a later score from another device without marking the round dirty', async () => {
    await applyRestore('me', planRestore(await listRestoreState('me'), pulled));
    const later = structuredClone(pulled);
    later.rounds[0].players[0].scores.push({ hole_number: 2, strokes: 5, updated_at: '2026-10-04T10:30:00+00:00' });

    await applyRestore('me', planRestore(await listRestoreState('me'), later));

    expect((await getRound('r1'))!.players[0].scores).toEqual({ 1: 3, 2: 5 });
    expect(await listDirtyRoundIds('me')).toEqual([]);
  });

  it('drops a round deleted on another device', async () => {
    await applyRestore('me', planRestore(await listRestoreState('me'), pulled));
    await applyRestore('me', planRestore(await listRestoreState('me'), { rounds: [], deleted: ['r1'] }));
    expect(await getRound('r1')).toBeNull();
  });

  it('replaces a stale read-only copy of the same round id', async () => {
    await replaceSharedRounds('me', [{
      id: 'r1', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
      started_at: '2026-10-04T10:00:00Z', finished_at: '2026-10-04T11:00:00Z',
      players: [{ id: 'old-p', position: 0, is_me: true, name: 'Me', scores: [] }],
    }]);
    await applyRestore('me', [{ type: 'insert', round: pulled.rounds[0] }]);
    expect(await getRound('r1')).toMatchObject({ shared: false });
  });
});

describe('setRoundPars', () => {
  async function openRound(id = 'e1') {
    await createRound({
      id, ownerId: 'me', layout, startedAt: '2026-10-04T10:00:00Z',
      players: [{ id: `${id}-p0`, userId: 'me', guestName: null, name: 'You' }],
    });
    return id;
  }
  const source = async (id: string) => (await getSyncSource(id)).round;

  it('changes the pars and hole count of a round in progress and queues it to sync', async () => {
    const id = await openRound();
    expect(await setRoundPars(id, [4, 3, 5])).toBeNull();
    const round = await getRound(id);
    expect(round).toMatchObject({ pars: [4, 3, 5], hole_count: 3, dirty: true });
    const row = await source(id);
    expect(row.pars_edited).toBe(1);
    expect(row.rev).toBeGreaterThan(0);
  });

  it('can shrink the round but not below a hole that has a score', async () => {
    const id = await openRound();
    await setScore(`${id}-p0`, id, 2, 4, '2026-10-04T10:05:00Z');
    expect(await setRoundPars(id, [3])).toMatch(/Hole 2 already has a score/);
    expect((await getRound(id))?.pars).toEqual([3, 3]);
    expect(await setRoundPars(id, [3, 4])).toBeNull();
  });

  it('refuses bad pars and leaves the round alone', async () => {
    const id = await openRound();
    expect(await setRoundPars(id, [])).toMatch(/1 to 36 holes/);
    expect(await setRoundPars(id, [3, 7])).toMatch(/between 2 and 6/);
    expect(await setRoundPars(id, [3, 1])).toMatch(/between 2 and 6/);
    expect((await getRound(id))?.pars).toEqual([3, 3]);
    expect((await source(id)).pars_edited).toBe(0);
  });

  it('does nothing when the pars are the same', async () => {
    const id = await openRound();
    const before = await source(id);
    expect(await setRoundPars(id, [3, 3])).toBeNull();
    const after = await source(id);
    expect([after.rev, after.pars_edited]).toEqual([before.rev, 0]);
  });

  it('leaves a finished round, a shared round and a missing round alone', async () => {
    await ownRound('f1');
    expect(await setRoundPars('f1', [4, 4])).toMatch(/in progress/);
    expect((await getRound('f1'))?.pars).toEqual([3, 3]);
    expect(await setRoundPars('nope', [3])).toMatch(/no longer exists/);
  });

  it('changes what the stats and history compare against', async () => {
    const id = await openRound();
    await setScore(`${id}-p0`, id, 1, 3, '2026-10-04T10:05:00Z');
    await setScore(`${id}-p0`, id, 2, 3, '2026-10-04T10:06:00Z');
    await setRoundPars(id, [4, 3]);
    await finishRound(id, '2026-10-04T11:00:00Z');
    expect((await listStatRounds('me'))[0].pars).toEqual([4, 3]);
  });
});

describe('isLayoutVerified', () => {
  it('reads the cached flag and is false for a layout that is not cached', async () => {
    expect(await isLayoutVerified('nope')).toBe(false);
    await upsertLayout({ ...layout, verified: true });
    expect(await isLayoutVerified('L1')).toBe(true);
    await upsertLayout({ ...layout, verified: false });
    expect(await isLayoutVerified('L1')).toBe(false);
  });
});

describe('pending suggestions', () => {
  async function edited(id: string, finish: boolean, ownerId = 'me') {
    await createRound({
      id, ownerId, layout, startedAt: '2026-10-04T10:00:00Z',
      players: [{ id: `${id}-p0`, userId: ownerId, guestName: null, name: 'You' }],
    });
    await setRoundPars(id, [4, 3, 5]);
    if (finish) await finishRound(id, `2026-10-0${id.length}T11:00:00Z`);
  }

  it('lists only finished rounds whose pars were edited, and clearing one removes it', async () => {
    await edited('a', true);
    await edited('bb', false);        // edited but still in progress
    await ownRound('c');              // finished, never edited
    const pending = await listPendingSuggestions('me');
    expect(pending.map((p) => p.roundId)).toEqual(['a']);
    expect(pending[0]).toMatchObject({ layoutId: 'L1', pars: [4, 3, 5] });

    await clearSuggestion('a');
    expect(await listPendingSuggestions('me')).toEqual([]);
  });

  it("does not list another person's rounds or a deleted round", async () => {
    await edited('a', true, 'someone-else');
    await edited('bb', true);
    await deleteRound('bb');
    expect(await listPendingSuggestions('me')).toEqual([]);
  });

  it('clearing does not queue a sync', async () => {
    await edited('a', true);
    await getSyncSource('a');
    const before = (await getSyncSource('a')).round;
    await clearSuggestion('a');
    const after = (await getSyncSource('a')).round;
    expect([after.rev, after.dirty]).toEqual([before.rev, before.dirty]);
  });
});

describe('live rounds', () => {
  const liveRound = (over: Partial<LiveRemoteRound> = {}): LiveRemoteRound => ({
    id: 'lr', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
    started_at: '2026-11-15T10:00:00Z', finished_at: null, is_owner: false, owner_name: 'Brian',
    players: [
      { id: 'pb', position: 0, is_me: false, name: 'Brian', scores: [{ hole_number: 1, strokes: 3, updated_at: '2026-11-15T10:05:00Z' }] },
      { id: 'pm', position: 1, is_me: true, name: 'Me', scores: [] },
    ],
    ...over,
  });

  async function follow(round = liveRound()) {
    await applyLive('me', planLive(await listLiveState('me'), [round]));
  }

  it("follows a friend's round: stored read-only, clean, with the owner's name", async () => {
    await follow();
    const r = await getRound('lr');
    expect(r).toMatchObject({ shared: true, live: true, dirty: false, owner_name: 'Brian', finished_at: null });
    expect(r?.players.find((p) => p.id === 'pm')?.display_name).toBe('You');
    expect(r?.players.find((p) => p.id === 'pb')?.scores).toEqual({ 1: 3 });
    expect(await listDirtyRoundIds('me')).toEqual([]);
  });

  it('lets us write our own seat only, queues it for sync, and never as a normal round push', async () => {
    await follow();
    expect(await setLiveScore('lr', 1, 4, '2026-11-15T10:10:00Z')).toBe(true);
    expect((await getRound('lr'))?.players.find((p) => p.id === 'pm')?.scores).toEqual({ 1: 4 });
    expect((await getRound('lr'))?.players.find((p) => p.id === 'pb')?.scores).toEqual({ 1: 3 });
    expect(await listDirtyLiveRoundIds('me')).toEqual(['lr']);
    expect(await listDirtyRoundIds('me')).toEqual([]); // sync_round would be refused for a round we do not own
    const seat = await getLiveSeat('lr');
    expect(seat.scores).toEqual([{ hole_number: 1, strokes: 4, updated_at: '2026-11-15T10:10:00Z' }]);
    await markSynced('lr', seat.rev);
    expect(await listDirtyLiveRoundIds('me')).toEqual([]);
  });

  it('refuses to write a round that is not live, is finished, or has no seat for us', async () => {
    await ownRound('mine');
    expect(await setLiveScore('mine', 1, 4, 'T')).toBe(false);
    expect(await setLiveScore('missing', 1, 4, 'T')).toBe(false);
    await follow(liveRound({ players: [{ id: 'pb', position: 0, is_me: false, name: 'Brian', scores: [] }] }));
    expect(await setLiveScore('lr', 1, 4, 'T')).toBe(false);
    await wipeLocalData();
    await follow();
    await finishRound('lr', '2026-11-15T12:00:00Z');
    expect(await setLiveScore('lr', 1, 4, 'T')).toBe(false);
  });

  it("a pull merges the others' scores without touching dirty or our own newer score", async () => {
    await follow();
    await setLiveScore('lr', 1, 4, '2026-11-15T10:10:00Z');
    const before = await getSyncSource('lr');
    await follow(liveRound({
      players: [
        { id: 'pb', position: 0, is_me: false, name: 'Brian', scores: [
          { hole_number: 1, strokes: 3, updated_at: '2026-11-15T10:05:00Z' },
          { hole_number: 2, strokes: 6, updated_at: '2026-11-15T10:20:00Z' }] },
        { id: 'pm', position: 1, is_me: true, name: 'Me', scores: [{ hole_number: 1, strokes: 9, updated_at: '2026-11-15T10:01:00Z' }] },
      ],
    }));
    const r = await getRound('lr');
    expect(r?.players.find((p) => p.id === 'pb')?.scores).toEqual({ 1: 3, 2: 6 });
    expect(r?.players.find((p) => p.id === 'pm')?.scores).toEqual({ 1: 4 });
    expect(r).toMatchObject({ dirty: true });
    expect((await getSyncSource('lr')).round.rev).toBe(before.round.rev);
  });

  it("on the owner's phone a pull brings in the friend's score and does not queue a push", async () => {
    await createRound({
      id: 'o2', ownerId: 'me', layout, startedAt: '2026-11-15T10:00:00Z',
      players: [{ id: 'o2-me', userId: 'me', guestName: null, name: 'You' }, { id: 'o2-j', userId: 'john', guestName: null, name: 'John' }],
    });
    const { round } = await getSyncSource('o2');
    await markSynced('o2', round.rev);
    await applyLive('me', planLive(await listLiveState('me'), [liveRound({
      id: 'o2', is_owner: true,
      players: [
        { id: 'o2-me', position: 0, is_me: true, name: 'Me', scores: [] },
        { id: 'o2-j', position: 1, is_me: false, name: 'John', scores: [{ hole_number: 1, strokes: 5, updated_at: '2026-11-15T10:05:00Z' }] },
      ],
    })]));
    expect((await getRound('o2'))?.players.find((p) => p.id === 'o2-j')?.scores).toEqual({ 1: 5 });
    expect((await getRound('o2'))?.dirty).toBe(false);
  });

  it('forgets a followed round the server stops listing, but keeps one with unsent scores', async () => {
    await follow();
    await applyLive('me', planLive(await listLiveState('me'), []));
    expect(await getRound('lr')).toBeNull();

    await follow();
    await setLiveScore('lr', 1, 4, '2026-11-15T10:10:00Z');
    await applyLive('me', planLive(await listLiveState('me'), []));
    expect(await getRound('lr')).not.toBeNull();
  });

  it('moves into history when the finished round arrives, but not while our scores are unsent', async () => {
    const finished = {
      id: 'lr', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
      started_at: '2026-11-15T10:00:00Z', finished_at: '2026-11-15T12:00:00Z',
      players: [{ id: 'pm', position: 0, is_me: true, name: 'Me', scores: [{ hole_number: 1, strokes: 4, updated_at: '2026-11-15T10:10:00Z' }] }],
    };
    await follow();
    await replaceSharedRounds('me', [finished]);
    expect(await getRound('lr')).toMatchObject({ live: false, shared: true, finished_at: '2026-11-15T12:00:00Z' });

    await wipeLocalData();
    await follow();
    await setLiveScore('lr', 1, 4, '2026-11-15T10:10:00Z');
    await replaceSharedRounds('me', [finished]);
    expect(await getRound('lr')).toMatchObject({ live: true, dirty: true });
  });

  it('a history refresh keeps rounds we follow', async () => {
    await follow();
    await replaceSharedRounds('me', []);
    expect(await getRound('lr')).not.toBeNull();
  });
});

describe('friends in shared rounds', () => {
  const shared = (over: Record<string, unknown> = {}) => ({
    id: 's1', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
    started_at: '2026-11-15T10:00:00Z', finished_at: '2026-11-15T12:00:00Z',
    players: [
      { id: 'sa', position: 0, is_me: false, user_id: 'friend-1', name: 'Brian', scores: [{ hole_number: 1, strokes: 3, updated_at: '2026-11-15T10:05:00Z' }] },
      { id: 'sm', position: 1, is_me: true, user_id: 'me', name: 'Me', scores: [{ hole_number: 1, strokes: 4, updated_at: '2026-11-15T10:06:00Z' }] },
      { id: 'sx', position: 2, is_me: false, name: 'Stranger', scores: [{ hole_number: 1, strokes: 5, updated_at: '2026-11-15T10:07:00Z' }] },
    ],
    ...over,
  });

  it("keeps a friend's account id and our own, and nothing for a player the server gave no id", async () => {
    await replaceSharedRounds('me', [shared()]);
    const r = await getRound('s1');
    expect(r?.players.map((p) => p.user_id)).toEqual(['friend-1', 'me', null]);
    expect(r?.players.find((p) => p.id === 'sa')?.display_name).toBe('Brian');
    expect(r?.players.find((p) => p.id === 'sm')?.display_name).toBe('You');
  });

  it('works with an older server that sends no user_id', async () => {
    await replaceSharedRounds('me', [shared({
      players: [{ id: 'sa', position: 0, is_me: false, name: 'Brian', scores: [] }, { id: 'sm', position: 1, is_me: true, name: 'Me', scores: [] }],
    })]);
    expect((await getRound('s1'))?.players.map((p) => p.user_id)).toEqual([null, 'me']);
  });

  it('adds the ids to a round already stored without them on the next history refresh', async () => {
    await replaceSharedRounds('me', [shared({ players: shared().players.map(({ user_id: _u, ...p }: any) => p) })]);
    expect((await getRound('s1'))?.players.map((p) => p.user_id)).toEqual([null, 'me', null]);
    await replaceSharedRounds('me', [shared()]);
    expect((await getRound('s1'))?.players.map((p) => p.user_id)).toEqual(['friend-1', 'me', null]);
  });

  it('stores a friend id for a seat in a round we follow live', async () => {
    await applyLive('me', planLive(await listLiveState('me'), [{
      id: 'lr', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
      started_at: '2026-11-15T10:00:00Z', finished_at: null, is_owner: false, owner_name: 'Brian',
      players: [
        { id: 'pb', position: 0, is_me: false, user_id: 'friend-1', name: 'Brian', scores: [] },
        { id: 'pm', position: 1, is_me: true, user_id: 'me', name: 'Me', scores: [] },
        { id: 'pg', position: 2, is_me: false, user_id: null, name: 'Gus', scores: [] },
      ],
    }]));
    expect((await getRound('lr'))?.players.map((p) => p.user_id)).toEqual(['friend-1', 'me', null]);
  });

  it('does not change what the stats and the history count as ours', async () => {
    await replaceSharedRounds('me', [shared()]);
    expect((await listStatRounds('me'))[0].scores).toEqual({ 1: 4 });
    expect((await listRounds('me'))[0]).toMatchObject({ total: 4, scored: 1 });
  });
});

describe('listTogetherRounds', () => {
  it('returns finished own and shared rounds with every seat, newest first, ids included', async () => {
    await createRound({
      id: 'o1', ownerId: 'me', layout, startedAt: '2026-11-01T10:00:00Z',
      players: [
        { id: 'o1-p0', userId: 'me', guestName: null, name: 'You' },
        { id: 'o1-p1', userId: 'friend-1', guestName: null, name: 'Brian' },
        { id: 'o1-p2', userId: null, guestName: 'Gus', name: null },
      ],
    });
    await setScore('o1-p0', 'o1', 1, 3, '2026-11-01T10:05:00Z');
    await setScore('o1-p1', 'o1', 1, 4, '2026-11-01T10:05:00Z');
    await setScore('o1-p2', 'o1', 1, 5, '2026-11-01T10:05:00Z');
    await finishRound('o1', '2026-11-01T11:00:00Z');
    await replaceSharedRounds('me', [{
      id: 's1', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
      started_at: '2026-11-15T10:00:00Z', finished_at: '2026-11-15T12:00:00Z',
      players: [
        { id: 'sa', position: 0, is_me: false, user_id: 'friend-1', name: 'Brian', scores: [{ hole_number: 1, strokes: 2, updated_at: '2026-11-15T10:05:00Z' }] },
        { id: 'sm', position: 1, is_me: true, user_id: 'me', name: 'Me', scores: [{ hole_number: 1, strokes: 4, updated_at: '2026-11-15T10:06:00Z' }] },
        { id: 'sx', position: 2, is_me: false, name: 'Stranger', scores: [] },
      ],
    }]);
    const rounds = await listTogetherRounds('me');
    expect(rounds.map((r) => r.id)).toEqual(['s1', 'o1']);
    expect(rounds[1]).toMatchObject({ layoutId: 'L1', courseName: 'Maple Hill', pars: [3, 3] });
    expect(rounds[1].players).toEqual([
      { userId: 'me', name: 'You', scores: { 1: 3 } },
      { userId: 'friend-1', name: 'Brian', scores: { 1: 4 } },
      { userId: null, name: 'Gus', scores: { 1: 5 } },
    ]);
    expect(rounds[0].players).toEqual([
      { userId: 'friend-1', name: 'Brian', scores: { 1: 2 } },
      { userId: 'me', name: 'You', scores: { 1: 4 } },
      { userId: null, name: 'Stranger', scores: {} },
    ]);
  });

  it('leaves out unfinished rounds, followed live rounds, rounds waiting to be deleted and other accounts', async () => {
    await createRound({
      id: 'open', ownerId: 'me', layout, startedAt: '2026-11-01T10:00:00Z',
      players: [{ id: 'open-p0', userId: 'me', guestName: null, name: 'You' }],
    });
    await ownRound('gone');
    await deleteRound('gone');
    await ownRound('theirs', 'someone-else');
    await applyLive('me', planLive(await listLiveState('me'), [{
      id: 'lr', layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
      started_at: '2026-11-15T10:00:00Z', finished_at: '2026-11-15T10:30:00Z', is_owner: false, owner_name: 'Brian',
      players: [{ id: 'pm', position: 0, is_me: true, user_id: 'me', name: 'Me', scores: [] }],
    }]));
    expect(await listTogetherRounds('me')).toEqual([]);
  });
});
