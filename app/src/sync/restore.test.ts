import { planRestore, scoreKey, type LocalRoundState, type RemoteRound } from './restore';

const T1 = '2026-10-04T10:05:00+00:00';
const T2 = '2026-10-04T10:20:00+00:00';

function remote(id: string, over: Partial<RemoteRound> = {}): RemoteRound {
  return {
    id, layout_id: 'L1', course_name: 'Maple Hill', hole_count: 2, pars: [3, 3],
    started_at: '2026-10-04T10:00:00+00:00', finished_at: null,
    players: [{ id: `${id}-p0`, position: 0, user_id: 'me', guest_name: null, name: 'Me',
                scores: [{ hole_number: 1, strokes: 3, updated_at: T1 }] }],
    ...over,
  };
}

function local(id: string, over: Partial<LocalRoundState> = {}): LocalRoundState {
  return {
    id, dirty: false, pendingDelete: false, finishedAt: null, playerIds: [`${id}-p0`],
    scores: { [scoreKey(`${id}-p0`, 1)]: T1 }, ...over,
  };
}

describe('planRestore', () => {
  it('restores rounds a new phone does not have', () => {
    const r = remote('r1');
    expect(planRestore([], { rounds: [r], deleted: [] })).toEqual([{ type: 'insert', round: r }]);
  });

  it('does nothing when the phone already matches the server', () => {
    expect(planRestore([local('r1')], { rounds: [remote('r1')], deleted: [] })).toEqual([]);
  });

  it('drops a round that was deleted on another device', () => {
    expect(planRestore([local('r1')], { rounds: [], deleted: ['r1'] })).toEqual([{ type: 'drop', id: 'r1' }]);
  });

  it('drops a deleted round even when the phone has unsynced edits, and never restores it', () => {
    const plan = planRestore([local('r1', { dirty: true })], { rounds: [remote('r1')], deleted: ['r1'] });
    expect(plan).toEqual([{ type: 'drop', id: 'r1' }]);
  });

  it('ignores tombstones for rounds this phone never had', () => {
    expect(planRestore([], { rounds: [], deleted: ['gone'] })).toEqual([]);
    expect(planRestore([], { rounds: [remote('gone')], deleted: ['gone'] })).toEqual([]);
  });

  it('takes holes and the finish from a second device when the phone is in sync', () => {
    const r = remote('r1', {
      finished_at: T2,
      players: [{ id: 'r1-p0', position: 0, user_id: 'me', guest_name: null, name: 'Me',
                  scores: [{ hole_number: 1, strokes: 3, updated_at: T1 }, { hole_number: 2, strokes: 4, updated_at: T2 }] }],
    });
    expect(planRestore([local('r1')], { rounds: [r], deleted: [] })).toEqual([
      { type: 'merge', id: 'r1', finishedAt: T2, players: [],
        scores: [{ playerId: 'r1-p0', hole: 2, strokes: 4, updatedAt: T2 }] },
    ]);
  });

  it('takes a newer score for a hole the phone already has, but not an older one', () => {
    const newer = remote('r1', { players: [{ id: 'r1-p0', position: 0, user_id: 'me', guest_name: null, name: 'Me',
                                             scores: [{ hole_number: 1, strokes: 5, updated_at: T2 }] }] });
    expect(planRestore([local('r1')], { rounds: [newer], deleted: [] })).toEqual([
      { type: 'merge', id: 'r1', finishedAt: null, players: [],
        scores: [{ playerId: 'r1-p0', hole: 1, strokes: 5, updatedAt: T2 }] },
    ]);
    const older = local('r1', { scores: { [scoreKey('r1-p0', 1)]: T2 } });
    expect(planRestore([older], { rounds: [remote('r1')], deleted: [] })).toEqual([]);
  });

  it('compares timestamps as instants, not text', () => {
    const sameInstant = remote('r1', { players: [{ id: 'r1-p0', position: 0, user_id: 'me', guest_name: null, name: 'Me',
                                                   scores: [{ hole_number: 1, strokes: 9, updated_at: '2026-10-04T12:05:00+02:00' }] }] });
    expect(planRestore([local('r1')], { rounds: [sameInstant], deleted: [] })).toEqual([]);
  });

  it('adds seats the phone does not have', () => {
    const r = remote('r1', { players: [
      { id: 'r1-p0', position: 0, user_id: 'me', guest_name: null, name: 'Me', scores: [] },
      { id: 'r1-p1', position: 1, user_id: null, guest_name: 'Janet', name: null, scores: [] }] });
    const plan = planRestore([local('r1')], { rounds: [r], deleted: [] });
    expect(plan).toEqual([{ type: 'merge', id: 'r1', finishedAt: null, players: [r.players[1]], scores: [] }]);
  });

  it('leaves a round with unsynced edits alone (the next push sends them first)', () => {
    const r = remote('r1', { finished_at: T2 });
    expect(planRestore([local('r1', { dirty: true })], { rounds: [r], deleted: [] })).toEqual([]);
  });

  it('leaves a round queued for delete alone, and does not restore it', () => {
    expect(planRestore([local('r1', { pendingDelete: true })], { rounds: [remote('r1')], deleted: [] })).toEqual([]);
  });

  it('keeps a finish time the phone already has', () => {
    const r = remote('r1', { finished_at: T2 });
    expect(planRestore([local('r1', { finishedAt: T1 })], { rounds: [r], deleted: [] })).toEqual([]);
  });
});
