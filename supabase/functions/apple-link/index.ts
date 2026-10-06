// Called by the app right after Sign in with Apple. Exchanges Apple's one-time authorization code for a refresh
// token and stores it (service role only) so delete-account can revoke it later. Best effort: the app ignores
// failures, and an unconfigured project just answers { ok: false, reason: 'not_configured' }.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { appleConfig, exchangeCode } from './apple.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data } = await user.auth.getUser();
  if (!data.user) return json({ ok: false, reason: 'unauthorized' }, 401);

  const cfg = appleConfig();
  if (!cfg) return json({ ok: false, reason: 'not_configured' });

  const { code } = await req.json().catch(() => ({}));
  if (typeof code !== 'string' || !code) return json({ ok: false, reason: 'bad_request' }, 400);

  let refresh: string | null = null;
  try {
    refresh = await exchangeCode(cfg, code);
  } catch {
    return json({ ok: false, reason: 'apple_unreachable' });
  }
  if (!refresh) return json({ ok: false, reason: 'apple_rejected' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error } = await admin.from('apple_tokens').upsert({ user_id: data.user.id, refresh_token: refresh });
  return json({ ok: !error });
});
