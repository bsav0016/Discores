// Talks to Apple's REST API for Sign in with Apple. Shared by apple-link and delete-account.
// Secrets (set with `supabase secrets set` or the dashboard): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY
// (contents of the .p8 file; literal \n sequences are accepted) and optionally APPLE_CLIENT_ID (defaults to the
// bundle id).
import { importPKCS8, SignJWT } from 'npm:jose@5';

export type AppleConfig = { teamId: string; keyId: string; privateKey: string; clientId: string };

export function appleConfig(): AppleConfig | null {
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const privateKey = Deno.env.get('APPLE_PRIVATE_KEY');
  if (!teamId || !keyId || !privateKey) return null;
  return {
    teamId,
    keyId,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    clientId: Deno.env.get('APPLE_CLIENT_ID') ?? 'com.discores.app',
  };
}

// Apple wants a short-lived JWT signed with the .p8 key as the client secret.
async function clientSecret(c: AppleConfig): Promise<string> {
  const key = await importPKCS8(c.privateKey, 'ES256');
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: c.keyId })
    .setIssuer(c.teamId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setAudience('https://appleid.apple.com')
    .setSubject(c.clientId)
    .sign(key);
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
  signal: AbortSignal.timeout(8000),
});

/** Trades the one-time authorization code from the app for a long-lived refresh token, or null if Apple says no. */
export async function exchangeCode(c: AppleConfig, code: string): Promise<string | null> {
  const r = await fetch('https://appleid.apple.com/auth/token', form({
    client_id: c.clientId, client_secret: await clientSecret(c), code, grant_type: 'authorization_code',
  }));
  if (!r.ok) return null;
  return ((await r.json()) as { refresh_token?: string }).refresh_token ?? null;
}

/** Tells Apple this app no longer has access to the person's Apple ID. True when Apple accepted it. */
export async function revokeToken(c: AppleConfig, refreshToken: string): Promise<boolean> {
  const r = await fetch('https://appleid.apple.com/auth/revoke', form({
    client_id: c.clientId, client_secret: await clientSecret(c), token: refreshToken, token_type_hint: 'refresh_token',
  }));
  return r.ok;
}
