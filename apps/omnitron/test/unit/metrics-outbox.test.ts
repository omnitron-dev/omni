import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sql, type Kysely, type Transaction } from 'kysely';
import { SQLiteMetricsStorage, MetricsService } from '@omnitron-dev/titan-metrics';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { SlaveStorageService } from '../../src/services/slave-storage.service.js';
import { SyncService } from '../../src/services/sync.service.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const undo of cleanup.splice(0).reverse()) await undo(); });
const sample = { id: 'outbox-one', name: 'cpu', timestamp: Date.now() - 3_600_000, value: 42, labels: { app: 'api' } };
async function open(file?: string) {
  if (!file) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-metrics-outbox-'));
    cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
    file = path.join(root, 'slave.sqlite');
  }
  const local = new SlaveStorageService(createNullLogger(), file);
  cleanup.push(() => local.dispose());
  const db = await local.getDb() as unknown as Kysely<OmnitronDatabase>;
  const sync = new SyncService(db, createNullLogger(), 'edge', 'slave');
  const metrics = new SQLiteMetricsStorage(db, { afterWrite: (trx, samples) => sync.bufferBatch(samples.map(s => ({
    category: 'metrics', payload: { name: s.name, value: s.value, timestamp: s.timestamp, labels: s.labels },
  })), trx as unknown as Transaction<OmnitronDatabase>) });
  await metrics.initialize();
  return { local, db, sync, metrics, file };
}

describe('atomic metric history and replication outbox', () => {
  it('preserves delayed samples and the pending queue across restart without a polling watermark', async () => {
    const first = await open();
    const service = new MetricsService({ appName: 'edge', collection: { enabled: false }, storage: { type: 'sqlite' } }, first.metrics);
    await service.recordDurable([sample]);
    await service.recordDurable([sample]);
    expect((await first.sync.getStatus()).pendingItems).toBe(1);
    await first.local.dispose();
    const second = await open(first.file);
    const batch = await second.sync.drainBuffer();
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]!.payload['timestamp']).toBe(sample.timestamp);
    expect((await second.metrics.query({ from: 0 }))[0]!.points).toEqual([{ timestamp: sample.timestamp, value: 42 }]);
  });

  it('rolls back the metric if the queue cannot commit and retries with the same identity', async () => {
    const { db, metrics, sync } = await open();
    await sql`CREATE TRIGGER reject_outbox BEFORE INSERT ON sync_buffer BEGIN SELECT RAISE(ABORT, 'queue unavailable'); END`.execute(db);
    await expect(metrics.write([sample])).rejects.toThrow('queue unavailable');
    expect(await metrics.query({ from: 0 })).toEqual([]);
    expect((await sync.getStatus()).pendingItems).toBe(0);
    await sql`DROP TRIGGER reject_outbox`.execute(db);
    await metrics.write([sample]);
    await metrics.write([sample]);
    expect((await sync.getStatus()).pendingItems).toBe(1);
  });

  it('retention of chart history cannot remove undelivered queue entries', async () => {
    const { metrics, sync } = await open();
    await metrics.write([sample]);
    await metrics.cleanup(1000);
    expect(await metrics.query({ from: 0 })).toEqual([]);
    expect((await sync.drainBuffer()).entries).toHaveLength(1);
  });
});
