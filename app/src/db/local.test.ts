import {
  GUEST_ID, createRound, deleteRound, finishPendingDelete, listDirtyRoundIds, listPendingDeleteIds, listRounds,
  listStatRounds, replaceSharedRounds, setScore, wipeLocalData, finishRound, getRound,
} from './local';

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
