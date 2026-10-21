import * as SQLite from 'expo-sqlite';
import { holesScored, relativeToPar, totalStrokes, type ScoreMap } from '@/domain/scoring';
import type { StatRound } from '@/domain/stats';
import type { LocalRoundState, RestoreAction } from '@/sync/restore';
import { migrate } from './migrations';

// Local-first store. Everything the scorekeeper needs works with no network;
// rows flagged dirty are pushed by the sync engine.

export type LayoutRow = {
  layout_id: string;
  course_id: string;
  course_name: string;
  area: string | null;
  hole_count: number;
  pars: number[];
};

export type PlayerRow = {
  id: string;
  round_id: string;
  user_id: string | null;
  guest_name: string | null;
  /** Display name of a registered player (a friend, or someone in a round shared with us). */
  name: string | null;
  position: number;
};

export type FriendRow = {
  friendship_id: string;
  user_id: string;
  display_name: string;
  /** 'friend', 'incoming' (they asked you) or 'outgoing' (you asked them). */
  kind: 'friend' | 'incoming' | 'outgoing';
};

/** A finished round someone else scored that includes us, as returned by pull_shared_rounds(). */
export type SharedRound = {
  id: string;
  layout_id: string;
  course_name: string;
  hole_count: number;
  pars: number[];
  started_at: string;
  finished_at: string;
  players: {
    id: string;
    position: number;
    is_me: boolean;
    name: string;
    scores: { hole_number: number; strokes: number; updated_at: string }[];
  }[];
};

export type RoundRow = {
  id: string;
  owner_id: string;
  layout_id: string;
  course_name: string;
  hole_count: number;
  pars: number[];
  started_at: string;
  finished_at: string | null;
  dirty: boolean;
  /** Scored by someone else; read-only here. */
  shared: boolean;
};

export type RoundDetail = RoundRow & {
  players: (PlayerRow & { scores: ScoreMap; display_name: string })[];
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb() {
  dbPromise ??= open().catch((error) => {
    // Do not cache a failed open: the next call tries again instead of failing forever.
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

async function open() {
  const db = await SQLite.openDatabaseAsync('discores.db');
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrate(db);
  return db;
}

// ------------------------------------------------------------------ layouts
export async function replaceLayouts(layouts: LayoutRow[]) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM layouts');
    for (const l of layouts) {
      await db.runAsync(
        'INSERT INTO layouts (layout_id, course_id, course_name, area, hole_count, pars) VALUES (?,?,?,?,?,?)',
        l.layout_id, l.course_id, l.course_name, l.area, l.hole_count, JSON.stringify(l.pars),
      );
    }
  });
}

/** Adds or updates one cached layout, e.g. when a course is picked from search or added by the user. */
export async function upsertLayout(l: LayoutRow) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO layouts (layout_id, course_id, course_name, area, hole_count, pars) VALUES (?,?,?,?,?,?)
     ON CONFLICT(layout_id) DO UPDATE SET course_name = excluded.course_name, area = excluded.area,
       hole_count = excluded.hole_count, pars = excluded.pars`,
    l.layout_id, l.course_id, l.course_name, l.area, l.hole_count, JSON.stringify(l.pars),
  );
}

/** Drops cached layouts the server no longer has. Rounds keep their own copy of the course name and pars. */
export async function removeLayouts(layoutIds: string[]) {
  if (layoutIds.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of layoutIds) await db.runAsync('DELETE FROM layouts WHERE layout_id = ?', id);
  });
}

export async function listLayouts(): Promise<LayoutRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM layouts ORDER BY course_name');
  return rows.map((r) => ({ ...r, pars: JSON.parse(r.pars) }));
}

// ------------------------------------------------------------------- rounds
export async function createRound(args: {
  id: string;
  ownerId: string;
  layout: LayoutRow;
  players: { id: string; userId: string | null; guestName: string | null; name?: string | null }[];
  startedAt: string;
}) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO rounds (id, owner_id, layout_id, course_name, hole_count, pars, started_at, dirty)
       VALUES (?,?,?,?,?,?,?,1)`,
      args.id, args.ownerId, args.layout.layout_id, args.layout.course_name,
      args.layout.hole_count, JSON.stringify(args.layout.pars), args.startedAt,
    );
    for (const [i, p] of args.players.entries()) {
      await db.runAsync(
        'INSERT INTO round_players (id, round_id, user_id, guest_name, name, position) VALUES (?,?,?,?,?,?)',
        p.id, args.id, p.userId, p.guestName, p.name ?? null, i,
      );
    }
  });
}

/** Owner and seat id for rounds played without an account. They never leave the device until adopted. */
export const GUEST_ID = 'guest';

export async function countGuestRounds(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM rounds WHERE owner_id = ?', GUEST_ID);
  return row?.n ?? 0;
}

