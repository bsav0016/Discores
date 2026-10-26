// Tests for the send-push modules. Run with: deno test supabase/functions/send-push
// Nothing here touches the network or a database; both are replaced by fakes.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { drain, type Deps, MAX_AGE_MS } from './drain.ts';
import { BATCH_SIZE, chunk, ExpoUnavailable, isDeadToken, sendBatch, type Ticket } from './expo.ts';
import { buildMessage, cleanName, type Kind, type OutboxRow, type PushMessage } from './message.ts';
import { sameSecret } from './secret.ts';

// ------------------------------------------------------------------ message
Deno.test('friend request text names the sender and opens Friends', () => {
  const m = buildMessage('friend_request', 'Sam', 'ExponentPushToken[a]');
  assertEquals(m.to, 'ExponentPushToken[a]');
  assertEquals(m.body, 'Sam sent you a friend request.');
  assertEquals(m.data, { kind: 'friend_request', screen: 'friends' });
});

Deno.test('accepted request text', () => {
  const m = buildMessage('friend_accepted', 'Sam', 't');
  assertEquals(m.body, 'Sam accepted your friend request.');
  assertEquals(m.data.screen, 'friends');
});

Deno.test('round text asks for confirmation and opens the confirm screen', () => {
  const m = buildMessage('round_to_confirm', 'Sam', 't');
  assertEquals(m.body, 'Sam scored a round with you. Confirm your scores.');
  assertEquals(m.data.screen, 'confirm-rounds');
});

Deno.test('messages carry no scores, ids or course data', () => {
  for (const kind of ['friend_request', 'friend_accepted', 'round_to_confirm'] as Kind[]) {
    const m = buildMessage(kind, 'Sam', 't');
    assertEquals(Object.keys(m.data).sort(), ['kind', 'screen']);
    assert(!/\d/.test(m.body), `no digits in: ${m.body}`);
  }
});

Deno.test('names are cleaned: empty, multi-line and very long', () => {
  assertEquals(cleanName(null), 'Someone');
  assertEquals(cleanName('   '), 'Someone');
  assertEquals(cleanName('  Sam \n\n  Jones '), 'Sam Jones');
  const long = cleanName('x'.repeat(100));
  assertEquals(long.length, 40);
  assert(long.endsWith('…'));
  assertEquals(buildMessage('friend_request', null, 't').body, 'Someone sent you a friend request.');
});

// --------------------------------------------------------------------- expo
const msg = (to: string): PushMessage => buildMessage('friend_request', 'Sam', to);

Deno.test('chunk splits at the batch size', () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 2), []);
  assertEquals(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length), [BATCH_SIZE, BATCH_SIZE, 50]);
});

Deno.test('only DeviceNotRegistered counts as a dead token', () => {
  assert(isDeadToken({ status: 'error', details: { error: 'DeviceNotRegistered' } }));
  assert(!isDeadToken({ status: 'error', details: { error: 'MessageRateExceeded' } }));
  assert(!isDeadToken({ status: 'error' }));
  assert(!isDeadToken({ status: 'ok' }));
});

Deno.test('sendBatch posts JSON and returns the tickets in order', async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchFn = ((url: string, init: RequestInit) => {
    seen = { url, init };
    return Promise.resolve(new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] })));
  }) as unknown as typeof fetch;
  const tickets = await sendBatch([msg('a'), msg('b')], { fetchFn, accessToken: 'secret-token' });
  assertEquals(tickets.length, 2);
  assert(isDeadToken(tickets[1]));
  assertEquals(seen?.url, 'https://exp.host/--/api/v2/push/send');
  assertEquals((seen?.init.headers as Record<string, string>).Authorization, 'Bearer secret-token');
  assertEquals((JSON.parse(seen?.init.body as string) as unknown[]).length, 2);
});

