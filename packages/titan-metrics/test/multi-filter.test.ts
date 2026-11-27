import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { SQLiteMetricsStorage, type MetricsDatabase } from '../src/sql-storage.js';
import { MemoryMetricsStorage } from '../src/storage.js';

const databases: Kysely<MetricsDatabase>[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.destroy(); });
function storage() {
  const db = new Kysely<MetricsDatabase>({ dialect: new SqliteDialect({ database: new Database(':memory:') }) });
  databases.push(db);
  return new SQLiteMetricsStorage(db);
}

describe('SQL history is filtered before limiting each distinct series', () => {
  it.each([['memory', () => new MemoryMetricsStorage()], ['sqlite', storage]] as const)(
    '%s preserves series identity across label order and separators in names', async (_, create) => {
      const store = create();
      const timestamp = Date.now() - 100;
      await store.write([
        { name: 'rpc|job', labels: { app: 'east', zone: 'a', path: '/' }, value: 1, timestamp },
        { name: 'rpc|job', labels: { path: '/', zone: 'a', app: 'east' }, value: 2, timestamp: timestamp + 1 },
        { name: 'rpc', labels: { app: 'job|east', zone: 'a', path: '/' }, value: 3, timestamp },
      ]);
      const series = await store.query({});
      expect(series).toHaveLength(2);
      expect(series.find(row => row.app === 'east')?.points.map(point => point.value)).toEqual([1, 2]);
      expect(series.find(row => row.app === 'job|east')?.points.map(point => point.value)).toEqual([3]);
    });

  it('keeps all requested names/apps and separates nodes and label order', async () => {
    const s = storage(); const now = Date.now();
    await s.write([0, 1, 2].flatMap(i => ['cpu', 'memory'].flatMap(name => ['a', 'b'].flatMap(app => ['one', 'two'].map(node => ({
      name, value: i, timestamp: now - 3000 + i * 1000, labels: i % 2 ? { node, app } : { app, node },
    }))))));
    const series = await s.query({ names: ['cpu', 'memory'], apps: ['a', 'b'], labels: { node: 'two' }, limit: 2 });
    expect(series).toHaveLength(4);
    for (const line of series) {
      expect(line.labels).toEqual({ node: 'two' });
      expect(line.points.map(p => p.value)).toEqual([1, 2]);
    }
    expect(await s.query({ apps: [] })).toEqual([]);
  });

  it('aggregates the complete window, uses last counter values, and enforces query budgets', async () => {
    const s = storage(); const now = Math.floor(Date.now() / 1000) * 1000;
    await s.write(Array.from({ length: 50 }, (_, i) => ({ name: 'requests_total', value: i, timestamp: now - 5000 + i * 100, labels: { app: 'a' } })));
    const rows = await s.query({ interval: '1s', limit: 2 });
    expect(rows[0]!.points.map(p => p.value)).toEqual([39, 49]);
    await expect(s.query({ limit: 0 })).rejects.toThrow('1..2000');
    await expect(s.query({ interval: '0s' })).rejects.toThrow('Invalid metric interval');
    const small = new SQLiteMetricsStorage(databases[0]!, { maxQueryPoints: 1 });
    await expect(small.query({ limit: 2 })).rejects.toThrow('narrow');
  });
});
