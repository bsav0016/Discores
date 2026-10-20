// Test helper, not used by the app: a real SQLite (Node's built-in one) behind the slice of expo-sqlite's API that
// the database code uses, so migrations and queries can be tested without a phone. Loaded with getBuiltinModule
// because Jest cannot resolve the prefix-only `node:sqlite` module by name.
import type { MigrationDb } from './migrations';

const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');

export type TestDb = MigrationDb & {
  raw: any;
  runAsync(sql: string, ...params: any[]): Promise<{ changes: number }>;
};

export function createTestDb(): TestDb {
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    execAsync: async (sql) => void raw.exec(sql),
    runAsync: async (sql, ...params) => ({ changes: Number(raw.prepare(sql).run(...params).changes) }),
    getFirstAsync: async (sql, ...params) => raw.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, ...params) => raw.prepare(sql).all(...params),
    withTransactionAsync: async (task) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
