import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { Container } from '@omnitron-dev/titan/nexus';
import { describe, expect, it, vi } from 'vitest';
import { TitanMetricsModule } from '../src/metrics.module.js';
import { METRICS_SERVICE_TOKEN } from '../src/tokens.js';
import { SQLiteMetricsStorage, type MetricsDatabase } from '../src/sql-storage.js';
import type { MetricsService } from '../src/metrics.service.js';

describe('persistent metrics owned by Titan DI', () => {
  it('awaits the final commit on container disposal and leaves the caller connection open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'titan-metrics-shutdown-'));
    const sqlite = new Database(join(root, 'metrics.db'));
    sqlite.pragma('synchronous=FULL');
    const db = new Kysely<MetricsDatabase>({ dialect: new SqliteDialect({ database: sqlite }) });
    const storage = new SQLiteMetricsStorage(db);
    const container = new Container();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      await storage.initialize();
      container.loadModule(TitanMetricsModule.forRootAsync({
        useFactory: () => ({ appName: 'test', collection: { enabled: false }, storage: { type: 'sqlite' } }),
        storage: { useFactory: () => storage },
      }));
      const metrics = await container.resolveAsync(METRICS_SERVICE_TOKEN) as MetricsService;
      const write = storage.write.bind(storage);
      let entered!: () => void;
      const writing = new Promise<void>(resolve => { entered = resolve; });
      vi.spyOn(storage, 'write').mockImplementation(async samples => { entered(); await gate; await write(samples); });
      metrics.record({ id: 'shutdown-sample', name: 'queue_depth', value: 7, timestamp: Date.now(), labels: {} });
      let disposed = false;
      const shutdown = container.dispose().then(() => { disposed = true; });
      await writing;
      expect(disposed).toBe(false);
      expect(await db.selectFrom('metrics_samples').selectAll().execute()).toEqual([]);
      release();
      await shutdown;
      expect(await db.selectFrom('metrics_samples').select(['id', 'value']).execute()).toEqual([{ id: 'shutdown-sample', value: 7 }]);
      expect(metrics.getStorageStatus()).toMatchObject({ pendingSamples: 0, pendingBytes: 0, lastError: null });
    } finally {
      release();
      await container.dispose();
      await db.destroy();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses an async persistent configuration without its storage provider', async () => {
    const container = new Container();
    try {
      container.loadModule(TitanMetricsModule.forRootAsync({
        useFactory: () => ({ appName: 'test', storage: { type: 'postgres' } }),
      }));
      await expect(container.resolveAsync(METRICS_SERVICE_TOKEN)).rejects.toThrow('Persistent metrics require');
    } finally { await container.dispose(); }
  });
});
