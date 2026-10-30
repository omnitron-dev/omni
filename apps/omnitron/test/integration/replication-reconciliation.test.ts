import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { PostgresMetricsStorage } from '@omnitron-dev/titan-metrics';
import { SyncService } from '../../src/services/sync.service.js';
import { SlaveStorageService } from '../../src/services/slave-storage.service.js';
import { acknowledgeReconciliation, prepareReconciliationStore, readUnverifiedMetrics, reconcileMetricPage,
  reconciliationSummaries, replicatedMetric } from '../../src/services/replication-reconciliation.js';
import { syncFinding, syncWords } from '../../src/shared/sync-reading.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';

const url = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const available = await requiresTestPostgres(url);
const node = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
let own: OwnDatabase;
let queries: string[] = [];
const cleanup: Array<() => Promise<void> | void> = [];
beforeAll(async () => { if (available.ok) own = await databaseOfItsOwn(url, `omnitron_reconcile_${process.pid}`, query => queries.push(query)); });
afterAll(async () => { await own?.drop(); });
afterEach(async () => { for (const undo of cleanup.splice(0).reverse()) await undo(); });
beforeEach(async () => {
  if (!available.ok) return;
  await sql`TRUNCATE metrics_samples, sync_ingested`.execute(own.db);
  const exists = (await sql<{ t: string | null }>`SELECT to_regclass('sync_reconciliations')::text t`.execute(own.db)).rows[0]?.t;
  if (exists) await sql`TRUNCATE sync_reconciliations, sync_reconciliation_totals`.execute(own.db);
});

async function source(count = 3) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-reconciliation-'));
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'slave.db');
  const local = new SlaveStorageService(createNullLogger(), file); cleanup.push(() => local.dispose());
  const db = await local.getDb() as unknown as Kysely<OmnitronDatabase>;
  const sync = new SyncService(db, createNullLogger(), node, 'slave');
  const at = Date.now() - 3600_000;
  await sync.bufferBatch(Array.from({ length: count }, (_, i) => ({ category: 'metrics', payload: {
    name: 'cpu_percent', timestamp: at + i, value: 10 + i, app: 'api', labels: { rack: 'one', node: 'untrusted' },
  } })));
  const batch = await sync.drainBuffer();
  await sync.ackDrained(batch.entries.map(e => e.id));
  const page = await readUnverifiedMetrics(db as Kysely<unknown>, node);
  if (page.entries.length) await own.db.insertInto('sync_ingested').values(page.entries.map(e => ({ nodeId: node, entryId: e.id, outcome: 'unverified' as const }))).execute();
  return { db, sync, local, file, page, at, storage: new PostgresMetricsStorage(own.db) };
}
async function count(table: string) {
  return Number((await sql<{ n: string }>`SELECT count(*) n FROM ${sql.table(table)}`.execute(own.db)).rows[0]!.n);
}

