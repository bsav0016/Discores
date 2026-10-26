import { looksLikeExpoToken, planPush, routeForNotification, settingsView } from './pushRules';

describe('planPush', () => {
  const base = { status: 'undetermined' as const, askedBefore: false, hasFriend: false, hasPendingRound: false };

  it('registers whenever permission is already granted', () => {
    expect(planPush({ ...base, status: 'granted' })).toBe('register');
    expect(planPush({ ...base, status: 'granted', askedBefore: true })).toBe('register');
  });
  it('does not ask a brand-new account with nothing to be told about', () => {
    expect(planPush(base)).toBe('skip');
  });
  it('asks once there is a friend or a round waiting', () => {
    expect(planPush({ ...base, hasFriend: true })).toBe('ask');
    expect(planPush({ ...base, hasPendingRound: true })).toBe('ask');
  });
  it('does not ask again after "not now"', () => {
    expect(planPush({ ...base, hasFriend: true, askedBefore: true })).toBe('skip');
  });
  it('leaves a denial alone', () => {
    expect(planPush({ ...base, status: 'denied', hasFriend: true })).toBe('skip');
  });
});

describe('settingsView', () => {
  it('shows the switches only when the phone allows notifications', () => {
    expect(settingsView('granted')).toBe('switches');
    expect(settingsView('undetermined')).toBe('turn-on');
    expect(settingsView('denied')).toBe('blocked');
  });
});

describe('routeForNotification', () => {
  it('opens the screen the sender asked for', () => {
    expect(routeForNotification({ kind: 'friend_request', screen: 'friends' })).toBe('/friends');
    expect(routeForNotification({ kind: 'friend_accepted', screen: 'friends' })).toBe('/friends');
    expect(routeForNotification({ kind: 'round_to_confirm', screen: 'confirm-rounds' })).toBe('/confirm-rounds');
  });
  it('ignores anything unexpected', () => {
    for (const bad of [null, undefined, 'friends', 5, [], {}, { screen: 'settings' }, { screen: '/friends' },
      { screen: ['friends'] }, { screen: '../../etc' }, { screen: 'FRIENDS' }]) {
      expect(routeForNotification(bad)).toBeNull();
    }
  });
});

describe('looksLikeExpoToken', () => {
  it('accepts Expo tokens', () => {
    expect(looksLikeExpoToken('ExponentPushToken[abc-DEF_123]')).toBe(true);
    expect(looksLikeExpoToken('ExpoPushToken[abc]')).toBe(true);
  });
  it('rejects everything else', () => {
    for (const bad of ['', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[a]]x', null, undefined, 12, {}]) {
      expect(looksLikeExpoToken(bad)).toBe(false);
    }
  });
});
