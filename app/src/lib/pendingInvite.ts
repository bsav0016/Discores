import * as SecureStore from 'expo-secure-store';

// An invite opened while signed out is kept here so it survives sign-up, email confirmation and app restarts.
const KEY = 'discores.pendingInvite';

export const savePendingInvite = (code: string) => SecureStore.setItemAsync(KEY, code).catch(() => {});

/** Returns the saved code and forgets it, so the invite screen opens only once. */
export async function takePendingInvite(): Promise<string | null> {
  try {
    const code = await SecureStore.getItemAsync(KEY);
    if (code) await SecureStore.deleteItemAsync(KEY);
    return code;
  } catch {
    return null;
  }
}
