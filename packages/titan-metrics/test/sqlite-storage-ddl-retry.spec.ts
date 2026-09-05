/**
 * A DDL failure must not mark the storage ready.
 *
 * `ensureTable()` swallows the create-table error under the reason "Table may
 * already exist or schema API not available" — both benign — and then set
 * `initialized = true` outside the try. A DDL that genuinely failed
 * (permissions, a full disk, a locked database) was therefore declared done,
 * and every subsequent write went to a table that does not exist, reporting a
 * missing-table error whose actual cause had been discarded one call earlier.
 *
 * This class has no logger to report the swallow through, so keeping
 * `initialized` false is the only available way to leave the failure
 * recoverable: the next write retries the DDL.
 */
import { describe, it, expect, vi } from 'vitest';

import { SQLiteMetricsStorage } from '../src/storage.js';

function fakeDb(createTable: () => any) {
  const executed: unknown[][] = [];
  return {
    executed,
    schema: {
      createTable,
      createIndex: () => ({
        ifNotExists: () => ({ on: () => ({ columns: () => ({ execute: async () => undefined }) }) }),
      }),
    },
    insertInto: () => ({
      values: (rows: unknown[]) => ({
        execute: async () => {
          executed.push(rows);
        },
      }),
    }),
  } as any;
}

describe('SQLiteMetricsStorage - DDL failure', () => {
  it('retries the DDL on the next write instead of declaring itself ready', async () => {
    let attempts = 0;
    const createTable = vi.fn(() => ({
      ifNotExists: () => ({
        addColumn: function addColumn() {
          return this;
        },
        execute: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('SQLITE_READONLY: attempt to write a readonly database');
        },
      }),
    }));

    const db = fakeDb(createTable);
    const storage = new SQLiteMetricsStorage(db, { batchSize: 1_000_000, flushInterval: 1_000_000 });

    await storage.write([{ name: 'm', value: 1, timestamp: Date.now(), app: 'a', labels: {} } as any]);
    await storage.write([{ name: 'm', value: 2, timestamp: Date.now(), app: 'a', labels: {} } as any]);

    // Before the fix the first (failed) attempt set `initialized = true` and
    // the DDL was never tried again.
    expect(attempts).toBe(2);

    await storage.close?.();
  });
});