Deno.test('sendBatch sends no Authorization header without an access token', async () => {
  let headers: Record<string, string> = {};
  const fetchFn = ((_u: string, init: RequestInit) => {
    headers = init.headers as Record<string, string>;
    return Promise.resolve(new Response(JSON.stringify({ data: [{ status: 'ok' }] })));
  }) as unknown as typeof fetch;
  await sendBatch([msg('a')], { fetchFn });
  assertEquals('Authorization' in headers, false);
});

Deno.test('sendBatch with nothing to send makes no request', async () => {
  const fetchFn = (() => {
    throw new Error('should not be called');
  }) as unknown as typeof fetch;
  assertEquals(await sendBatch([], { fetchFn }), []);
});

Deno.test('sendBatch reports Expo trouble as ExpoUnavailable', async () => {
  const cases: (() => Promise<Response>)[] = [
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve(new Response('no', { status: 503 })),
    () => Promise.resolve(new Response('no', { status: 429 })),
    () => Promise.resolve(new Response('<html>', { status: 200 })),
    () => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })), // wrong ticket count
    () => Promise.resolve(new Response(JSON.stringify({ errors: [{ code: 'x' }] }), { status: 200 })),
  ];
  for (const c of cases) {
    await assertRejects(() => sendBatch([msg('a')], { fetchFn: (() => c()) as unknown as typeof fetch }), ExpoUnavailable);
  }
});

// -------------------------------------------------------------------- secret
Deno.test('sameSecret', () => {
  assert(sameSecret('abc', 'abc'));
  assert(!sameSecret('abc', 'abd'));
  assert(!sameSecret('abc', 'abcd'));
  assert(!sameSecret('', 'abc'));
  assert(sameSecret('', ''));
});

// --------------------------------------------------------------------- drain
const NOW = Date.parse('2026-10-26T12:00:00Z');
const row = (id: number, user: string, over: Partial<OutboxRow> = {}): OutboxRow => ({
  id, kind: 'friend_request', user_id: user, actor_id: 'actor', ref_id: `ref${id}`,
  created_at: new Date(NOW - 60_000).toISOString(), ...over,
});

type Fake = Deps & {
  log: { claimed: number[]; released: number[]; deleted: string[]; sent: PushMessage[][] };
};

function fake(rows: OutboxRow[], tokens: Record<string, string[]>, send: (m: PushMessage[]) => Promise<Ticket[]>,
              opts: { alreadyClaimed?: number[] } = {}): Fake {
  const log = { claimed: [] as number[], released: [] as number[], deleted: [] as string[], sent: [] as PushMessage[][] };
  return {
    log,
    now: () => NOW,
    listUnsent: (limit) => Promise.resolve(rows.slice(0, limit)),
    claim: (ids) => {
      const got = ids.filter((i) => !(opts.alreadyClaimed ?? []).includes(i));
      log.claimed.push(...got);
      return Promise.resolve(got);
    },
    release: (ids) => {
      log.released.push(...ids);
      return Promise.resolve();
    },
    tokensFor: (users) => Promise.resolve(new Map(users.filter((u) => tokens[u]).map((u) => [u, tokens[u]]))),
    namesFor: () => Promise.resolve(new Map([['actor', 'Sam']])),
    deleteTokens: (t) => {
      log.deleted.push(...t);
      return Promise.resolve();
    },
    send: (m) => {
      log.sent.push(m);
      return send(m);
    },
  };
}

const allOk = (m: PushMessage[]) => Promise.resolve(m.map(() => ({ status: 'ok' }) as Ticket));
const unreachable = () => Promise.reject(new ExpoUnavailable('down'));

Deno.test('drain with an empty outbox does nothing', async () => {
  const d = fake([], {}, allOk);
  assertEquals(await drain(d), { sent: 0, rows: 0, stale: 0, noPhone: 0, retry: 0, failed: 0, pruned: 0 });
  assertEquals(d.log.sent.length, 0);
});

