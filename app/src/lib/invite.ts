import * as Linking from 'expo-linking';

// Friend codes use the alphabet from gen_friend_code(): no 0, 1, I, L or O.
const CODE = /^[A-HJKMNP-Z2-9]{8}$/;

export function normalizeCode(raw: string | string[] | undefined): string | null {
  const c = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
  return c && CODE.test(c) ? c : null;
}

/** A link that opens Discores on the invite screen (discores:// in builds, exp:// in Expo Go). */
export function inviteLink(code: string): string {
  return Linking.createURL(`friend/${code}`);
}

/** What the add-a-friend box holds: an email (@ inside), a username (leading @, or not code-shaped), or a code. */
export function classifyLookup(text: string): 'code' | 'email' | 'username' {
  const v = text.trim();
  if (v.startsWith('@')) return 'username';
  if (v.includes('@')) return 'email';
  return /^[A-Za-z0-9]{8}$/.test(v) ? 'code' : 'username';
}

/** The friend code inside an invite URL (…/friend/CODE), or null for any other URL. */
export function codeFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/\/friend\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/);
  return m ? normalizeCode(m[1]) : null;
}
