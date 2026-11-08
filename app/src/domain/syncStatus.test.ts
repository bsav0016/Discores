import { roundSyncLabel, syncBanner } from './syncStatus';

const r = (over: any = {}) => ({ dirty: true, shared: false, sync_error: null, ...over });
const off = { kind: 'offline' as const };
const rej = { kind: 'rejected' as const };

describe('syncBanner', () => {
  it('says nothing when everything synced or has not failed yet', () => {
    expect(syncBanner([])).toBeNull();
    expect(syncBanner([r({ dirty: false }), r()])).toBeNull();
  });
  it('tells offline from refused, and refused wins', () => {
    expect(syncBanner([r({ sync_error: off }), r({ sync_error: off })])).toMatchObject({ tone: 'warn', title: '2 rounds waiting to sync' });
    expect(syncBanner([r({ sync_error: off }), r({ sync_error: rej })])).toMatchObject({
      tone: 'danger', title: '1 round could not be saved to your account',
    });
  });
  it('ignores clean rounds and rounds scored by someone else', () => {
    expect(syncBanner([r({ dirty: false, sync_error: rej }), r({ shared: true, sync_error: rej })])).toBeNull();
  });
});

describe('roundSyncLabel', () => {
  it('labels each state', () => {
    expect(roundSyncLabel(r())?.label).toBe('Not synced yet');
    expect(roundSyncLabel(r({ sync_error: off }))?.label).toBe('Waiting for connection');
    expect(roundSyncLabel(r({ sync_error: rej }))).toEqual({ label: 'Server refused this round', tone: 'danger' });
    expect(roundSyncLabel(r({ dirty: false }))).toBeNull();
  });
});
