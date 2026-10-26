// Push notifications on this phone: asking permission, telling the server which phone belongs to the signed-in
// account, and forgetting it again on sign-out. The decisions live in pushRules.ts (tested); this file is the part
// that talks to the system and to Supabase.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Alert, Platform } from 'react-native';
import { listFriends } from '@/db/local';
import { supabase } from './supabase';
import { looksLikeExpoToken, planPush, type PermissionStatus } from './pushRules';

const ASKED_KEY = 'discores.push.asked';
const TOKEN_KEY = 'discores.push.token';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

async function permissionStatus(): Promise<PermissionStatus> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain && p.status === Notifications.PermissionStatus.UNDETERMINED ? 'undetermined' : 'denied';
}

/** Tells the server about this phone. True when it was accepted. */
async function registerThisPhone(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Friends and rounds', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  if (!looksLikeExpoToken(token)) return false;
  const { data, error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  if (error || data !== 'ok') return false;
  await SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => {});
  return true;
}

function askFirst(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Get notified?',
      'Discores can tell you when a friend sends a request or scores a round with you, so you can confirm it. ' +
        'You can change this in Settings.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Turn on', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

let registeredFor: string | null = null; // the account this phone was registered for during this run
let asking = false;

/**
 * Call after a sync while signed in. Registers the phone if notifications are allowed (once per run per account,
 * since the token can change); otherwise asks once, but only when there is a friend or a round to confirm.
 * Never throws: notifications must not get in the way of the rest of the app.
 */
export async function setupPush(userId: string, hasPendingRound: boolean): Promise<void> {
  if (!supported || asking || registeredFor === userId) return;
  try {
    const status = await permissionStatus();
    const askedBefore = (await SecureStore.getItemAsync(ASKED_KEY).catch(() => null)) === '1';
    const hasFriend = status === 'undetermined' && !askedBefore
      ? (await listFriends().catch(() => [])).some((f) => f.kind === 'friend')
      : false;
    const plan = planPush({ status, askedBefore, hasFriend, hasPendingRound });
    if (plan === 'skip') return;
    if (plan === 'ask') {
      asking = true;
      try {
        const yes = await askFirst();
        await SecureStore.setItemAsync(ASKED_KEY, '1').catch(() => {});
        if (!yes) return;
        const granted = (await Notifications.requestPermissionsAsync()).granted;
        if (!granted) return;
      } finally {
        asking = false;
      }
    }
    if (await registerThisPhone()) registeredFor = userId;
  } catch (e) {
    console.warn('Push setup failed', String(e));
  }
}

/** Call before signing out: stops this phone from receiving the account's notifications. Best effort, never waits long. */
export async function forgetThisPhone(): Promise<void> {
  registeredFor = null;
  if (!supported) return;
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return;
    await Promise.race([
      supabase.rpc('unregister_push_token', { p_token: token }).then(() => SecureStore.deleteItemAsync(TOKEN_KEY)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // Offline: the next account to sign in on this phone takes the token over.
  }
}
