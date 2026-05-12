/**
 * Regression test for T#64 — PG/SQLite `query`/`getLatest`
 * silently dropped all but the FIRST entry of `filter.names` /
 * `filter.apps` / `apps`. A query
 *
 *    storage.query({ names: ['cpu_percent', 'memory_mb'] })
 *
 * returned only `cpu_percent` rows; the caller saw an
 * inexplicably empty `memory_mb` series and assumed the metric
 * was never collected.
 *
 * Fix: when length > 1, use Kysely's `where(col, 'in', list)`.
 * When length === 1, keep the existing `=` path (small wins on
 * index usage in some dialects).
 *
 * The PostgresMetricsStorage / SQLiteMetricsStorage classes are
 * thin Kysely wrappers — we exercise them with a stub query
 * builder that records every `.where(...)` call. Assertions:
 *   - multi-name → `where('name', 'in', [...])`
 *   - multi-app  → `where('app', 'in', [...])`
 *   - single name → `where('name', '=', 'foo')` (unchanged)
 */

import { describe, it, expect, vi } from 'vitest';
import { PostgresMetricsStorage } from '../src/storage.js';

type WhereCall = readonly [string, string, unknown];

function mkFakeDb(): { db: any; calls: WhereCall[] } {
  const calls: WhereCall[] = [];
  // Recording chainable mock that mirrors the Kysely fluent
  // surface we touch in query()/getLatest().
  const builder: any = {
    select: vi.fn(() => builder),
    where: vi.fn((col: string, op: string, val: unknown) => {
      calls.push([col, op, val]);
      return builder;
    }),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    execute: vi.fn(async () => []),
  };
  const db: any = {
    selectFrom: vi.fn(() => builder),
    insertInto: vi.fn(() => ({ values: vi.fn(() => ({ execute: vi.fn(async () => undefined) })) })),
    deleteFrom: vi.fn(() => ({ where: vi.fn(() => ({ execute: vi.fn(async () => undefined) })) })),
    schema: { createTable: vi.fn(), createIndex: vi.fn() },
  };
  return { db, calls };
}

describe('PostgresMetricsStorage — multi-value filters (T#64)', () => {
  it('query() uses `in` for multi-name filter', async () => {
    const { db, calls } = mkFakeDb();
    const storage = new PostgresMetricsStorage(db);
    await storage.query({ names: ['cpu_percent', 'memory_mb'] });

    const nameCall = calls.find((c) => c[0] === 'name');
    expect(nameCall).toBeDefined();
    expect(nameCall![1]).toBe('in');
    expect(nameCall![2]).toEqual(['cpu_percent', 'memory_mb']);
  });

  it('query() uses `=` for single-name filter (unchanged path)', async () => {
    const { db, calls } = mkFakeDb();
    const storage = new PostgresMetricsStorage(db);
    await storage.query({ names: ['cpu_percent'] });

    const nameCall = calls.find((c) => c[0] === 'name');
    expect(nameCall![1]).toBe('=');
    expect(nameCall![2]).toBe('cpu_percent');
  });

  it('query() uses `in` for multi-app filter', async () => {
    const { db, calls } = mkFakeDb();
    const storage = new PostgresMetricsStorage(db);
    await storage.query({ apps: ['main', 'storage', 'gateway'] });

    const appCall = calls.find((c) => c[0] === 'app');
    expect(appCall![1]).toBe('in');
    expect(appCall![2]).toEqual(['main', 'storage', 'gateway']);
  });

  it('getLatest() uses `in` for multi-app filter', async () => {
    const { db, calls } = mkFakeDb();
    const storage = new PostgresMetricsStorage(db);
    await storage.getLatest(['main', 'storage']);

    const appCall = calls.find((c) => c[0] === 'app');
    expect(appCall![1]).toBe('in');
    expect(appCall![2]).toEqual(['main', 'storage']);
  });
});
