import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { SQLiteMetricsStorage, type MetricsDatabase } from '../src/sql-storage.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const undo of cleanup.splice(0).reverse()) await undo(); });
const sample = { id: 'sample-1', name: 'cpu', value: 1, timestamp: Date.now(), labels: { app: 'api' } };
function connection() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-metrics-'));
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const raw = new Database(path.join(directory, 'metrics.sqlite'));
  raw.pragma('journal_mode=WAL'); raw.pragma('synchronous=FULL');
  const db = new Kysely<MetricsDatabase>({ dialect: new SqliteDialect({ database: raw }) });
  cleanup.push(() => db.destroy());
  return { db, raw };
}

describe('SQLite persistence refuses incomplete setup', () => {
  it('rejects the failed DDL, retries setup, and returns only after the row is queryable', async () => {
    const { db, raw } = connection();
    const storage = new SQLiteMetricsStorage(db);
    raw.pragma('query_only=ON');
    await expect(storage.write([sample])).rejects.toThrow(/readonly/i);
    raw.pragma('query_only=OFF');
    await storage.write([sample]);
    expect(storage.capabilities.durability).toBe('persistent');
    expect(await new SQLiteMetricsStorage(db).query({ names: ['cpu'] })).toMatchObject([{ points: [{ value: 1 }] }]);
    await storage.write([sample]);
    expect(raw.prepare('SELECT count(*) AS n FROM metrics_samples').get()).toEqual({ n: 1 });
    await expect(storage.write([{ ...sample, value: 2 }])).rejects.toThrow('identity conflicts');
  });

  it('refuses relaxed disk durability, including a later connection reconfiguration', async () => {
    const { db, raw } = connection();
    const storage = new SQLiteMetricsStorage(db);
    raw.pragma('synchronous=NORMAL');
    await expect(storage.write([sample])).rejects.toThrow('synchronous=FULL');
    raw.pragma('synchronous=FULL');
    await storage.write([sample]);
    raw.pragma('synchronous=OFF');
    await expect(storage.write([{ ...sample, id: 'sample-2' }])).rejects.toThrow('synchronous=FULL');
  });
});
