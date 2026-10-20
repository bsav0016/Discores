import { LATEST_VERSION, MIGRATIONS, migrate, type Migration, type MigrationDb } from './migrations';

import { createTestDb as testDb } from './testDb';

const version = (db: { raw: any }) => db.raw.prepare('PRAGMA user_version').get().user_version as number;
const columns = (db: { raw: any }, table: string) =>
  (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort();
const tables = (db: { raw: any }) =>
  (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
    .map((t) => t.name);

// The database exactly as the first release created it, before versioning existed (user_version 0).
async function installFirstRelease(db: MigrationDb) {
  await MIGRATIONS[0].up(db);
}

describe('migrate', () => {
  it('builds the full schema on a fresh install and records the version', async () => {
    const db = testDb();
    await migrate(db);

    expect(version(db)).toBe(LATEST_VERSION);
    expect(tables(db)).toEqual(['friends', 'layouts', 'round_players', 'rounds', 'scores']);
    expect(columns(db, 'rounds')).toContain('shared');
    expect(columns(db, 'round_players')).toContain('name');
    expect(columns(db, 'rounds')).toContain('pending_delete');
  });

  it('upgrades a first-release database and keeps its data', async () => {
    const db = testDb();
    await installFirstRelease(db);
    db.raw.exec(`
      INSERT INTO rounds (id, owner_id, layout_id, course_name, hole_count, pars, started_at)
        VALUES ('r1', 'u1', 'L1', 'Maple Hill', 18, '[3,3,3]', '2026-10-04T10:00:00Z');
      INSERT INTO round_players (id, round_id, user_id, position) VALUES ('p1', 'r1', 'u1', 0);
      INSERT INTO scores (round_player_id, hole_number, strokes, updated_at) VALUES ('p1', 1, 3, '2026-10-04T10:05:00Z');
    `);
    expect(version(db)).toBe(0);

    await migrate(db);

    expect(version(db)).toBe(LATEST_VERSION);
    const round = db.raw.prepare('SELECT * FROM rounds WHERE id = ?').get('r1');
    expect(round.course_name).toBe('Maple Hill');
    expect(round.shared).toBe(0);
    expect(db.raw.prepare('SELECT strokes FROM scores').get().strokes).toBe(3);
  });

  it('accepts a database that already got the later columns before versioning', async () => {
    const db = testDb();
    await installFirstRelease(db);
    db.raw.exec('ALTER TABLE rounds ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
    db.raw.exec('ALTER TABLE round_players ADD COLUMN name TEXT');
    db.raw.exec(`INSERT INTO rounds (id, owner_id, layout_id, course_name, hole_count, pars, started_at, shared)
      VALUES ('r1', 'u1', 'L1', 'Maple Hill', 18, '[3]', '2026-10-04T10:00:00Z', 1)`);

    await migrate(db);

    expect(version(db)).toBe(LATEST_VERSION);
    expect(db.raw.prepare('SELECT shared FROM rounds').get().shared).toBe(1);
  });

  it('gives an upgraded database the same schema as a fresh install', async () => {
    const upgraded = testDb();
    await installFirstRelease(upgraded);
    await migrate(upgraded);
    const fresh = testDb();
    await migrate(fresh);

    for (const table of tables(fresh)) {
      expect(columns(upgraded, table)).toEqual(columns(fresh, table));
    }
  });

  it('does nothing when run again', async () => {
    const db = testDb();
    await migrate(db);
    db.raw.exec("INSERT INTO friends (friendship_id, user_id, display_name, kind) VALUES ('f1', 'u2', 'Sam', 'friend')");

    await migrate(db);

    expect(version(db)).toBe(LATEST_VERSION);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM friends').get().n).toBe(1);
  });

  it('rolls a failed step back completely, reports the error and stays at the old version', async () => {
    const db = testDb();
    await migrate(db);
    const broken: Migration = {
      version: LATEST_VERSION + 1,
      name: 'fails half way',
      up: async (d) => {
        await d.execAsync('ALTER TABLE rounds ADD COLUMN half_done TEXT');
        throw new Error('disk full');
      },
    };

    await expect(migrate(db, [...MIGRATIONS, broken])).rejects.toThrow('disk full');

    expect(version(db)).toBe(LATEST_VERSION);
    expect(columns(db, 'rounds')).not.toContain('half_done');
  });

  it('leaves a database from a newer version of the app alone', async () => {
    const db = testDb();
    await migrate(db);
    db.raw.exec(`PRAGMA user_version = ${LATEST_VERSION + 5}`);

    await expect(migrate(db)).resolves.toBeUndefined();

    expect(version(db)).toBe(LATEST_VERSION + 5);
  });

  it('numbers its steps 1, 2, 3... with no gaps or repeats', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });
});
