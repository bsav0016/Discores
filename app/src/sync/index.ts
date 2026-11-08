import {
  clearSuggestion, finishPendingDelete, getRound, getSyncSource, GUEST_ID, isLayoutVerified, listDirtyRoundIds,
  listLayouts, listPendingDeleteIds, listPendingSuggestions, markSynced, recordSyncFailure, removeLayouts, upsertLayout,
} from '@/db/local';
import { supabase } from '@/lib/supabase';
import { suggestLayout } from './courses';
import { syncDirtyRounds, type SyncResult } from './engine';
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
  } catch {
    // Left pending; the next sync tries again.
  }
}

export async function syncNow(ownerId: string): Promise<SyncResult> {
  const result = await pushRounds(ownerId);
  await suggestPendingPars(ownerId);
  return result;
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
    recordFailure: recordSyncFailure,
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
