// On-device schema versioning. The database file lives on the user's phone and survives app updates, so every
// schema change has to be a numbered step that upgrades an existing file. The version is stored in SQLite's own
// `PRAGMA user_version`.
//
// Add a change by appending a step with the next number. Never edit or reorder a step that has shipped: phones
// that already ran it will not run it again.

/** The part of expo-sqlite's database that migrations use (so tests can run them on another SQLite). */
export interface MigrationDb {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: any[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: any[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export type Migration = {
  version: number;
  name: string;
  up: (db: MigrationDb) => Promise<void>;
};

/** Adds a column unless the table already has it, so a database that got the column the old way is accepted. */
async function addColumnIfMissing(db: MigrationDb, table: string, column: string, definition: string) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((c) => c.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'first-release schema',
    // IF NOT EXISTS because phones that installed before versioning already have these tables at version 0.
    up: (db) =>
      db.execAsync(`
        CREATE TABLE IF NOT EXISTS layouts (
          layout_id TEXT PRIMARY KEY, course_id TEXT NOT NULL, course_name TEXT NOT NULL,
          area TEXT, hole_count INTEGER NOT NULL, pars TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rounds (
          id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, layout_id TEXT NOT NULL,
          course_name TEXT NOT NULL, hole_count INTEGER NOT NULL, pars TEXT NOT NULL,
          started_at TEXT NOT NULL, finished_at TEXT, dirty INTEGER NOT NULL DEFAULT 1,
          rev INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS round_players (
          id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
          user_id TEXT, guest_name TEXT, position INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS friends (
          friendship_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, display_name TEXT NOT NULL, kind TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scores (
          round_player_id TEXT NOT NULL REFERENCES round_players(id) ON DELETE CASCADE,
          hole_number INTEGER NOT NULL, strokes INTEGER NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY (round_player_id, hole_number)
        );
      `),
  },
  {
    version: 2,
    name: 'shared rounds and player names',
    up: async (db) => {
      await addColumnIfMissing(db, 'rounds', 'shared', 'INTEGER NOT NULL DEFAULT 0');
      await addColumnIfMissing(db, 'round_players', 'name', 'TEXT');
    },
  },
  {
    version: 3,
    name: 'queued round deletes',
    // A deleted round waits here (hidden everywhere) until the server has acknowledged the delete.
    up: (db) => addColumnIfMissing(db, 'rounds', 'pending_delete', 'INTEGER NOT NULL DEFAULT 0'),
  },
  {
    version: 4,
    name: 'verified course layouts',
    // Cached layouts start unverified; the next search or refresh brings the real flag.
    up: (db) => addColumnIfMissing(db, 'layouts', 'verified', 'INTEGER NOT NULL DEFAULT 0'),
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

async function currentVersion(db: MigrationDb): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Brings the database up to the latest version, one step at a time. Each step and its version bump are one
 * transaction, so a step that fails leaves the database exactly as it was and the error is thrown (it is never
 * swallowed: the app should not carry on with a half-upgraded file).
 *
 * A database newer than this app (a downgrade) is left alone rather than touched.
 */
export async function migrate(db: MigrationDb, migrations: Migration[] = MIGRATIONS): Promise<void> {
  const from = await currentVersion(db);
  for (const step of migrations.filter((m) => m.version > from)) {
    await db.withTransactionAsync(async () => {
      await step.up(db);
      // PRAGMA cannot take a bound parameter; the version is a number from this file.
      await db.execAsync(`PRAGMA user_version = ${Math.trunc(step.version)}`);
    });
  }
}
