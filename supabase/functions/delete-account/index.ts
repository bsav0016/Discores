// Deletes the signed-in person's account. If they signed in with Apple, their Apple token is revoked first
// (an App Store requirement). Revoking is best effort: the account is deleted either way, using the same
// delete_account() database function the app used before, called with the person's own JWT.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { appleConfig, revokeToken } from './apple.ts';

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

  let appleRevoked: boolean | null = null; // null = no Apple token to revoke
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: row } = await admin.from('apple_tokens').select('refresh_token').eq('user_id', data.user.id).maybeSingle();
  if (row?.refresh_token) {
    const cfg = appleConfig();
    try {
      appleRevoked = cfg ? await revokeToken(cfg, row.refresh_token) : false;
    } catch {
      appleRevoked = false;
    }
  }

  const { error } = await user.rpc('delete_account');
  if (error) return json({ ok: false, reason: 'delete_failed', message: error.message }, 500);
  return json({ ok: true, appleRevoked });
});
