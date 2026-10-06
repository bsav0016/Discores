/**
 * True only when the server definitively says this session's user or token no longer exists (e.g. the account
 * was deleted elsewhere). Network failures and 5xx responses are retryable and must never sign anyone out,
 * or going offline on the course would log people out.
 */
export function isSessionGone(error: { status?: number } | null | undefined): boolean {
  return !!error && [401, 403, 404].includes(error.status ?? 0);
}
