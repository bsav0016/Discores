// Sends the push notifications waiting in push_outbox (migration 0020). Meant to be called every minute by a
// scheduler, not by the app. It answers only to a caller that knows PUSH_SECRET, so deploy it with JWT verification
// off (`supabase functions deploy send-push --no-verify-jwt`) and keep the secret out of the app.
// Secrets: PUSH_SECRET (required), EXPO_ACCESS_TOKEN (optional, if "enhanced push security" is on in the Expo
// account). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { type Deps, drain } from './drain.ts';
import { sendBatch } from './expo.ts';
import type { OutboxRow } from './message.ts';
import { sameSecret } from './secret.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  const secret = Deno.env.get('PUSH_SECRET');
  if (!secret) return json({ ok: false, reason: 'not_configured' }, 503);
  if (!sameSecret(req.headers.get('x-push-secret') ?? '', secret)) return json({ ok: false, reason: 'unauthorized' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  };

  const deps: Deps = {
    now: () => Date.now(),
    listUnsent: async (limit) =>
      must(await db.from('push_outbox').select('id, kind, user_id, actor_id, ref_id, created_at')
        .is('sent_at', null).order('id').limit(limit)) as OutboxRow[],
    claim: async (ids) =>
      (must(await db.from('push_outbox').update({ sent_at: new Date().toISOString() })
        .in('id', ids).is('sent_at', null).select('id')) as { id: number }[]).map((r) => r.id),
    release: async (ids) => {
      must(await db.from('push_outbox').update({ sent_at: null }).in('id', ids).select('id'));
    },
    tokensFor: async (userIds) => {
      const rows = must(await db.from('push_tokens').select('token, user_id').in('user_id', userIds)) as
        { token: string; user_id: string }[];
      const map = new Map<string, string[]>();
      for (const r of rows) map.set(r.user_id, [...(map.get(r.user_id) ?? []), r.token]);
      return map;
    },
    namesFor: async (ids) => {
      if (ids.length === 0) return new Map();
      const rows = must(await db.from('profiles').select('id, display_name').in('id', ids)) as
        { id: string; display_name: string | null }[];
      return new Map(rows.filter((r) => r.display_name).map((r) => [r.id, r.display_name as string]));
    },
    deleteTokens: async (tokens) => {
      must(await db.from('push_tokens').delete().in('token', tokens).select('token'));
    },
    send: (messages) => sendBatch(messages, { accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') }),
  };

  try {
    return json({ ok: true, ...(await drain(deps)) });
  } catch (e) {
    console.error('send-push failed', (e as Error).message);
    return json({ ok: false, reason: 'error' }, 500);
  }
});
