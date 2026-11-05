import * as SecureStore from 'expo-secure-store';
import * as StoreReview from 'expo-store-review';
import { listStatRounds } from '@/db/local';
import type { StatRound } from '@/domain/stats';
import { maybeAskForReview } from './reviewPrompt';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(), hasAction: jest.fn(), requestReview: jest.fn(),
}));
jest.mock('@/db/local', () => ({ listStatRounds: jest.fn() }));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const pars = [3, 3, 4];
const round = (id: string, strokes: [number, number, number]): StatRound => ({
  id, layoutId: 'L1', courseName: 'Test Course', pars, startedAt: '2026-01-01T10:00:00Z',
  scores: { 1: strokes[0], 2: strokes[1], 3: strokes[2] },
});
const goodMoment = [
  ...Array.from({ length: 4 }, (_, i) => round(`r${i}`, [4, 4, 4])),
  round('good', [3, 3, 4]),
];

beforeEach(() => {
  jest.resetAllMocks();
  (globalThis as any).__DEV__ = false;
  mocked(listStatRounds).mockResolvedValue(goodMoment);
  mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  mocked(StoreReview.isAvailableAsync).mockResolvedValue(true);
  mocked(StoreReview.hasAction).mockResolvedValue(true);
});

describe('maybeAskForReview', () => {
  it('requests the review prompt at a good moment and remembers when', async () => {
    await maybeAskForReview('me', 'good');
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('discores.reviewAskedAt', expect.any(String));
  });

  it('records the ask before requesting, so a failure cannot lead to asking again', async () => {
    const order: string[] = [];
    mocked(SecureStore.setItemAsync).mockImplementation(async () => { order.push('saved'); });
    mocked(StoreReview.requestReview).mockImplementation(async () => { order.push('requested'); });
    await maybeAskForReview('me', 'good');
    expect(order).toEqual(['saved', 'requested']);
  });

  it('does nothing at an ordinary moment', async () => {
    await maybeAskForReview('me', 'r0');
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('does nothing inside the cool-down', async () => {
    mocked(SecureStore.getItemAsync).mockResolvedValue(new Date().toISOString());
    await maybeAskForReview('me', 'good');
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });

  it('does nothing in development builds', async () => {
    (globalThis as any).__DEV__ = true;
    await maybeAskForReview('me', 'good');
    expect(listStatRounds).not.toHaveBeenCalled();
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });

  it('does nothing when the store has no review prompt to show', async () => {
    mocked(StoreReview.hasAction).mockResolvedValue(false);
    await maybeAskForReview('me', 'good');
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('never throws, whatever fails', async () => {
    mocked(listStatRounds).mockRejectedValue(new Error('database closed'));
    await expect(maybeAskForReview('me', 'good')).resolves.toBeUndefined();
    mocked(listStatRounds).mockResolvedValue(goodMoment);
    mocked(StoreReview.requestReview).mockRejectedValue(new Error('no'));
    await expect(maybeAskForReview('me', 'good')).resolves.toBeUndefined();
    mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('keychain'));
    await expect(maybeAskForReview('me', 'good')).resolves.toBeUndefined();
  });
});