/** Moves rounds played as a guest onto a real account (dirty, so they sync next). Returns how many moved. */
export async function adoptGuestRounds(userId: string, name: string): Promise<number> {
  const db = await getDb();
  let moved = 0;
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync('UPDATE rounds SET owner_id = ?, dirty = 1, rev = rev + 1 WHERE owner_id = ?', userId, GUEST_ID);
    moved = r.changes;
    if (moved > 0) await db.runAsync('UPDATE round_players SET user_id = ?, name = ? WHERE user_id = ?', userId, name, GUEST_ID);
  });
  return moved;
}

export async function setScore(playerId: string, roundId: string, hole: number, strokes: number, now: string) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO scores (round_player_id, hole_number, strokes, updated_at) VALUES (?,?,?,?)
       ON CONFLICT (round_player_id, hole_number) DO UPDATE SET strokes = excluded.strokes, updated_at = excluded.updated_at`,
      playerId, hole, strokes, now,
    );
    await db.runAsync('UPDATE rounds SET dirty = 1, rev = rev + 1 WHERE id = ?', roundId);
  });
}

export async function finishRound(roundId: string, now: string) {
  const db = await getDb();
  await db.runAsync('UPDATE rounds SET finished_at = ?, dirty = 1, rev = rev + 1 WHERE id = ?', now, roundId);
}

/**
 * Deletes a round. A round that exists only on this phone (played as a guest, or shared with us and read-only here)
 * is removed at once. One of our own rounds may be on the server, so it is hidden and queued ('queued') until the
 * server has deleted it too; the sync engine finishes the job, so the delete also works offline.
 */
export async function deleteRound(roundId: string): Promise<'removed' | 'queued'> {
  const db = await getDb();
  const round = await db.getFirstAsync<{ owner_id: string; shared: number }>(
    'SELECT owner_id, shared FROM rounds WHERE id = ?', roundId);
  if (!round) return 'removed';
  if (round.shared || round.owner_id === GUEST_ID) {
    await db.runAsync('DELETE FROM rounds WHERE id = ?', roundId);
    return 'removed';
  }
  await db.runAsync('UPDATE rounds SET pending_delete = 1 WHERE id = ?', roundId);
  return 'queued';
}

export async function listPendingDeleteIds(ownerId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM rounds WHERE owner_id = ? AND pending_delete = 1', ownerId);
  return rows.map((r) => r.id);
}

/** Removes a queued delete from this phone once the server has confirmed it. */
export async function finishPendingDelete(roundId: string) {
  const db = await getDb();
  await db.runAsync('DELETE FROM rounds WHERE id = ? AND pending_delete = 1', roundId);
}

function toRound(r: any): RoundRow {
  return { ...r, pars: JSON.parse(r.pars), dirty: !!r.dirty, shared: !!r.shared };
}

/** History rows (own and shared), summarised for the signed-in user's own seat. */
export async function listRounds(
  ownerId: string,
): Promise<(RoundRow & { total: number; scored: number; relative: number })[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM rounds WHERE owner_id = ? AND pending_delete = 0 ORDER BY started_at DESC', ownerId);
  const scoreRows = await db.getAllAsync<{ round_id: string; hole_number: number; strokes: number }>(
    `SELECT p.round_id, s.hole_number, s.strokes FROM scores s
       JOIN round_players p ON p.id = s.round_player_id
       JOIN rounds r ON r.id = p.round_id
      WHERE r.owner_id = ? AND r.pending_delete = 0 AND p.user_id = r.owner_id`, ownerId);
  const byRound = new Map<string, ScoreMap>();
  for (const s of scoreRows) {
    const m = byRound.get(s.round_id) ?? {};
    m[s.hole_number] = s.strokes;
    byRound.set(s.round_id, m);
  }
  return rows.map((r) => {
    const round = toRound(r);
    const scores = byRound.get(round.id) ?? {};
    return {
      ...round,
      total: totalStrokes(scores),
      scored: holesScored(scores),
      relative: relativeToPar(round.pars, scores),
    };
  });
}

/** Finished rounds (own and shared) with the signed-in player's own scores, for the stats screen. */
export async function listStatRounds(ownerId: string): Promise<StatRound[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM rounds WHERE owner_id = ? AND finished_at IS NOT NULL AND pending_delete = 0', ownerId);
  const scoreRows = await db.getAllAsync<{ round_id: string; hole_number: number; strokes: number }>(
    `SELECT p.round_id, s.hole_number, s.strokes FROM scores s
       JOIN round_players p ON p.id = s.round_player_id
       JOIN rounds r ON r.id = p.round_id
      WHERE r.owner_id = ? AND r.pending_delete = 0 AND r.finished_at IS NOT NULL AND p.user_id = r.owner_id`, ownerId);
  const byRound = new Map<string, ScoreMap>();
  for (const s of scoreRows) {
    const m = byRound.get(s.round_id) ?? {};
    m[s.hole_number] = s.strokes;
    byRound.set(s.round_id, m);
  }
  return rows.map((r) => ({
    id: r.id, layoutId: r.layout_id, courseName: r.course_name, pars: JSON.parse(r.pars),
    startedAt: r.started_at, scores: byRound.get(r.id) ?? {},
  }));
}

export async function getRound(roundId: string): Promise<RoundDetail | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<any>('SELECT * FROM rounds WHERE id = ?', roundId);
  if (!r) return null;
  const players = await db.getAllAsync<PlayerRow>(
    'SELECT * FROM round_players WHERE round_id = ? ORDER BY position', roundId);
  const scores = await db.getAllAsync<{ round_player_id: string; hole_number: number; strokes: number }>(
    `SELECT s.* FROM scores s JOIN round_players p ON p.id = s.round_player_id WHERE p.round_id = ?`, roundId);
  return {
    ...toRound(r),
    players: players.map((p) => ({
      ...p,
      // The signed-in user's own seat carries their id (owner_id also holds it for shared rounds).
      display_name: p.user_id && p.user_id === r.owner_id ? 'You' : (p.guest_name ?? p.name ?? 'Player'),
      scores: Object.fromEntries(
        scores.filter((s) => s.round_player_id === p.id).map((s) => [s.hole_number, s.strokes])),
    })),
  };
}

// --------------------------------------------------------------------- sync
export async function listDirtyRoundIds(ownerId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM rounds WHERE owner_id = ? AND dirty = 1 AND pending_delete = 0', ownerId);
  return rows.map((r) => r.id);
}

export async function getSyncSource(roundId: string) {
  const db = await getDb();
  const round = await db.getFirstAsync<any>('SELECT * FROM rounds WHERE id = ?', roundId);
  const players = await db.getAllAsync<PlayerRow>('SELECT * FROM round_players WHERE round_id = ?', roundId);
  const scores = await db.getAllAsync<any>(
    `SELECT s.* FROM scores s JOIN round_players p ON p.id = s.round_player_id WHERE p.round_id = ?`, roundId);
  return { round, players, scores };
}

/** Clears dirty only if nothing changed since the pushed revision (edits during an in-flight push bump rev). */
export async function markSynced(roundId: string, pushedRev: number) {
  const db = await getDb();
  await db.runAsync('UPDATE rounds SET dirty = 0 WHERE id = ? AND rev = ?', roundId, pushedRev);
}

// ------------------------------------------------------------ restore (own rounds)
/** What this phone holds for the user's own rounds, for planRestore(). Shared (read-only) rounds are not included. */
export async function listRestoreState(ownerId: string): Promise<LocalRoundState[]> {
  const db = await getDb();
  const rounds = await db.getAllAsync<any>(
    'SELECT id, dirty, pending_delete, finished_at FROM rounds WHERE owner_id = ? AND shared = 0', ownerId);
  const players = await db.getAllAsync<{ id: string; round_id: string }>(
    'SELECT p.id, p.round_id FROM round_players p JOIN rounds r ON r.id = p.round_id WHERE r.owner_id = ? AND r.shared = 0',
    ownerId);
  const scores = await db.getAllAsync<{ round_player_id: string; hole_number: number; updated_at: string }>(
    `SELECT s.round_player_id, s.hole_number, s.updated_at FROM scores s
     JOIN round_players p ON p.id = s.round_player_id JOIN rounds r ON r.id = p.round_id
     WHERE r.owner_id = ? AND r.shared = 0`, ownerId);
  const byRound = new Map<string, LocalRoundState>(rounds.map((r) => [r.id, {
    id: r.id, dirty: !!r.dirty, pendingDelete: !!r.pending_delete, finishedAt: r.finished_at, playerIds: [], scores: {},
  }]));
  const roundOfPlayer = new Map<string, string>();
  for (const p of players) {
    roundOfPlayer.set(p.id, p.round_id);
    byRound.get(p.round_id)?.playerIds.push(p.id);
  }
  for (const s of scores) {
    const roundId = roundOfPlayer.get(s.round_player_id);
    if (roundId) byRound.get(roundId)!.scores[`${s.round_player_id}:${s.hole_number}`] = s.updated_at;
  }
  return [...byRound.values()];
}

/**
 * Applies a plan from planRestore(). Restored rows are clean (dirty = 0): they came from the server, so there is
 * nothing to push, and sync_round is never called for them, which also means no friend is asked to confirm again.
 */
export async function applyRestore(ownerId: string, actions: RestoreAction[]) {
  if (actions.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const a of actions) {
      if (a.type === 'drop') {
        await db.runAsync('DELETE FROM rounds WHERE id = ? AND owner_id = ? AND shared = 0', a.id, ownerId);
      } else if (a.type === 'insert') {
        const r = a.round;
        // A stale shared copy of this id (or another account's) must not block the restore.
        await db.runAsync('DELETE FROM rounds WHERE id = ? AND (shared = 1 OR owner_id <> ?)', r.id, ownerId);
        await db.runAsync(
          `INSERT OR IGNORE INTO rounds (id, owner_id, layout_id, course_name, hole_count, pars, started_at, finished_at,
                                         dirty, rev, shared) VALUES (?,?,?,?,?,?,?,?,0,0,0)`,
          r.id, ownerId, r.layout_id, r.course_name, r.hole_count, JSON.stringify(r.pars), r.started_at, r.finished_at,
        );
        for (const p of r.players) await insertRestoredPlayer(db, r.id, p);
        for (const p of r.players) {
          for (const s of p.scores) await insertRestoredScore(db, p.id, s.hole_number, s.strokes, s.updated_at);
        }
      } else {
        if (a.finishedAt) await db.runAsync('UPDATE rounds SET finished_at = ? WHERE id = ?', a.finishedAt, a.id);
        for (const p of a.players) await insertRestoredPlayer(db, a.id, p);
        for (const s of a.scores) await insertRestoredScore(db, s.playerId, s.hole, s.strokes, s.updatedAt);
      }
    }
  });
}

async function insertRestoredPlayer(
  db: SQLite.SQLiteDatabase, roundId: string,
  p: { id: string; position: number; user_id: string | null; guest_name: string | null; name: string | null },
) {
  await db.runAsync(
    'INSERT OR IGNORE INTO round_players (id, round_id, user_id, guest_name, name, position) VALUES (?,?,?,?,?,?)',
    p.id, roundId, p.user_id, p.guest_name, p.name, p.position,
  );
}

async function insertRestoredScore(
  db: SQLite.SQLiteDatabase, playerId: string, hole: number, strokes: number, updatedAt: string,
) {
  await db.runAsync(
    `INSERT INTO scores (round_player_id, hole_number, strokes, updated_at) VALUES (?,?,?,?)
     ON CONFLICT (round_player_id, hole_number) DO UPDATE SET strokes = excluded.strokes, updated_at = excluded.updated_at`,
    playerId, hole, strokes, updatedAt,
  );
}

// ------------------------------------------------------------------ friends
export async function replaceFriends(rows: FriendRow[]) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM friends');
    for (const f of rows) {
      await db.runAsync(
        'INSERT INTO friends (friendship_id, user_id, display_name, kind) VALUES (?,?,?,?)',
        f.friendship_id, f.user_id, f.display_name, f.kind,
      );
    }
  });
}

export async function listFriends(): Promise<FriendRow[]> {
  const db = await getDb();
  return db.getAllAsync<FriendRow>(
    `SELECT * FROM friends ORDER BY CASE kind WHEN 'incoming' THEN 0 WHEN 'friend' THEN 1 ELSE 2 END, display_name`);
}

// ------------------------------------------------------------ shared rounds
/**
 * Replaces our local copy of rounds shared with us. They are stored read-only (dirty = 0, never pushed): the
 * round row's owner_id is the signed-in user so the history query finds it, and our own seat carries our id.
 */
export async function replaceSharedRounds(myId: string, rounds: SharedRound[]) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM rounds WHERE shared = 1 AND owner_id = ?', myId);
    for (const r of rounds) {
      // Another account on this device may hold a stale copy of the same round; this account's view replaces it.
      await db.runAsync('DELETE FROM rounds WHERE id = ? AND owner_id <> ?', r.id, myId);
      await db.runAsync(
        `INSERT OR IGNORE INTO rounds (id, owner_id, layout_id, course_name, hole_count, pars, started_at, finished_at,
                                       dirty, rev, shared) VALUES (?,?,?,?,?,?,?,?,0,0,1)`,
        r.id, myId, r.layout_id, r.course_name, r.hole_count, JSON.stringify(r.pars), r.started_at, r.finished_at,
      );
      for (const p of r.players) {
        await db.runAsync(
          'INSERT OR IGNORE INTO round_players (id, round_id, user_id, guest_name, name, position) VALUES (?,?,?,?,?,?)',
          p.id, r.id, p.is_me ? myId : null, null, p.name, p.position,
        );
        for (const s of p.scores) {
          await db.runAsync(
            'INSERT OR IGNORE INTO scores (round_player_id, hole_number, strokes, updated_at) VALUES (?,?,?,?)',
            p.id, s.hole_number, s.strokes, s.updated_at,
          );
        }
      }
    }
  });
}

export async function wipeLocalData() {
  const db = await getDb();
  await db.execAsync(
    'DELETE FROM scores; DELETE FROM round_players; DELETE FROM rounds; DELETE FROM layouts; DELETE FROM friends;');
}
