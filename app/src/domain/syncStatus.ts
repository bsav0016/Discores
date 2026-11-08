export type SyncStatusRound = { dirty: boolean; shared: boolean; sync_error: { kind: 'offline' | 'rejected' } | null };

export type SyncBanner = { tone: 'warn' | 'danger'; title: string; detail: string };

const plural = (n: number) => `${n} round${n === 1 ? '' : 's'}`;

/**
 * What the history screen says about sync problems. A refusal from the server outranks being offline, because only
 * it needs the person to do something. Rounds that are not waiting to sync (or that someone else scored) never count.
 */
export function syncBanner(rounds: SyncStatusRound[]): SyncBanner | null {
  const waiting = rounds.filter((r) => r.dirty && !r.shared && r.sync_error);
  const rejected = waiting.filter((r) => r.sync_error!.kind === 'rejected').length;
  if (rejected > 0) {
    return {
      tone: 'danger',
      title: `${plural(rejected)} could not be saved to your account`,
      detail: 'The server refused it. Your scores are safe on this phone. Pull down to try again, and update the app if it keeps happening.',
    };
  }
  if (waiting.length > 0) {
    return {
      tone: 'warn',
      title: `${plural(waiting.length)} waiting to sync`,
      detail: "Couldn't reach the server. Your scores are safe on this phone and will sync when you are back online.",
    };
  }
  return null;
}

/** Short label for one round's row, or null when it needs none. */
export function roundSyncLabel(r: SyncStatusRound): { label: string; tone: 'warn' | 'danger' } | null {
  if (!r.dirty || r.shared) return null;
  if (r.sync_error?.kind === 'rejected') return { label: 'Server refused this round', tone: 'danger' };
  if (r.sync_error?.kind === 'offline') return { label: 'Waiting for connection', tone: 'warn' };
  return { label: 'Not synced yet', tone: 'warn' };
}
