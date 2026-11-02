import { sendPendingSuggestions, type PendingSuggestion, type SuggestDeps, type SuggestResult } from './suggestions';

const pending = (roundId: string, layoutId: string, finishedAt: string, pars = [4, 3, 3]): PendingSuggestion =>
  ({ roundId, layoutId, pars, finishedAt });

function deps(list: PendingSuggestion[], over: Partial<SuggestDeps> = {}) {
  const cleared: string[] = [];
  const calls: [string, number[]][] = [];
  const d: SuggestDeps = {
    listPending: async () => list,
    clear: async (id) => void cleared.push(id),
    isVerified: async () => false,
    suggest: async (layoutId, pars): Promise<SuggestResult> => {
      calls.push([layoutId, pars]);
      return { result: 'ok', error: null };
    },
    onVerified: jest.fn(async () => {}),
    ...over,
  };
  return { d, cleared, calls };
}

describe('sendPendingSuggestions', () => {
  it('sends nothing when nothing is pending', async () => {
    const { d, calls } = deps([]);
    expect(await sendPendingSuggestions(d)).toEqual({ sent: 0, verified: 0, dropped: 0, kept: 0 });
    expect(calls).toEqual([]);
  });

  it('sends the latest edited round of each course and settles the older ones with it', async () => {
    const { d, cleared, calls } = deps([
      pending('r1', 'L1', '2026-10-01T10:00:00Z', [3, 3]),
      pending('r2', 'L1', '2026-10-05T10:00:00Z', [4, 4]),
      pending('r3', 'L2', '2026-10-03T10:00:00Z', [5, 3]),
    ]);
    const summary = await sendPendingSuggestions(d);
    expect(calls).toEqual([['L1', [4, 4]], ['L2', [5, 3]]]);
    expect(cleared.sort()).toEqual(['r1', 'r2', 'r3']);
    expect(summary).toMatchObject({ sent: 2, verified: 0, kept: 0 });
    expect(d.onVerified).not.toHaveBeenCalled();
  });

  it('refreshes the cached courses once when the server verified one', async () => {
    const { d } = deps([pending('r1', 'L1', '2026-10-01T10:00:00Z'), pending('r2', 'L2', '2026-10-02T10:00:00Z')], {
      suggest: async (layoutId) => ({ result: layoutId === 'L1' ? 'verified' : 'ok', error: null }),
    });
    expect(await sendPendingSuggestions(d)).toMatchObject({ sent: 2, verified: 1 });
    expect(d.onVerified).toHaveBeenCalledTimes(1);
  });

  it('drops rounds for a course the phone already knows is verified, without calling the server', async () => {
    const { d, cleared, calls } = deps([pending('r1', 'L1', '2026-10-01T10:00:00Z')], { isVerified: async () => true });
    expect(await sendPendingSuggestions(d)).toMatchObject({ sent: 0, dropped: 1 });
    expect(cleared).toEqual(['r1']);
    expect(calls).toEqual([]);
  });

  it('treats already_verified and not_found as settled', async () => {
    for (const result of ['already_verified', 'not_found']) {
      const { d, cleared } = deps([pending('r1', 'L1', '2026-10-01T10:00:00Z')], {
        suggest: async () => ({ result, error: null }),
      });
      expect((await sendPendingSuggestions(d)).sent).toBe(1);
      expect(cleared).toEqual(['r1']);
    }
  });

  it('keeps everything and stops when the network fails', async () => {
    const { d, cleared } = deps([pending('r1', 'L1', '2026-10-01T10:00:00Z'), pending('r2', 'L2', '2026-10-02T10:00:00Z')], {
      suggest: async () => { throw new Error('Network request failed'); },
    });
    expect(await sendPendingSuggestions(d)).toMatchObject({ sent: 0, kept: 1 });
    expect(cleared).toEqual([]);
  });

  it('keeps everything and stops at the daily limit', async () => {
    const calls: string[] = [];
    const { d, cleared } = deps([pending('r1', 'L1', '2026-10-01T10:00:00Z'), pending('r2', 'L2', '2026-10-02T10:00:00Z')], {
      suggest: async (layoutId) => {
        calls.push(layoutId);
        return { result: null, error: { message: 'Too many suggestions today. Try again tomorrow' } };
      },
    });
    expect(await sendPendingSuggestions(d)).toMatchObject({ sent: 0, kept: 1 });
    expect(calls).toEqual(['L1']);
    expect(cleared).toEqual([]);
  });

  it('drops pars the server will never accept and carries on with the next course', async () => {
    const { d, cleared } = deps([pending('r1', 'L1', '2026-10-01T10:00:00Z'), pending('r2', 'L2', '2026-10-02T10:00:00Z')], {
      suggest: async (layoutId) => layoutId === 'L1'
        ? { result: null, error: { message: 'Par must be between 2 and 6' } }
        : { result: 'ok', error: null },
    });
    expect(await sendPendingSuggestions(d)).toMatchObject({ sent: 1, dropped: 1 });
    expect(cleared.sort()).toEqual(['r1', 'r2']);
  });

  it('keeps a round after an unexplained server error or an unknown answer, and tries the others', async () => {
    const { d, cleared } = deps([
      pending('r1', 'L1', '2026-10-01T10:00:00Z'), pending('r2', 'L2', '2026-10-02T10:00:00Z'),
      pending('r3', 'L3', '2026-10-03T10:00:00Z'),
    ], {
      suggest: async (layoutId) => {
        if (layoutId === 'L1') return { result: null, error: { message: 'internal error' } };
        if (layoutId === 'L2') return { result: 'something new', error: null };
        return { result: 'ok', error: null };
      },
    });
    expect(await sendPendingSuggestions(d)).toMatchObject({ sent: 1, kept: 2 });
    expect(cleared).toEqual(['r3']);
  });
});