describe.skipIf(!available.ok)('historical metric reconciliation against real PostgreSQL and durable SQLite', () => {
  it('inspects without a schema write and distinguishes absent source samples from unrelated snapshots', async () => {
    const { page, storage } = await source();
    await storage.write([{ ...replicatedMetric(node, page.entries[0]!), id: 'old-resampled', timestamp: page.entries[0]!.payload['timestamp'] as number + 5 }]);
    expect(await reconcileMetricPage(own.db, storage, page, { restore: false })).toMatchObject({ present: 0, missing: 3, proofs: [] });
    expect(await count('metrics_samples')).toBe(1);
    expect((await sql<{ t: string | null }>`SELECT to_regclass('sync_reconciliations')::text t`.execute(own.db)).rows[0]!.t).toBeNull();
  });

  it('reuses exact existing history and restores only missing points, preserving original claims and source time', async () => {
    const { db, sync, page, storage, at } = await source();
    await storage.write([{ ...replicatedMetric(node, page.entries[0]!), id: 'legacy-exact' }]);
    await storage.write([{ id: 'current', name: 'cpu_percent', value: 999, timestamp: Date.now(), labels: { node, app: 'api', rack: 'one' } }]);
    const result = await reconcileMetricPage(own.db, storage, page, { restore: true });
    expect(result).toMatchObject({ present: 1, missing: 2 });
    expect(await count('metrics_samples')).toBe(4);
    expect(await own.db.selectFrom('sync_ingested').select('outcome').execute()).toEqual(Array(3).fill({ outcome: 'unverified' }));
    expect(await acknowledgeReconciliation(db as Kysely<unknown>, node, result.proofs)).toEqual({ reconciled: 3 });
    expect(await sync.getStatus()).toMatchObject({ evidence: { committedRows: 3, unverifiedRows: 0, committedThrough: '3', reconciliation: { verifiedRows: 1, restoredRows: 2 } } });
    expect((await sql<{ syncOutcome: string }>`SELECT syncOutcome FROM sync_buffer`.execute(db)).rows.every(r => r.syncOutcome === 'unverified')).toBe(true);
    const history = await storage.query({ labels: { node }, from: at, to: at + 2 });
    expect(history[0]!.points).toEqual([0, 1, 2].map(i => ({ timestamp: at + i, value: 10 + i })));
    expect((await storage.query({ labels: { node }, limit: 1 }))[0]!.points[0]!.value).toBe(999);
    expect(syncWords(syncFinding(await sync.getStatus()))).toContain('2 historical payloads restored on master');
  });

  it('replays a lost response and a lost source acknowledgement exactly once, including after reopening an older core schema', async () => {
    const { db, page, storage, local, file } = await source();
    const first = await reconcileMetricPage(own.db, storage, page, { restore: true });
    const replay = await reconcileMetricPage(own.db, storage, page, { restore: true });
    expect(replay.proofs).toEqual(first.proofs); expect(replay.alreadyReconciled).toBe(3);
    expect(await count('metrics_samples')).toBe(3); expect(await count('sync_reconciliations')).toBe(3);
    const master = new SyncService(own.db, createNullLogger(), 'master', 'master'); master.setMetricsStorage(storage);
    const duplicate = await master.receiveBatch({ nodeId: node, batchId: 'legacy-retry', entries: page.entries,
      checksum: createHash('sha256').update(JSON.stringify(page.entries)).digest('hex') });
    expect(duplicate.committedIds?.slice().sort()).toEqual(page.entries.map(e => e.id).sort());
    await acknowledgeReconciliation(db as Kysely<unknown>, node, first.proofs);
    expect(await acknowledgeReconciliation(db as Kysely<unknown>, node, first.proofs)).toEqual({ reconciled: 0 });
    await local.dispose();
    const reopened = new SlaveStorageService(createNullLogger(), file); cleanup.push(() => reopened.dispose());
    const reopenedDb = await reopened.getDb();
    expect((await readUnverifiedMetrics(reopenedDb as Kysely<unknown>, node)).entries).toEqual([]);
    expect(await reconciliationSummaries(reopenedDb as Kysely<unknown>)).toMatchObject([{ restoredRows: 3 }]);
  });

  it('waits for a live SQLite writer before reading the acknowledgement snapshot', async () => {
    const { db, page, storage, file, sync } = await source();
    const result = await reconcileMetricPage(own.db, storage, page, { restore: true });
    await prepareReconciliationStore(db as Kysely<unknown>);
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const Database = require(workerData.driver), db = new Database(workerData.file);
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE sync_replication_state SET id=id WHERE id=1').run();
      parentPort.postMessage('locked');
      setTimeout(() => { db.exec('COMMIT'); db.close(); }, 150);
    `, { eval: true, workerData: { file, driver: createRequire(import.meta.url).resolve('better-sqlite3') } });
    cleanup.push(() => worker.terminate().then(() => {}));
    await new Promise<void>((resolve, reject) => { worker.once('message', () => resolve()); worker.once('error', reject); });
    expect(await acknowledgeReconciliation(db as Kysely<unknown>, node, result.proofs)).toEqual({ reconciled: 3 });
    expect(await sync.getStatus()).toMatchObject({ evidence: { unverifiedRows: 0, committedRows: 3 } });
  });

  it('rolls back payload, proof and totals when the actual PostgreSQL COMMIT fails', async () => {
    const { db, page, sync, storage } = await source();
    await prepareReconciliationStore(own.db as Kysely<unknown>);
    await sql`CREATE FUNCTION reject_reconciliation_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'commit refused' USING ERRCODE='40001'; END $$`.execute(own.db);
    await sql`CREATE CONSTRAINT TRIGGER reject_reconciliation_commit AFTER INSERT ON sync_reconciliations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_commit()`.execute(own.db);
    try {
      await expect(reconcileMetricPage(own.db, storage, page, { restore: true })).rejects.toThrow('commit refused');
      expect(await count('metrics_samples')).toBe(0); expect(await count('sync_reconciliations')).toBe(0);
      expect(await reconciliationSummaries(own.db as Kysely<unknown>)).toEqual([]);
      expect((await sync.getStatus()).evidence!.unverifiedRows).toBe(3);
    } finally {
      await sql`DROP TRIGGER reject_reconciliation_commit ON sync_reconciliations`.execute(own.db);
      await sql`DROP FUNCTION reject_reconciliation_commit()`.execute(own.db);
    }
    const retry = await reconcileMetricPage(own.db, storage, page, { restore: true });
    expect(await acknowledgeReconciliation(db as Kysely<unknown>, node, retry.proofs)).toEqual({ reconciled: 3 });
  });

  it('rolls back every source counter when a later proof is invalid and never changes another epoch', async () => {
    const { db, page, sync, storage } = await source();
    const { proofs } = await reconcileMetricPage(own.db, storage, page, { restore: true });
    const changed = structuredClone(proofs); changed[2]!.payloadHash = 'f'.repeat(64);
    await expect(acknowledgeReconciliation(db as Kysely<unknown>, node, changed)).rejects.toThrow('does not match');
    expect(await sync.getStatus()).toMatchObject({ evidence: { committedRows: 0, unverifiedRows: 3 } });
    expect(await reconciliationSummaries(db as Kysely<unknown>)).toEqual([]);
    await expect(acknowledgeReconciliation(db as Kysely<unknown>, node, [{ ...proofs[0]!, epoch: 'a'.repeat(32) }])).rejects.toThrow('Invalid');
    await acknowledgeReconciliation(db as Kysely<unknown>, node, proofs);
    await expect(acknowledgeReconciliation(db as Kysely<unknown>, node, [{ ...proofs[0]!, result: 'present' }])).rejects.toThrow('Conflicting');
  });

  it('refuses payload identity conflicts and concurrent replays cannot duplicate data or proofs', async () => {
    const { page, storage } = await source();
    const [first, second] = await Promise.all([reconcileMetricPage(own.db, storage, page, { restore: true }), reconcileMetricPage(own.db, storage, page, { restore: true })]);
    expect(first.proofs).toEqual(second.proofs); expect(await count('metrics_samples')).toBe(3);
    expect(await reconciliationSummaries(own.db as Kysely<unknown>)).toMatchObject([{ restoredRows: 3 }]);
    const forged = structuredClone(page); forged.entries[0]!.payload['value'] = 100;
    await expect(reconcileMetricPage(own.db, storage, forged, { restore: true })).rejects.toThrow('conflict');
    expect(await count('metrics_samples')).toBe(3);
  });

  it('leaves non-metric and expired source gaps visible, never advancing a frontier across missing proof', async () => {
    const { db, page, sync, storage } = await source();
    await sync.buffer({ category: 'logs', payload: { message: 'legacy' } });
    await sync.ackDrained((await sync.drainBuffer()).entries.map(e => e.id));
    const { proofs } = await reconcileMetricPage(own.db, storage, page, { restore: true });
    await acknowledgeReconciliation(db as Kysely<unknown>, node, proofs);
    expect((await sync.getStatus()).evidence).toMatchObject({ unverifiedRows: 1, committedThrough: '0' });
    const remaining = await readUnverifiedMetrics(db as Kysely<unknown>, node);
    expect(remaining).toMatchObject({ unverifiedRows: 1, entries: [], next: null });
  });

  it('cannot settle a pruned source payload or resurrect a committed sample removed by retention', async () => {
    const { db, page, sync, storage } = await source(1);
    const { proofs } = await reconcileMetricPage(own.db, storage, page, { restore: true });
    await sql`DELETE FROM sync_buffer WHERE syncedAt IS NOT NULL`.execute(db);
    await expect(acknowledgeReconciliation(db as Kysely<unknown>, node, proofs)).rejects.toThrow('no longer retained');
    expect((await sync.getStatus()).evidence!.unverifiedRows).toBe(1);
    // Independent source entry with a committed claim and no retained payload.
    const other = structuredClone(page); other.entries[0]!.id = `${page.epoch}:999`; other.through = '999';
    await own.db.insertInto('sync_ingested').values({ nodeId: node, entryId: other.entries[0]!.id, outcome: 'committed' }).execute();
    other.entries[0]!.payload['timestamp'] = Date.now();
    await expect(reconcileMetricPage(own.db, storage, other, { restore: true })).rejects.toThrow('retention or deletion');
  });

  it('honours configured history retention and rejects relaxed SQLite durability', async () => {
    const { db, page, storage } = await source(1);
    expect((await reconcileMetricPage(own.db, storage, page, { restore: false, maxAgeMs: 1000 })).missing).toBe(1);
    await expect(reconcileMetricPage(own.db, storage, page, { restore: true, maxAgeMs: 1000 })).rejects.toThrow('history horizon');
    const { proofs } = await reconcileMetricPage(own.db, storage, page, { restore: true });
    await sql`PRAGMA synchronous = NORMAL`.execute(db);
    await expect(acknowledgeReconciliation(db as Kysely<unknown>, node, proofs)).rejects.toThrow('FULL');
  });

  it('uses bounded batch SQL and stable cursors instead of one PostgreSQL transaction per sample', async () => {
    const { db, page, storage } = await source(256);
    await prepareReconciliationStore(own.db as Kysely<unknown>); queries = [];
    const result = await reconcileMetricPage(own.db, storage, page, { restore: true });
    expect(result.missing).toBe(256); expect(queries.length).toBeLessThan(20);
    await acknowledgeReconciliation(db as Kysely<unknown>, node, result.proofs);
    expect((await readUnverifiedMetrics(db as Kysely<unknown>, node, { after: page.next!, through: page.through, epoch: page.epoch })).entries).toEqual([]);
    await expect(readUnverifiedMetrics(db as Kysely<unknown>, node, { epoch: '0'.repeat(32) })).rejects.toThrow('epoch changed');
    await expect(readUnverifiedMetrics(db as Kysely<unknown>, node, { limit: 257 })).rejects.toThrow('limit');
  });
});
