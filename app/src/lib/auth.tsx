import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import NetInfo from '@react-native-community/netinfo';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { adoptGuestRounds, countGuestRounds, GUEST_ID, listFriends, wipeLocalData } from '@/db/local';
import { refreshLayouts, syncNow } from '@/sync';
import { listPendingRounds, pullMyRounds, pullSharedRounds, refreshFriends } from '@/sync/social';
import { forgetThisPhone, setupPush } from './push';
import { isSessionGone } from './session';
import { supabase } from './supabase';

export type SignUpInput = {
  email: string;
  password: string;
  displayName: string;
  birthYear: number;
  gender: string | null;
  experienceYears: number | null;
};

type AuthState = {
  session: Session | null;
  loading: boolean;
  /** Using the app without an account: rounds stay on this device. */
  guest: boolean;
  /** Who owns local data: the signed-in user, or the guest placeholder. */
  ownerId: string;
  startGuest: () => Promise<void>;
  /** Leaves guest mode (to sign in or create an account); guest rounds stay on the device until adopted. */
  endGuest: () => Promise<void>;
  /** Rounds a friend scored for you that are waiting for you to confirm. */
  pendingCount: number;
  refreshPending: () => Promise<void>;
  /** Friend requests other people sent you that are waiting for an answer. */
  requestCount: number;
  /** Recounts them from the saved friend list (the Friends tab calls this after it changes the list). */
  refreshRequests: () => Promise<void>;
  /** Bumps whenever a sync finishes, so screens can re-read local data. */
  syncTick: number;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (input: SignUpInput) => Promise<string | null>;
  /** Sends the sign-up confirmation email again. Returns a message only on a real failure. */
  resendConfirmation: (email: string) => Promise<string | null>;
  /** Signs in with the session from a confirmation link. Returns an error message. */
  confirmEmail: (tokens: { accessToken: string; refreshToken: string }) => Promise<string | null>;
  /** Sends a reset email. Never says whether the address has an account; resolves to a message only on a real failure. */
  requestPasswordReset: (email: string) => Promise<string | null>;
  /** True while someone who opened a reset link is choosing a new password. */
  recovering: boolean;
  /** Signs in with the session from a reset link and starts choosing a new password. Returns an error message. */
  startRecovery: (tokens: { accessToken: string; refreshToken: string }) => Promise<string | null>;
  /** Saves the new password and signs out other devices. Returns an error message, or null on success. */
  finishRecovery: (password: string) => Promise<string | null>;
  cancelRecovery: () => Promise<void>;
  /** For someone who is signed in with an email password. Checks the current one first. */
  changePassword: (current: string, next: string) => Promise<string | null>;
  /** iPhone only. Resolves to null on success or when the person cancels. */
  signInWithApple: () => Promise<string | null>;
  /** Opens Google's sign-in in the system browser. Resolves to null on success or when the person closes it. */
  signInWithGoogle: () => Promise<string | null>;
  /** Signed in with Apple/Google but has not yet confirmed their age and name. */
  needsProfile: boolean;
  completeProfile: (displayName: string, birthYear: number, ageConfirmed: boolean) => Promise<string | null>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<string | null>;
  sync: () => Promise<void>;
  /** Debounced push of dirty rounds, for after each scored hole. */
  pushSoon: () => void;
};

const Ctx = createContext<AuthState | null>(null);

const GUEST_KEY = 'discores.guest';

