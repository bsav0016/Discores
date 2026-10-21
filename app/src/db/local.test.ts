import {
  GUEST_ID, createRound, deleteRound, finishPendingDelete, listDirtyRoundIds, listPendingDeleteIds, listRounds,
  listStatRounds, replaceSharedRounds, applyRestore, listRestoreState, setScore, wipeLocalData, finishRound, getRound,
} from './local';
import { planRestore } from '@/sync/restore';

// The real database code, run on Node's SQLite instead of expo-sqlite.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => require('./testDb').createTestDb(),
}));

const layout = { layout_id: 'L1', course_id: 'C1', course_name: 'Maple Hill', area: null, hole_count: 2, pars: [3, 3] };

async function ownRound(id: string, ownerId = 'me') {
  await createRound({
    id, ownerId, layout, startedAt: '2026-10-04T10:00:00Z',
    players: [{ id: `${id}-p0`, userId: ownerId, guestName: null, name: 'You' }],
  });
  await setScore(`${id}-p0`, id, 1, 3, '2026-10-04T10:05:00Z');
  await finishRound(id, '2026-10-04T11:00:00Z');
}

beforeEach(() => wipeLocalData());

describe('finishRound', () => {
  it('keeps the first finish time when a round is finished again', async () => {
    await ownRound('r1');
    await finishRound('r1', '2026-10-04T12:00:00Z');
    expect((await getRound('r1'))?.finished_at).toBe('2026-10-04T11:00:00Z');
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
