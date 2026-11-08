import {
  GUEST_ID, createRound, deleteRound, finishPendingDelete, listDirtyRoundIds, listPendingDeleteIds, listRounds,
  listStatRounds, recordSyncFailure, markSynced, listLayouts, upsertLayout, replaceLayouts, setRoundPars, getSyncSource, isLayoutVerified, listPendingSuggestions, clearSuggestion, replaceSharedRounds, applyRestore, listRestoreState, setScore, wipeLocalData, finishRound, getRound,
} from './local';
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
