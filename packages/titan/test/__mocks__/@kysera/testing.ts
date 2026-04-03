/**
 * Mock for @kysera/testing
 */

import { vi } from 'vitest';

export const testInTransaction = vi.fn().mockImplementation(async (db, fn) => {
  // Use Kysely's actual transaction API to create a real transaction
  // that will rollback at the end
  await db
    .transaction()
    .execute(async (trx: unknown) => {
      await fn(trx);
      // Throw to rollback - real testInTransaction would do this automatically
      throw new Error('ROLLBACK_FOR_TEST');
    })
    .catch((e: Error) => {
      if (e.message !== 'ROLLBACK_FOR_TEST') throw e;
      // Rollback is expected
    });
});

export const testWithSavepoints = vi.fn().mockImplementation(async (db, fn) => {
  await fn(db);
});

export const testWithIsolation = vi.fn().mockImplementation(async (db, fn, options) => {
  await fn(db);
});

export const cleanDatabase = vi.fn().mockResolvedValue(undefined);

export const seedDatabase = vi.fn().mockResolvedValue(undefined);

export const snapshotTable = vi.fn().mockImplementation(async (db, tableName) => {
  // Return result from actual database query
  const result = await db.selectFrom(tableName).selectAll().execute();
  return result;
});

export const countRows = vi.fn().mockImplementation(async (db, tableName) => {
  // Use raw SQL for SQLite compatibility (db.fn.count('*') doesn't work in SQLite)
  const { sql } = await import('kysely');
  const result = await db
    .selectFrom(tableName)
    .select(sql`count(*)`.as('count'))
    .executeTakeFirst();
  return Number(result?.count || 0);
});

export const waitFor = vi.fn().mockImplementation(async (condition, options) => {
  const result = await condition();
  if (!result) {
    throw new Error('Condition not met');
  }
});

export const createFactory = vi.fn().mockImplementation((defaults) => (overrides = {}) => {
  const result = {} as any;
  for (const key of Object.keys(defaults)) {
    const defaultValue = (defaults as any)[key];
    const overrideValue = (overrides as any)?.[key];

    if (overrideValue !== undefined) {
      result[key] = overrideValue;
    } else if (typeof defaultValue === 'function') {
      result[key] = defaultValue();
    } else {
      result[key] = defaultValue;
    }
  }
  return result;
});

export const createMany = vi.fn().mockImplementation((factory, count) =>
  Array(count)
    .fill(null)
    .map(() => factory())
);

export const createSequenceFactory = vi.fn().mockImplementation((fn) => {
  let seq = 0;
  return () => fn(++seq);
});

export const assertRowExists = vi.fn().mockResolvedValue(undefined);
export const assertRowNotExists = vi.fn().mockResolvedValue(undefined);

export const composeSeeders = vi.fn().mockImplementation((seeders) => async (db: any) => {
  for (const seeder of seeders) {
    await seeder(db);
  }
});

// Plugin testing utilities
export const createMockPlugin = vi.fn().mockImplementation((overrides = {}) => ({
  name: 'mock-plugin',
  transformQuery: vi.fn((args: any) => args.node),
  transformResult: vi.fn(async (args: any) => args),
  ...overrides,
}));

export const spyOnPlugin = vi.fn().mockImplementation((plugin) => plugin);

export const assertPluginBehavior = vi.fn().mockResolvedValue(undefined);

export const createInMemoryDatabase = vi.fn().mockResolvedValue({
  selectFrom: vi.fn().mockReturnThis(),
  insertInto: vi.fn().mockReturnThis(),
  updateTable: vi.fn().mockReturnThis(),
  deleteFrom: vi.fn().mockReturnThis(),
  destroy: vi.fn().mockResolvedValue(undefined),
});

export const createPluginTestHarness = vi.fn().mockImplementation((options) => ({
  db: options.db || {},
  plugins: options.plugins || [],
  execute: vi.fn().mockResolvedValue(undefined),
}));
