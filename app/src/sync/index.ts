import {
  applyLive, clearSuggestion, finishPendingDelete, getLiveSeat, getRound, getSyncSource, GUEST_ID, isLayoutVerified,
  listDirtyLiveRoundIds, listDirtyRoundIds, listLayouts, listLiveState, listPendingDeleteIds, listPendingSuggestions,
  markSynced, recordSyncFailure, removeLayouts, upsertLayout,
} from '@/db/local';
import { supabase } from '@/lib/supabase';
import { report } from '@/lib/telemetry';
import { suggestLayout } from './courses';
import { syncDirtyRounds, type SyncResult } from './engine';
import { planLive, syncLiveSeats, type LiveRemoteRound } from './live';
import { sendPendingSuggestions } from './suggestions';

let suggesting: Promise<void> | null = null;

/** Suggests edited pars to their courses. Best effort: never throws, never delays or fails a sync. */
function suggestPendingPars(ownerId: string): Promise<void> {
  if (ownerId === GUEST_ID) return Promise.resolve();
  if (!suggesting) {
    suggesting = runSuggestions(ownerId).finally(() => { suggesting = null; });
  }
  return suggesting; // overlapping syncs share one pass
}

async function runSuggestions(ownerId: string) {
  try {
    await sendPendingSuggestions({
      listPending: () => listPendingSuggestions(ownerId),
      clear: clearSuggestion,
      isVerified: isLayoutVerified,
      suggest: suggestLayout,
      onVerified: async () => void (await refreshLayouts().catch(() => false)),
    });
  } catch (e) {
    report('error', 'sync.suggestions', e);
    // Left pending; the next sync tries again.
  }
}

export async function syncNow(ownerId: string): Promise<SyncResult> {
  // Live rounds first: the owner's phone takes in what friends entered before it pushes its own edits.
  await syncLive(ownerId);
  const result = await pushRounds(ownerId);
  await suggestPendingPars(ownerId);
  return result;
}

let liveRunning: Promise<void> | null = null;

/**
 * Sends our own seat of the rounds we follow, then pulls the rounds in progress we own or follow and merges what the
 * others entered. Best effort: never throws and never fails or delays a normal sync. Overlapping calls share one pass.
 */
export function syncLive(ownerId: string): Promise<void> {
  if (ownerId === GUEST_ID) return Promise.resolve();
  liveRunning ??= runLive(ownerId).finally(() => { liveRunning = null; });
  return liveRunning;
}

async function runLive(ownerId: string) {
  try {
    await syncLiveSeats({
      listDirtyLiveRoundIds: () => listDirtyLiveRoundIds(ownerId),
      getSeat: getLiveSeat,
      pushSeat: async (roundId, scores) => {
        const { data, error } = await supabase.rpc('sync_my_seat', { p_round: roundId, p_scores: scores });
        return { result: typeof data === 'string' ? data : null, error };
      },
      markSynced,
    });
    const { data, error } = await supabase.rpc('list_live_rounds');
    if (error || !Array.isArray(data)) return; // offline, or the server does not have live rounds yet
    await applyLive(ownerId, planLive(await listLiveState(ownerId), data as LiveRemoteRound[]));
  } catch (e) {
    report('error', 'sync.live', e);
  }
}

function pushRounds(ownerId: string): Promise<SyncResult> {
  return syncDirtyRounds({
    listDirtyRoundIds: () => listDirtyRoundIds(ownerId),
    getSource: getSyncSource,
    push: async (payload) => {
      const { error } = await supabase.rpc('sync_round', { payload });
      return { error };
    },
    markSynced,
    recordFailure: async (roundId, failure) => {
      await recordSyncFailure(roundId, failure);
      // Being offline is not a bug; only a refusal from the server is worth knowing about.
      if (failure.kind === 'rejected') report('sync', 'sync.rejected', failure.message);
    },
    listPendingDeleteIds: () => listPendingDeleteIds(ownerId),
    deleteRemote: async (roundId) => {
      const { data, error } = await supabase.rpc('delete_round', { p_round: roundId });
      return { result: typeof data === 'string' ? data : null, error };
    },
    finishDelete: finishPendingDelete,
  });
}

/**
 * Re-downloads the layouts already cached on this device (so corrections reach them). The full course list is
 * far too big to mirror; other courses arrive through search and are cached when picked. Failures are silent.
 */
export async function refreshLayouts(): Promise<boolean> {
  const cached = await listLayouts();
  if (cached.length === 0) return true;
  const { data, error } = await supabase
    .from('course_layouts')
    .select('id, hole_count, verified, courses(id, name, area), holes(number, par)')
    .in('id', cached.map((l) => l.layout_id));
  if (error || !data) return false;
  // A course that was removed server side (e.g. a duplicate cleaned up) must not stay selectable here: a round
  // started on it could never sync.
  const live = new Set((data as any[]).map((l) => l.id));
  await removeLayouts(cached.filter((l) => !live.has(l.layout_id)).map((l) => l.layout_id));
  for (const l of data as any[]) {
    await upsertLayout({
      layout_id: l.id,
      course_id: l.courses.id,
      course_name: l.courses.name,
      area: l.courses.area,
      hole_count: l.hole_count,
      verified: l.verified === true,
      pars: [...l.holes].sort((a: any, b: any) => a.number - b.number).map((h: any) => h.par),
    });
  }
  return true;
}

export { getRound };
