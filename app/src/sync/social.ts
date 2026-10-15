import { replaceFriends, replaceSharedRounds, type FriendRow, type SharedRound } from '@/db/local';
import { classifyLookup } from '@/lib/invite';
import { supabase } from '@/lib/supabase';

/** Downloads the friend list and requests into the local cache. Returns false (cache untouched) when offline. */
export async function refreshFriends(): Promise<boolean> {
  const { data, error } = await supabase.rpc('list_friends');
  if (error || !data) return false;
  try {
    await replaceFriends(data as FriendRow[]);
  } catch (e) {
    console.warn('Could not store friends', e);
    return false;
  }
  return true;
}

/** Downloads finished rounds that other people scored and that include us. Cache untouched when offline. */
export async function pullSharedRounds(myId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('pull_shared_rounds');
  if (error || !Array.isArray(data)) return false;
  try {
    await replaceSharedRounds(myId, data as SharedRound[]);
  } catch (e) {
    console.warn('Could not store shared rounds', String(e));
    return false;
  }
  return true;
}

export async function myFriendCode(): Promise<string | null> {
  const { data, error } = await supabase.rpc('my_friend_code');
  return error || typeof data !== 'string' ? null : data;
}

export type AddFriendResult = { ok: boolean; message: string };

const ADD_FRIEND_MESSAGES: Record<string, AddFriendResult> = {
  requested: { ok: true, message: 'Request sent. They need to accept it before you can add them to rounds.' },
  accepted: { ok: true, message: "You're now friends." },
  not_found: { ok: false, message: 'No one has that code. Check it and try again.' },
  own_code: { ok: false, message: "That's your own code." },
  already_friends: { ok: false, message: "You're already friends." },
  already_sent: { ok: false, message: 'You already sent them a request.' },
  too_many: { ok: false, message: 'Too many tries. Please wait a while and try again.' },
  you_blocked: { ok: false, message: "You've blocked this person. Unblock them in Friends first." },
};

function addFriendResult(error: unknown, data: unknown, how: 'code' | 'email' | 'username'): AddFriendResult {
  if (error) return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  if (data === 'not_found' && how === 'email') {
    return { ok: false, message: 'No match. They may not have turned on "Let people find me by email"; a friend code always works.' };
  }
  if (data === 'not_found' && how === 'username') {
    return { ok: false, message: 'No one has that username. Check the spelling, or ask for their friend code.' };
  }
  return ADD_FRIEND_MESSAGES[data as string] ?? { ok: false, message: 'Something went wrong.' };
}

/**
 * Adds by friend code, by exact email (text with an @ inside it; only finds people who opted in), or by username
 * (a leading @, or anything that isn't an 8-character code).
 */
export async function addFriend(text: string): Promise<AddFriendResult> {
  const v = text.trim();
  const how = classifyLookup(v);
  const { data, error } = how === 'email'
    ? await supabase.rpc('add_friend_by_email', { p_email: v })
    : how === 'username'
      ? await supabase.rpc('add_friend_by_username', { p_username: v })
      : await supabase.rpc('add_friend', { p_code: v });
  return addFriendResult(error, data, how);
}

export type Findability = { discoverable: boolean; username: string | null; username_changed_at: string | null };

export async function getFindability(userId: string): Promise<Findability | null> {
  const { data, error } = await supabase.from('profiles')
    .select('discoverable, username, username_changed_at').eq('id', userId).maybeSingle();
  return error || !data ? null : (data as Findability);
}

export async function getDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle();
  return error || !data ? null : (data.display_name as string);
}

/** Returns an error message, or null on success. */
export async function saveDisplayName(userId: string, name: string): Promise<string | null> {
  const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', userId);
  return error?.message ?? null;
}

/** Returns an error message, or null on success. */
export async function setDiscoverable(userId: string, value: boolean): Promise<string | null> {
  const { error } = await supabase.from('profiles').update({ discoverable: value }).eq('id', userId);
  return error?.message ?? null;
}

