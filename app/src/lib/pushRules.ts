// The decisions behind push notifications, kept free of native modules so they are tested directly.

export type PermissionStatus = 'undetermined' | 'granted' | 'denied';

export type PushPlan = 'register' | 'ask' | 'skip';

/**
 * What to do about notifications right now.
 * - granted: register this phone (also refreshes the token, which can change).
 * - undetermined: ask, but only once there is something to be told about (a friend, or a round waiting for an
 *   answer) and only if the person has not already said "not now". Never at launch for a brand-new account.
 * - denied, or "not now" already answered: leave them alone; Settings is where they can turn it on later.
 */
export function planPush(input: {
  status: PermissionStatus;
  askedBefore: boolean;
  hasFriend: boolean;
  hasPendingRound: boolean;
}): PushPlan {
  if (input.status === 'granted') return 'register';
  if (input.status === 'undetermined' && !input.askedBefore && (input.hasFriend || input.hasPendingRound)) return 'ask';
  return 'skip';
}

export type SettingsView = 'switches' | 'turn-on' | 'blocked';

/**
 * What the Settings screen shows for notifications: the two switches once the phone allows them, a button to ask
 * while the system question is still open, or an explanation with a way to the phone's own settings after a denial.
 */
export function settingsView(status: PermissionStatus): SettingsView {
  return status === 'granted' ? 'switches' : status === 'undetermined' ? 'turn-on' : 'blocked';
}

export type PushScreen = '/friends' | '/confirm-rounds';

/**
 * The screen a tapped notification opens, from the data the sender attached (see send-push). Anything unexpected
 * returns null and the tap just opens the app, so a malformed or future notification can never navigate somewhere odd.
 */
export function routeForNotification(data: unknown): PushScreen | null {
  if (!data || typeof data !== 'object') return null;
  switch ((data as { screen?: unknown }).screen) {
    case 'friends':
      return '/friends';
    case 'confirm-rounds':
      return '/confirm-rounds';
    default:
      return null;
  }
}

/** Expo push tokens look like ExponentPushToken[...]; the server refuses anything else, so do not send it. */
export function looksLikeExpoToken(token: unknown): token is string {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]{1,180}\]$/.test(token);
}
