// Turns an outbox row into the text of a notification. Pure, so it is tested without a network.
// The text carries the other person's display name and nothing else: no scores, courses or dates.

export type Kind = 'friend_request' | 'friend_accepted' | 'round_to_confirm';

export type OutboxRow = {
  id: number;
  kind: Kind;
  user_id: string;
  actor_id: string | null;
  ref_id: string;
  created_at: string;
};

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  // Read by the app when the notification is tapped: which screen to open.
  data: { kind: Kind; screen: 'friends' | 'confirm-rounds' };
};

const MAX_NAME = 40;

/** A display name that is safe to put in a sentence: single line, trimmed, shortened; "Someone" when empty. */
export function cleanName(name: string | null | undefined): string {
  const flat = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'Someone';
  return flat.length > MAX_NAME ? `${flat.slice(0, MAX_NAME - 1).trimEnd()}…` : flat;
}

export function buildMessage(kind: Kind, actorName: string | null | undefined, token: string): PushMessage {
  const name = cleanName(actorName);
  switch (kind) {
    case 'friend_request':
      return {
        to: token, sound: 'default', title: 'Friend request', body: `${name} sent you a friend request.`,
        data: { kind, screen: 'friends' },
      };
    case 'friend_accepted':
      return {
        to: token, sound: 'default', title: 'Friend request accepted', body: `${name} accepted your friend request.`,
        data: { kind, screen: 'friends' },
      };
    case 'round_to_confirm':
      return {
        to: token, sound: 'default', title: 'Round to confirm',
        body: `${name} scored a round with you. Confirm your scores.`,
        data: { kind, screen: 'confirm-rounds' },
      };
  }
}