const USERNAME_MESSAGES: Record<string, { ok: boolean; message: string }> = {
  ok: { ok: true, message: 'Username saved.' },
  cleared: { ok: true, message: 'Username removed. People can no longer find you by it.' },
  unchanged: { ok: true, message: 'No change.' },
  invalid: { ok: false, message: 'Use 3 to 20 letters, numbers or underscores.' },
  taken: { ok: false, message: 'That username is taken.' },
  unavailable: { ok: false, message: "That username isn't available." },
  too_soon: { ok: false, message: 'You can change your username once every 30 days.' },
};

/** Empty text removes the username. */
export async function saveUsername(text: string): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await supabase.rpc('set_username', { p_username: text });
  if (error) return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  return USERNAME_MESSAGES[data as string] ?? { ok: false, message: 'Something went wrong.' };
}

/** Returns an error message, or null on success. */
export async function respondToRequest(friendshipId: string, accept: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('respond_friend_request', { p_id: friendshipId, p_accept: accept });
  return error?.message ?? null;
}

/** Unfriends, or cancels a request you sent. Returns an error message, or null on success. */
export async function removeFriend(friendshipId: string): Promise<string | null> {
  const { error } = await supabase.rpc('remove_friend', { p_friendship_id: friendshipId });
  return error?.message ?? null;
}

export const REPORT_REASONS = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'impersonation', label: 'Pretending to be someone' },
  { value: 'inappropriate_name', label: 'Offensive name' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

const REPORT_MESSAGES: Record<string, { ok: boolean; message: string }> = {
  ok: { ok: true, message: "Thanks. We'll review your report." },
  already_reported: { ok: true, message: "You've already reported this person. We'll review it." },
  not_allowed: { ok: false, message: 'You can only report people you have a friend request with.' },
  too_many: { ok: false, message: "You've sent a lot of reports today. Please try again tomorrow." },
  invalid: { ok: false, message: 'Pick a reason first.' },
};

export async function reportUser(
  userId: string, reason: ReportReason, note: string,
): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await supabase.rpc('report_user', { p_user: userId, p_reason: reason, p_note: note });
  if (error) return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  return REPORT_MESSAGES[data as string] ?? { ok: false, message: 'Something went wrong.' };
}

/** Returns an error message, or null on success. Removes any friendship or request between you. */
export async function blockUser(userId: string): Promise<string | null> {
  const { error } = await supabase.rpc('block_user', { p_user: userId });
  return error?.message ?? null;
}

export async function unblockUser(userId: string): Promise<string | null> {
  const { error } = await supabase.rpc('unblock_user', { p_user: userId });
  return error?.message ?? null;
}

export type BlockedPerson = { user_id: string; display_name: string };

/** Null when offline; the list lives on the server only. */
export async function listBlocked(): Promise<BlockedPerson[] | null> {
  const { data, error } = await supabase.rpc('list_blocked');
  return error || !Array.isArray(data) ? null : (data as BlockedPerson[]);
}

/** A finished round where a friend entered your scores. It only joins your history once you confirm it. */
export type PendingRound = {
  round_id: string;
  course_name: string;
  hole_count: number;
  pars: number[];
  started_at: string;
  finished_at: string;
  scorer: string;
  scores: { hole_number: number; strokes: number }[];
};

/** Null when offline. */
export async function listPendingRounds(): Promise<PendingRound[] | null> {
  const { data, error } = await supabase.rpc('list_pending_rounds');
  return error || !Array.isArray(data) ? null : (data as PendingRound[]);
}

/** Returns an error message, or null on success. Declining leaves just a name, with no link to you, on their round. */
export async function respondToRound(roundId: string, accept: boolean): Promise<string | null> {
  const { data, error } = await supabase.rpc('respond_round_confirmation', { p_round: roundId, p_accept: accept });
  if (error) return "Couldn't reach the server. Check your connection and try again.";
  return data === 'ok' || data === 'not_found' ? null : 'Something went wrong.'; // not_found: already answered
}

export type SeatStatus = 'confirmed' | 'pending' | 'declined' | 'guest';

/** For the scorer: where each seat of a round they scored stands, keyed by round_players id. Null when offline. */
export async function getSeatStatus(roundId: string): Promise<Record<string, SeatStatus> | null> {
  const { data, error } = await supabase.rpc('round_seat_status', { p_round: roundId });
  if (error || !Array.isArray(data)) return null;
  return Object.fromEntries((data as { player_id: string; status: SeatStatus }[]).map((r) => [r.player_id, r.status]));
}
