import { canEditSeat, isLiveRound, liveBanner } from './liveRound';

describe('canEditSeat', () => {
  it('lets the owner score every seat of their own round in progress', () => {
    const r = { live: false, shared: false, finished: false };
    expect(canEditSeat(r, 'me', 'me')).toBe(true);
    expect(canEditSeat(r, 'friend', 'me')).toBe(true);
    expect(canEditSeat(r, null, 'me')).toBe(true);
  });

  it('lets a friend in a live round score only their own seat', () => {
    const r = { live: true, shared: true, finished: false };
    expect(canEditSeat(r, 'me', 'me')).toBe(true);
    expect(canEditSeat(r, 'owner', 'me')).toBe(false);
    expect(canEditSeat(r, null, 'me')).toBe(false);
    expect(canEditSeat(r, null, null)).toBe(false);
  });

  it('makes finished and shared-after-the-fact rounds read-only', () => {
    expect(canEditSeat({ live: false, shared: false, finished: true }, 'me', 'me')).toBe(false);
    expect(canEditSeat({ live: true, shared: true, finished: true }, 'me', 'me')).toBe(false);
    expect(canEditSeat({ live: false, shared: true, finished: false }, 'me', 'me')).toBe(false);
  });
});

describe('isLiveRound', () => {
  it('is live for a followed round and for an own round with a registered friend, until finished', () => {
    expect(isLiveRound({ live: true, shared: true, finished: false, ownerId: 'me' }, ['me'])).toBe(true);
    expect(isLiveRound({ live: false, shared: false, finished: false, ownerId: 'me' }, ['me', 'friend'])).toBe(true);
    expect(isLiveRound({ live: false, shared: false, finished: true, ownerId: 'me' }, ['me', 'friend'])).toBe(false);
  });

  it('is not live for a round with only the owner and guests', () => {
    expect(isLiveRound({ live: false, shared: false, finished: false, ownerId: 'me' }, ['me', null, null])).toBe(false);
  });
});

describe('liveBanner', () => {
  it('names the owner in a followed round and says friends can score along on an own round', () => {
    expect(liveBanner({ live: true, ownerName: 'Brian' }, false)?.detail).toContain('Brian is keeping score');
    expect(liveBanner({ live: true, ownerName: null }, false)?.detail).toContain('Someone is keeping score');
    expect(liveBanner({ live: false, ownerName: null }, true)?.title).toBe('Friends can score along');
    expect(liveBanner({ live: false, ownerName: null }, false)).toBeNull();
  });
});
