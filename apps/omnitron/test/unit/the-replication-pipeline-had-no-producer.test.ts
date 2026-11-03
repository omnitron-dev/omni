/**
 * A slave replicated nothing, and reported success every cycle.
 *
 * `SyncService` is the slave→master replication: a write-ahead buffer, batched
 * pushes with exponential backoff, a dedup ledger on the master keyed on
 * (nodeId, entry id), eviction when the buffer is over budget, and per-entry
 * acknowledgement so an entry is released only once the master confirms it.
 * All of it built. Both of its entry points — `buffer` and `bufferBatch` —
 * had **zero callers**.
 *
 * So a slave collected logs into its own SQLite and shipped none of them,
 * and nothing anywhere said so: an empty buffer drains successfully, the
 * cycle reports OK, and the master sees a node that simply never has
 * anything to say. The failure is invisible precisely because what would
 * have noticed is what was missing.
 *
 * These tests pin the producer, and the three things about it that are easy
 * to get wrong.
 */

import { MetricsRegistry } from '@omnitron-dev/titan-metrics';
import { afterEach, describe, it, expect, beforeEach } from 'vitest';

import { LogCollectorService } from '../../src/services/log-collector.service.js';
import type { LogEntry } from '../../src/shared/dto/logs.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { withDateBinding } from '../../src/database/sqlite-date-binding.js';

const entry = (message: string): LogEntry => ({
  app: 'payments', level: 'info', message, labels: { env: 'prod' }, metadata: { attempt: 1 },
});

describe('a persisted batch reaches the replication buffer', () => {
  let db: Kysely<OmnitronDatabase>;
  let collector: LogCollectorService;
  beforeEach(() => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE logs(id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, nodeId TEXT, app TEXT NOT NULL,
      level TEXT NOT NULL, message TEXT NOT NULL, labels TEXT, traceId TEXT, spanId TEXT, metadata TEXT)`);
    db = new Kysely({ dialect: new SqliteDialect({ database: withDateBinding(sqlite) }) });
    collector = new LogCollectorService(db);
  });
  afterEach(async () => { await collector.dispose(); await db.destroy(); });

  it('hands the outbox original records in the same transaction as the local rows', async () => {
    const observed: LogEntry[] = [];
    collector.setSyncSink(async (entries, tx) => {
      expect(await tx.selectFrom('logs').select('id').execute()).toHaveLength(2);
      observed.push(...entries);
    });
    collector.ingestBatch([entry('one'), entry('two')]);
    await collector.flush();
    expect(observed.map(e => e.message)).toEqual(['one', 'two']);
    expect(observed[0]).toMatchObject({ labels: { env: 'prod' }, metadata: { attempt: 1 } });
  });

  it('rolls failed outbox work back and can retry the same log', async () => {
    collector.setSyncSink(async () => { throw Error('outbox unavailable'); });
    collector.ingestBatch([entry('one')]);
    await collector.flush();
    expect(await db.selectFrom('logs').select('id').execute()).toEqual([]);
    // A standalone collector can commit the retained record without replication.
    collector.setSyncSink(null);
    await collector.flush();
    expect(await db.selectFrom('logs').select('message').execute()).toEqual([{ message: 'one' }]);
  });

  it('does not call the outbox on a failed local insert', async () => {
    let calls = 0;
    collector.setSyncSink(async () => { calls++; });
    await db.schema.alterTable('logs').renameTo('saved_logs').execute();
    collector.ingestBatch([entry('one')]);
    try {
      await collector.flush();
      expect(calls).toBe(0);
    } finally { await db.schema.alterTable('saved_logs').renameTo('logs').execute(); }
    await collector.flush();
    expect(calls).toBe(1);
  });
});

// =============================================================================
// Master side: a remote sample must not become the master's own
// =============================================================================

const { SyncService } = await import('../../src/services/sync.service.js');

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
};

describe('committed remote metric exposition', () => {
  it('applies raw observations to their defined families and binds authenticated node labels', () => {
    const registry = new MetricsRegistry([1, 5]);
    registry.define({ name: 'duration', type: 'histogram', help: 'Seconds' });
    registry.define({ name: 'calls', type: 'counter', help: 'Calls' });
    const svc = new SyncService({} as never, silentLogger, 'master-1', 'master', undefined as never);
    svc.setMetricsRegistry(registry);
    const ingest = (svc as unknown as { recordMetrics(nodeId: string, entries: unknown[]): void });
    const observations = [['duration', 2], ['duration', 4], ['calls', 2], ['calls', 3], ['cpu_percent', 42]] as const;
    ingest.recordMetrics('edge-7', observations.map(([name, value], index) => ({
      id: String(index), category: 'metrics', createdAt: '2026-09-14T00:00:00Z',
      payload: { name, value, app: 'payments', labels: { node: 'spoofed', region: 'eu' } },
    })));
    const labels = 'app="payments",node="edge-7",region="eu"';
    const scrape = registry.toPrometheusText();
    expect(scrape).toContain(`duration_bucket{${labels},le="1"} 0`);
    expect(scrape).toContain(`duration_bucket{${labels},le="5"} 2`);
    expect(scrape).toContain(`duration_sum{${labels}} 6`);
    expect(scrape).toContain(`duration_count{${labels}} 2`);
    expect(scrape).toContain(`calls{${labels}} 5`);
    expect(scrape).toContain(`cpu_percent{${labels}} 42`);
    expect(scrape).not.toContain('spoofed');
  });

  it('refuses a batch that does not say which node it came from', async () => {
    const svc = new SyncService({} as never, silentLogger, 'master-1', 'master', undefined as never);
    for (const nodeId of ['', '   ', undefined as unknown as string]) {
      await expect(svc.receiveBatch({ nodeId, batchId: 'b1', entries: [], checksum: 'x' } as never)).rejects.toThrow(/nodeId/);
    }
  });
});