/** What sign-in says when the password is right but the email was never confirmed; the sign-in screen offers a resend. */
export const EMAIL_NOT_CONFIRMED = "You haven't confirmed your email yet. Open the link we sent you (check spam too).";

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncTick, setSyncTick] = useState(0);
  const [guest, setGuest] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  // null = not checked yet; false = signed in but no profile (social sign-in before the age check).
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  // Set once the app has been seen signed out, so the guest-rounds question is asked at sign-in, not every launch.
  const sawSignedOut = useRef(false);

  useEffect(() => {
    Promise.all([
      supabase.auth.getSession(),
      SecureStore.getItemAsync(GUEST_KEY).catch(() => null),
    ]).then(([{ data }, g]) => {
      if (!data.session) sawSignedOut.current = true;
      setSession(data.session);
      setGuest(!data.session && g === '1');
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) sawSignedOut.current = true;
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  // Email accounts get their profile at sign-up. Social accounts get it from complete_profile(), so ask the server.
  // A failed check (offline) must not lock out someone with an existing account, so it counts as "has one".
  useEffect(() => {
    setHasProfile(null);
    if (!userId) return;
    let stale = false;
    supabase.from('profiles').select('id').eq('id', userId).maybeSingle()
      .then(async ({ data, error }) => {
        if (stale) return;
        if (error || data) return setHasProfile(true);
        // No profile. Either a social sign-in that has not finished, or the account was deleted elsewhere and this
        // phone still holds its session. Ask the server which, so a deleted account signs out instead of onboarding.
        const { error: userError } = await supabase.auth.getUser();
        if (stale) return;
        if (isSessionGone(userError)) await supabase.auth.signOut({ scope: 'local' });
        else setHasProfile(false);
      });
    return () => {
      stale = true;
    };
  }, [userId]);
  // Syncing, and moving guest rounds in, wait until the profile exists.
  const syncUserId = hasProfile ? userId : null;

  // Signing in or up ends guest mode.
  useEffect(() => {
    if (!userId) return;
    setGuest(false);
    SecureStore.deleteItemAsync(GUEST_KEY).catch(() => {});
  }, [userId]);

  // The stored token can outlive the account (deleted elsewhere, project reset). Ask the server, and sign out
  // locally only on a definitive answer; being offline leaves the session alone.
  const sessionStillValid = useCallback(async () => {
    const { error } = await supabase.auth.getUser();
    if (!isSessionGone(error)) return true;
    await supabase.auth.signOut({ scope: 'local' });
    return false;
  }, []);

  const refreshRequests = useCallback(async () => {
    const rows = await listFriends().catch(() => null);
    if (rows) setRequestCount(rows.filter((f) => f.kind === 'incoming').length);
  }, []);

  const sync = useCallback(async () => {
    if (!syncUserId) return;
    if (!(await sessionStillValid())) return;
    await refreshLayouts().catch(() => false);
    await syncNow(syncUserId);
    // Friends and rounds shared with us come down after our own rounds went up. Offline just leaves the cache.
    // One after the other: both write in a SQLite transaction, and overlapping transactions are rejected.
    await refreshFriends().catch(() => false);
    await refreshRequests();
    await pullMyRounds(syncUserId).catch(() => false);
    await pullSharedRounds(syncUserId).catch(() => false);
    const pending = await listPendingRounds().catch(() => null);
    if (pending) setPendingCount(pending.length);
    setSyncTick((t) => t + 1);
  }, [syncUserId, sessionStillValid, refreshRequests]);

  // Once the first sync is done: register this phone for notifications, or ask once if there is something to be told about.
  useEffect(() => {
    if (syncUserId && syncTick > 0) void setupPush(syncUserId, pendingCount > 0);
  }, [syncUserId, syncTick, pendingCount]);

  const refreshPending = useCallback(async () => {
    const pending = await listPendingRounds().catch(() => null);
    if (pending) setPendingCount(pending.length);
  }, []);

  // Light push after a scored hole: debounced, no course refresh, stays dirty if offline.
  const pushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pushSoon = useCallback(() => {
    if (!syncUserId) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      syncNow(syncUserId)
        .then(() => setSyncTick((t) => t + 1))
        .catch(() => {});
    }, 1500);
  }, [syncUserId]);
  useEffect(() => () => clearTimeout(pushTimer.current), [syncUserId]);

  // Sync on sign-in, app foreground, and when connectivity returns.
  useEffect(() => {
    if (!syncUserId) return;
    // Rounds played as a guest join this account only if the person agrees, before the first sync pushes them.
    // Declining leaves them on the device and shows them again the next time someone uses the app as a guest.
    const name = (session?.user.user_metadata?.display_name as string | undefined) ?? 'You';
    countGuestRounds().catch(() => 0).then((n) => {
      if (n === 0 || !sawSignedOut.current) return sync();
      sawSignedOut.current = false; // asked once per sign-in
      Alert.alert(
        'Add your guest rounds?',
        `You scored ${n} round${n === 1 ? '' : 's'} as a guest on this phone. Add ${n === 1 ? 'it' : 'them'} to this account?`,
        [
          { text: 'Not now', style: 'cancel', onPress: () => void sync() },
          { text: 'Add', onPress: () => void adoptGuestRounds(syncUserId, name).catch(() => 0).then(() => sync()) },
        ],
        { cancelable: false },
      );
    });
    const appSub = AppState.addEventListener('change', (s) => s === 'active' && sync());
    let wasOnline = true;
    const unsubNet = NetInfo.addEventListener((s) => {
      const online = !!s.isConnected && s.isInternetReachable !== false;
      if (online && !wasOnline) sync();
      wasOnline = online;
    });
    return () => {
      appSub.remove();
      unsubNet();
    };
  }, [syncUserId, sync]); // eslint-disable-line react-hooks/exhaustive-deps -- name only matters at sign-in

  const value = useMemo<AuthState>(
    () => ({
      session,
      pendingCount: syncUserId ? pendingCount : 0,
      requestCount: syncUserId ? requestCount : 0,
      refreshRequests,
      refreshPending,
      // Also covers the moment between signing in and learning whether a profile exists.
      loading: loading || (!!userId && hasProfile === null),
      needsProfile: !!userId && hasProfile === false,
      completeProfile: async (displayName, birthYear, ageConfirmed) => {
        const { data, error } = await supabase.rpc('complete_profile', {
          p_display_name: displayName, p_birth_year: birthYear, p_age_confirmed: ageConfirmed,
        });
        if (error) return error.message;
        if (data === 'underage') {
          await supabase.auth.signOut({ scope: 'local' });
          return 'You must be at least 13 to use Discores. Your sign-in was removed.';
        }
        if (data === 'invalid') return 'Check your name and birth year, and confirm your age.';
        if (data !== 'ok' && data !== 'exists') return "Couldn't finish setting up. Try again.";
        // Keep the name where the rest of the app reads it before the profile counts as ready.
        await supabase.auth.updateUser({ data: { display_name: displayName.trim() } });
        setHasProfile(true);
        return null;
      },
      signInWithGoogle: async () => {
        const redirectTo = Linking.createURL('auth-callback');
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google', options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error || !data.url) return error?.message ?? 'Google sign-in is not available right now.';
        const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (res.type !== 'success') return null; // closed or cancelled
        // Supabase returns the session in the URL fragment (or ?error_description on failure).
        const params = new URLSearchParams(res.url.split('#')[1] ?? res.url.split('?')[1] ?? '');
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (!access_token || !refresh_token) return params.get('error_description') ?? 'Google sign-in failed. Try again.';
        const { error: e2 } = await supabase.auth.setSession({ access_token, refresh_token });
        return e2?.message ?? null;
      },
      signInWithApple: async () => {
        // Apple checks the hash of this value is inside the signed token; Supabase checks the raw value.
        const nonce = Crypto.randomUUID();
        const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
        try {
          const cred = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: hashed,
          });
          if (!cred.identityToken) return 'Apple did not return a sign-in token.';
          const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: cred.identityToken, nonce });
          if (error) return error.message;
          // Keep Apple's one-time code server side so the Apple token can be revoked if the account is deleted.
          // Best effort and not awaited: it must never get in the way of signing in.
          if (cred.authorizationCode) {
            void supabase.functions.invoke('apple-link', { body: { code: cred.authorizationCode } }).catch(() => {});
          }
          // Apple shares the name only the first time; keep it to pre-fill the next screen.
          const n = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ');
          if (n) await supabase.auth.updateUser({ data: { full_name: n } });
          return null;
        } catch (e: any) {
          return e?.code === 'ERR_REQUEST_CANCELED' ? null : 'Apple sign-in failed. Try again.';
        }
      },
      guest,
      ownerId: userId ?? GUEST_ID,
      startGuest: async () => {
        await SecureStore.setItemAsync(GUEST_KEY, '1').catch(() => {});
        setGuest(true);
      },
      endGuest: async () => {
        await SecureStore.deleteItemAsync(GUEST_KEY).catch(() => {});
        setGuest(false);
      },
      syncTick,
      sync,
      pushSoon,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error && /not confirmed/i.test(error.message)) return EMAIL_NOT_CONFIRMED;
        return error?.message ?? null;
      },
      resendConfirmation: async (email) => {
        const { error } = await supabase.auth.resend({
          type: 'signup', email: email.trim(), options: { emailRedirectTo: Linking.createURL('confirm-email') },
        });
        if (!error) return null;
        return /rate limit|too many|429|seconds/i.test(error.message)
          ? 'Too many requests. Wait a minute and try again.'
          : "Couldn't send the email. Check your connection and try again.";
      },
      confirmEmail: async ({ accessToken, refreshToken }) => {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        return error ? 'That link has expired or was already used. Sign in and we can send a new one.' : null;
      },
      requestPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: Linking.createURL('reset-password'),
        });
        if (!error) return null;
        // An unknown address is not an error here, so anything left is a rate limit or a connection problem.
        return /rate limit|too many|429/i.test(error.message)
          ? 'Too many requests. Wait a few minutes and try again.'
          : "Couldn't send the email. Check your connection and try again.";
      },
      recovering,
      startRecovery: async ({ accessToken, refreshToken }) => {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) return 'That link has expired or was already used. Request a new one.';
        setRecovering(true);
        return null;
      },
      finishRecovery: async (password) => {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return error.message;
        await supabase.auth.signOut({ scope: 'others' }).catch(() => {}); // anyone else signed in must use the new one
        setRecovering(false);
        return null;
      },
      cancelRecovery: async () => {
        setRecovering(false);
        await supabase.auth.signOut();
      },
      changePassword: async (current, next) => {
        const email = session?.user.email;
        if (!email) return "This account doesn't use a password.";
        const check = await supabase.auth.signInWithPassword({ email, password: current });
        if (check.error) return 'Your current password is incorrect.';
        const { error } = await supabase.auth.updateUser({ password: next });
        if (error) return error.message;
        await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
        return null;
      },
      signUp: async (i) => {
        const { error } = await supabase.auth.signUp({
          email: i.email,
          password: i.password,
          options: {
            emailRedirectTo: Linking.createURL('confirm-email'),
            data: {
              display_name: i.displayName,
              birth_year: i.birthYear,
              age_confirmed: true,
              gender: i.gender ?? '',
              experience_years: i.experienceYears ?? '',
            },
          },
        });
        if (!error) return null;
        // Supabase's built-in email sender is limited, and until custom SMTP is set up it only delivers to a few addresses.
        if (/rate limit|too many|429/i.test(error.message)) return 'Too many sign-ups right now. Wait a few minutes and try again.';
        if (/not authorized|can't send|could not send|sending.*email/i.test(error.message)) {
          return "We couldn't send a confirmation email to that address. Check it for typos, or try again later.";
        }
        return error.message;
      },
      signOut: async () => {
        await forgetThisPhone();
        await supabase.auth.signOut();
      },
      deleteAccount: async () => {
        // The function also revokes the Apple token for Apple sign-ins. If it can't be reached the account is still
        // deleted the direct way, so deleting never depends on it.
        const viaFunction = await supabase.functions.invoke('delete-account').then((r) => !r.error, () => false);
        if (!viaFunction) {
          const { error } = await supabase.rpc('delete_account');
          if (error) return error.message;
        }
        await wipeLocalData();
        await forgetThisPhone();
        await supabase.auth.signOut();
        return null;
      },
    }),
    [session, loading, guest, userId, hasProfile, syncTick, sync, pushSoon, pendingCount, refreshPending, requestCount, refreshRequests, syncUserId, recovering],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
