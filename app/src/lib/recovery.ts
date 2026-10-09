export type RecoveryLink = { accessToken: string; refreshToken: string } | { error: string } | null;

/**
 * Reads a password-reset link (discores://reset-password#access_token=...&refresh_token=...&type=recovery).
 * Supabase puts the session in the URL fragment, or an error such as otp_expired when the link is stale or used.
 * Returns null for any other URL.
 */
export function parseRecoveryUrl(url: string | null | undefined): RecoveryLink {
  if (!url || !url.includes('reset-password')) return null;
  const raw = url.includes('#') ? url.split('#')[1] : (url.split('?')[1] ?? '');
  const p = new URLSearchParams(raw);
  if (p.get('error') || p.get('error_code') || p.get('error_description')) {
    return { error: 'That link has expired or was already used. Request a new one.' };
  }
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  if (p.get('type') === 'recovery' && accessToken && refreshToken) return { accessToken, refreshToken };
  return null;
}

/**
 * Reads the link in a sign-up confirmation email (discores://confirm-email#access_token=...&refresh_token=...&type=signup).
 * Returns null for any other URL.
 */
export function parseConfirmUrl(url: string | null | undefined): RecoveryLink {
  if (!url || !url.includes('confirm-email')) return null;
  const raw = url.includes('#') ? url.split('#')[1] : (url.split('?')[1] ?? '');
  const p = new URLSearchParams(raw);
  if (p.get('error') || p.get('error_code') || p.get('error_description')) {
    return { error: 'That link has expired or was already used. Sign in and we can send a new one.' };
  }
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  if (p.get('type') === 'signup' && accessToken && refreshToken) return { accessToken, refreshToken };
  return null;
}

export const MIN_PASSWORD = 8;

/** A message to show, or null when the new password is fine. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}
