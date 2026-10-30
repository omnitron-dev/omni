import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { PostgresMetricsStorage, MetricsService } from '@omnitron-dev/titan-metrics';
import { SyncService, type SyncBatch } from '../../src/services/sync.service.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';

const url = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const available = await requiresTestPostgres(url);
let own: OwnDatabase;
const node = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const at = Date.now() - 120_000;
function batch(value: unknown = 12): SyncBatch {
  const entries: SyncBatch['entries'] = [{ id: randomUUID(), category: 'metrics', createdAt: new Date().toISOString(),
    payload: { name: 'cpu_percent', value, timestamp: at, app: 'api', labels: { node: 'spoofed', rack: 'one' } } }];
  return { nodeId: node, batchId: randomUUID(), entries, checksum: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
function master(persistent = true) {
  const service = new SyncService(own.db, createNullLogger(), 'master', 'master');
  if (persistent) service.setMetricsStorage(new PostgresMetricsStorage(own.db));
  return service;
}
const count = async (table: 'sync_ingested' | 'metrics_samples') => Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(own.db)).rows[0]!.n);

beforeAll(async () => { if (available.ok) own = await databaseOfItsOwn(url, `omnitron_metric_commit_${process.pid}`); });
afterAll(async () => { await own?.drop(); });
beforeEach(async () => { if (available.ok) await sql`TRUNCATE metrics_samples, sync_ingested`.execute(own.db); });

describe.skipIf(!available.ok)('PostgreSQL payload and replication receipt', () => {
  it('confirms after commit, preserves source time and identity, and replays a lost acknowledgement once', async () => {
    const request = batch();
    const first = await master().receiveBatch(request);
    expect(first.committedIds).toEqual([request.entries[0]!.id]);
    const replay = await master().receiveBatch(request);
    expect(replay.committedIds).toEqual(first.committedIds);
    expect(replay.duplicateIds).toEqual(first.committedIds);
    expect(await count('sync_ingested')).toBe(1);
    expect(await count('metrics_samples')).toBe(1);
    const history = await new PostgresMetricsStorage(own.db).query({ labels: { node }, from: at - 1, to: at + 1 });
    expect(history).toEqual([{ name: 'cpu_percent', app: 'api', labels: { node, rack: 'one' }, points: [{ timestamp: at, value: 12 }] }]);
    expect(await new PostgresMetricsStorage(own.db).query({ labels: { node: 'spoofed' } })).toEqual([]);
  });

  it('does not acknowledge when COMMIT fails after both inserts; the identical batch succeeds on retry', async () => {
    await sql`CREATE FUNCTION fail_metric_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected commit refusal' USING ERRCODE = '40001'; END $$`.execute(own.db);
    await sql`CREATE CONSTRAINT TRIGGER fail_metric_commit AFTER INSERT ON metrics_samples
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_metric_commit()`.execute(own.db);
    const request = batch();
    try {
      const result = await master().receiveBatch(request);
      expect(result.failedIds).toEqual([request.entries[0]!.id]);
      expect(result.committedIds).toEqual([]);
      expect(await count('metrics_samples')).toBe(0);
      expect(await count('sync_ingested')).toBe(0);
    } finally {
      await sql`DROP TRIGGER fail_metric_commit ON metrics_samples`.execute(own.db);
      await sql`DROP FUNCTION fail_metric_commit()`.execute(own.db);
    }
    expect((await master().receiveBatch(request)).committedIds).toEqual([request.entries[0]!.id]);
  });

  it('keeps metrics pending without a durable destination and never upgrades historical unverified receipts', async () => {
    const request = batch(); const id = request.entries[0]!.id;
    expect((await master(false).receiveBatch(request)).failedIds).toEqual([id]);
    expect(await count('sync_ingested')).toBe(0);
    await own.db.insertInto('sync_ingested').values({ nodeId: node, entryId: id, outcome: 'unverified' }).execute();
    expect((await master().receiveBatch(request)).committedIds).toEqual([]);
    expect(await count('metrics_samples')).toBe(0);
  });

  it('reports malformed samples as explicit rejection rather than a commit', async () => {
    const request = batch('NaN');
    const result = await master().receiveBatch(request);
    expect(result.discardedIds).toEqual([request.entries[0]!.id]);
    expect(result.committedIds).toEqual([]);
    expect(await count('metrics_samples')).toBe(0);
  });

  it('requires a logged table and overrides a session with synchronous_commit=off', async () => {
    const storage = new PostgresMetricsStorage(own.db);
    const sample = { id: 'durable-1', name: 'cpu', timestamp: at, value: 1, labels: {} };
    await own.db.transaction().execute(async trx => {
      await sql`SET LOCAL synchronous_commit = off`.execute(trx);
      await storage.writeInTransaction(trx, [sample]);
      expect((await sql<{ value: string }>`SELECT current_setting('synchronous_commit') AS value`.execute(trx)).rows[0]!.value).toBe('on');
    });
    await sql`ALTER TABLE metrics_samples SET UNLOGGED`.execute(own.db);
    try { await expect(storage.write([{ ...sample, id: 'unsafe-2' }])).rejects.toThrow('logged'); }
    finally { await sql`ALTER TABLE metrics_samples SET LOGGED`.execute(own.db); }
    expect(await count('metrics_samples')).toBe(1);
  });

  it('returns a durable service receipt, detects identity misuse, aggregates in SQL and retains recent history', async () => {
    const storage = new PostgresMetricsStorage(own.db);
    const service = new MetricsService({ appName: 'test', collection: { enabled: false }, storage: { type: 'postgres' } }, storage);
    const start = Math.floor(at / 1000) * 1000;
    const samples = Array.from({ length: 30 }, (_, i) => ({ id: `sample-${i}`, name: 'requests_total', timestamp: start + i * 100,
      value: i, labels: { app: 'api', region: 'eu' } }));
    expect(await service.recordDurable(samples)).toMatchObject({ durability: 'persistent', samples: 30 });
    await service.recordDurable(samples);
    expect(await count('metrics_samples')).toBe(30);
    expect((await storage.query({ names: ['requests_total'], interval: '1s', limit: 2 }))[0]!.points.map(p => p.value)).toEqual([19, 29]);
    await expect(storage.write([{ ...samples[0]!, value: 500 }])).rejects.toThrow('identity conflicts');
    await storage.write([{ ...samples[0]!, id: 'expired', timestamp: Date.now() - 2 * 86_400_000 }]);
    await storage.cleanup(86_400_000);
    expect(await count('metrics_samples')).toBe(30);
  });

  it('bounds retention lock waits and preserves history when cleanup fails', async () => {
    const storage = new PostgresMetricsStorage(own.db, { statementTimeoutMs: 100 });
    const service = new MetricsService({ appName: 'test', collection: { enabled: false } }, storage);
    await storage.write([{ id: 'expired-locked', name: 'cpu', timestamp: 1, value: 1, labels: {} }]);
    await own.db.transaction().execute(async lock => {
      await sql`LOCK TABLE metrics_samples IN ACCESS EXCLUSIVE MODE`.execute(lock);
      await expect(service.cleanup()).rejects.toMatchObject({ code: '57014' });
      expect(service.getStorageStatus().cleanupError).toContain('statement timeout');
    });
    expect(await count('metrics_samples')).toBe(1);
    await service.cleanup();
    expect(service.getStorageStatus().cleanupError).toBeNull();
    expect(await count('metrics_samples')).toBe(0);
  });
});