Deno.test('drain claims rows before sending and sends one message per phone', async () => {
  const d = fake([row(1, 'u1'), row(2, 'u2')], { u1: ['t1a', 't1b'], u2: ['t2'] }, allOk);
  const s = await drain(d);
  assertEquals(s.sent, 3);
  assertEquals(s.rows, 2);
  assertEquals(d.log.claimed, [1, 2]);
  assertEquals(d.log.sent[0].map((m) => m.to), ['t1a', 't1b', 't2']);
  assertEquals(d.log.sent[0][0].body, 'Sam sent you a friend request.');
  assertEquals(d.log.released, []);
});

Deno.test('drain skips rows another run already claimed', async () => {
  const d = fake([row(1, 'u1'), row(2, 'u2')], { u1: ['t1'], u2: ['t2'] }, allOk, { alreadyClaimed: [1] });
  const s = await drain(d);
  assertEquals(s.rows, 1);
  assertEquals(d.log.sent[0].map((m) => m.to), ['t2']);
});

Deno.test('drain drops rows older than the age limit without sending', async () => {
  const old = row(1, 'u1', { created_at: new Date(NOW - MAX_AGE_MS - 1000).toISOString() });
  const d = fake([old, row(2, 'u1')], { u1: ['t1'] }, allOk);
  const s = await drain(d);
  assertEquals(s.stale, 1);
  assertEquals(s.sent, 1);
  assertEquals(d.log.sent[0].length, 1);
});

Deno.test('drain counts people with no phone left and sends nothing for them', async () => {
  const d = fake([row(1, 'gone')], {}, allOk);
  const s = await drain(d);
  assertEquals(s.noPhone, 1);
  assertEquals(d.log.sent.length, 0);
  assertEquals(d.log.released, []);
});

Deno.test('drain deletes tokens Expo reports as dead, and only those', async () => {
  const send = (m: PushMessage[]) =>
    Promise.resolve(m.map((x): Ticket =>
      x.to === 'dead' ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
        : x.to === 'limited' ? { status: 'error', details: { error: 'MessageRateExceeded' } }
        : { status: 'ok' }
    ));
  const d = fake([row(1, 'u1')], { u1: ['dead', 'limited', 'good'] }, send);
  const s = await drain(d);
  assertEquals(s.sent, 1);
  assertEquals(s.failed, 1);
  assertEquals(s.pruned, 1);
  assertEquals(d.log.deleted, ['dead']);
  assertEquals(d.log.released, []);
});

Deno.test('drain puts rows back when Expo is unreachable', async () => {
  const d = fake([row(1, 'u1'), row(2, 'u2')], { u1: ['a'], u2: ['b'] }, unreachable);
  const s = await drain(d);
  assertEquals(s.sent, 0);
  assertEquals(s.retry, 2);
  assertEquals(d.log.released.sort(), [1, 2]);
});

Deno.test('drain does not put back a row that reached one of its phones', async () => {
  // 150 rows for one person-with-two-phones is overkill; use two batches by giving one person 101 phones.
  const phones = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => `p${i}`);
  let call = 0;
  const send = (m: PushMessage[]) => (++call === 1 ? allOk(m) : unreachable());
  const d = fake([row(1, 'u1'), row(2, 'u2')], { u1: phones, u2: ['solo'] }, send);
  const s = await drain(d);
  // Batch 1 delivers u1's first 100 phones; batch 2 (u1's last phone and u2) fails.
  assertEquals(s.sent, BATCH_SIZE);
  assertEquals(d.log.released, [2]);
  assertEquals(s.retry, 1);
});

Deno.test('drain does not hide a bug: unexpected errors propagate', async () => {
  const d = fake([row(1, 'u1')], { u1: ['a'] }, () => Promise.reject(new TypeError('bug')));
  await assertRejects(() => drain(d), TypeError);
});

Deno.test('drain tolerates a missing actor name', async () => {
  const d = fake([row(1, 'u1', { actor_id: null })], { u1: ['a'] }, allOk);
  await drain(d);
  assertEquals(d.log.sent[0][0].body, 'Someone sent you a friend request.');
});
