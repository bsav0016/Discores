// Sends everything waiting in push_outbox. All database and network access comes in through `Deps`, so the rules
// (age limit, claiming, retrying, pruning dead tokens) are tested with fakes.
//
// Delivery is at most once per outbox row on purpose: a row is claimed (sent_at set) before anything is sent, so two
// overlapping runs cannot both send it and a person never gets the same message twice. If Expo cannot be reached the
// claim is released and the row is tried again on the next run. Rows older than a day are dropped unsent: "someone
// sent you a friend request" is no use to anyone the next afternoon.
import { chunk, ExpoUnavailable, isDeadToken, type Ticket } from './expo.ts';
import { buildMessage, type OutboxRow, type PushMessage } from './message.ts';

export interface Deps {
  now(): number;
  listUnsent(limit: number): Promise<OutboxRow[]>;
  /** Marks rows sent and returns the ids that this call actually claimed (another run may have taken some). */
  claim(ids: number[]): Promise<number[]>;
  release(ids: number[]): Promise<void>;
  tokensFor(userIds: string[]): Promise<Map<string, string[]>>;
  namesFor(userIds: string[]): Promise<Map<string, string>>;
  deleteTokens(tokens: string[]): Promise<void>;
  send(messages: PushMessage[]): Promise<Ticket[]>;
}

export type Summary = {
  sent: number;     // messages Expo accepted
  rows: number;     // outbox rows handled
  stale: number;    // rows dropped for age
  noPhone: number;  // rows whose person has no registered phone any more
  retry: number;    // rows put back because Expo was unreachable
  failed: number;   // messages Expo refused for a reason other than a dead token
  pruned: number;   // dead tokens deleted
};

export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const BATCH_ROWS = 200;

export async function drain(d: Deps, opts: { limit?: number; maxAgeMs?: number } = {}): Promise<Summary> {
  const out: Summary = { sent: 0, rows: 0, stale: 0, noPhone: 0, retry: 0, failed: 0, pruned: 0 };
  const waiting = await d.listUnsent(opts.limit ?? BATCH_ROWS);
  if (waiting.length === 0) return out;

  const claimedIds = new Set(await d.claim(waiting.map((r) => r.id)));
  const mine = waiting.filter((r) => claimedIds.has(r.id));
  out.rows = mine.length;

  const cutoff = d.now() - (opts.maxAgeMs ?? MAX_AGE_MS);
  const fresh = mine.filter((r) => Date.parse(r.created_at) >= cutoff);
  out.stale = mine.length - fresh.length;
  if (fresh.length === 0) return out;

  const tokens = await d.tokensFor([...new Set(fresh.map((r) => r.user_id))]);
  const names = await d.namesFor([...new Set(fresh.flatMap((r) => (r.actor_id ? [r.actor_id] : [])))]);

  // One message per phone; remember which row and token each one belongs to.
  const planned: { rowId: number; token: string; message: PushMessage }[] = [];
  const rowHasPhone = new Set<number>();
  for (const row of fresh) {
    for (const token of tokens.get(row.user_id) ?? []) {
      rowHasPhone.add(row.id);
      planned.push({
        rowId: row.id, token, message: buildMessage(row.kind, row.actor_id ? names.get(row.actor_id) : null, token),
      });
    }
  }
  out.noPhone = fresh.filter((r) => !rowHasPhone.has(r.id)).length;

  const delivered = new Set<number>();
  const unreachable = new Set<number>();
  const dead = new Set<string>();
  for (const part of chunk(planned)) {
    let tickets: Ticket[];
    try {
      tickets = await d.send(part.map((p) => p.message));
    } catch (e) {
      if (!(e instanceof ExpoUnavailable)) throw e;
      part.forEach((p) => unreachable.add(p.rowId));
      continue;
    }
    part.forEach((p, i) => {
      const t = tickets[i];
      if (t.status === 'ok') {
        out.sent++;
        delivered.add(p.rowId);
      } else if (isDeadToken(t)) {
        dead.add(p.token);
      } else {
        out.failed++;
      }
    });
  }

  // A row goes back in the queue only if nothing was delivered for it; otherwise a second phone's failure would
  // make the first phone buzz twice.
  const retry = [...unreachable].filter((id) => !delivered.has(id));
  if (retry.length > 0) {
    await d.release(retry);
    out.retry = retry.length;
  }
  if (dead.size > 0) {
    await d.deleteTokens([...dead]);
    out.pruned = dead.size;
  }
  return out;
}
