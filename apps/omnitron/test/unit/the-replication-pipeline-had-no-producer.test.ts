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

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LogCollectorService } from '../../src/services/log-collector.service.js';
import type { LogEntry } from '../../src/shared/dto/logs.js';

/** A Kysely stand-in whose insert can be made to fail. */
function makeDb(opts: { failInsert?: boolean } = {}) {
  const inserted: unknown[][] = [];
  return {
    inserted,
    insertInto: (_table: string) => ({
      values: (rows: unknown[]) => ({
        execute: async () => {
          if (opts.failInsert) throw new Error('database is down');
          inserted.push(rows);
        },
      }),
    }),
  } as never;
}

const entry = (message: string): LogEntry => ({
  app: 'payments',
  level: 'info',
  message,
  labels: { env: 'prod', region: 'eu' },
  metadata: { attempt: 1 },
});

describe('a persisted batch reaches the replication buffer', () => {
  let sunk: LogEntry[][];

  beforeEach(() => {
    sunk = [];
  });

  it('hands the sink what was written', async () => {
    const collector = new LogCollectorService(makeDb(), undefined as never);
    collector.setSyncSink((entries) => sunk.push(entries));

    collector.ingestBatch([entry('one'), entry('two')]);
    await collector.flush();

    expect(sunk).toHaveLength(1);
    expect(sunk[0]!.map((e) => e.message)).toEqual(['one', 'two']);
  });

  it('hands over the UNENCODED shape', async () => {
    const collector = new LogCollectorService(makeDb(), undefined as never);
    collector.setSyncSink((entries) => sunk.push(entries));

    collector.ingestBatch([entry('one')]);
    await collector.flush();

    // The rows written to the local table carry `labels` and `metadata`
    // already serialised for that column. The master's `ingestLog`
    // serialises whatever it is handed — so shipping the ROWS would store
    // the string `{"env":"prod"}` as the label object on the other side,
    // and every remote log would arrive with its labels wrapped in quotes.
    expect(sunk[0]![0]!.labels).toEqual({ env: 'prod', region: 'eu' });
    expect(typeof sunk[0]![0]!.labels).toBe('object');
    expect(sunk[0]![0]!.metadata).toEqual({ attempt: 1 });
  });

  it('does not replicate a batch the database refused', async () => {
    const collector = new LogCollectorService(makeDb({ failInsert: true }), undefined as never);
    collector.setSyncSink((entries) => sunk.push(entries));

    collector.ingestBatch([entry('one')]);
    await collector.flush();

    // A failed flush puts its batch back at the front of the buffer and
    // retries. Queueing on the ATTEMPT rather than on the write would send
    // every retried line again for each attempt, and the master's dedup
    // ledger keys on the entry id it is given — which would be a new one
    // each time.
    expect(sunk).toEqual([]);
  });

  it('survives a sink that throws', async () => {
    const db = makeDb();
    const collector = new LogCollectorService(db, undefined as never);
    const failures: unknown[] = [];
    collector.on('sync_error', (err) => failures.push(err));
    collector.setSyncSink(() => {
      throw new Error('buffer is wedged');
    });

    collector.ingestBatch([entry('one')]);
    await collector.flush();

    // The lines are already in the local table. Letting the sink's failure
    // reach the flush's catch would re-queue rows that were written, and
    // duplicate them on the next attempt — losing the replica copy must not
    // cost the write that succeeded.
    expect((db as unknown as { inserted: unknown[][] }).inserted).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });

  it('replicates nothing when no sink is set', async () => {
    // A master has no master to ship to. The sink is wired only for the
    // slave role, and the collector must be silent without it.
    const collector = new LogCollectorService(makeDb(), undefined as never);

    collector.ingestBatch([entry('one')]);
    await expect(collector.flush()).resolves.not.toThrow();
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

describe('an ingested remote metric carries the node it came from', () => {
  function master() {
    const sunk: Array<{ node: string; name: string; labels: Record<string, string>; value: number }> = [];
    const svc = new SyncService({} as never, silentLogger, 'master-1', 'master', undefined as never);
    svc.setMetricsSink((s) => sunk.push(s));
    return { svc, sunk };
  }

  it('records through the sink with the node as a separate field', async () => {
    const { svc, sunk } = master();

    await (svc as unknown as {
      ingestMetric(db: unknown, nodeId: string, entry: { payload: Record<string, unknown>; createdAt: string }): Promise<void>;
    }).ingestMetric(
      { insertInto: () => ({ values: () => ({ execute: async () => undefined }) }) },
      'edge-7',
      { payload: { name: 'cpu_percent', app: 'payments', labels: { region: 'eu' }, value: 42 }, createdAt: '2026-09-14T00:00:00Z' },
    );

    // `node` is its own argument, not a key in `labels`, precisely so a
    // caller cannot omit it. A sample recorded without it merges with the
    // master's own readings and the chart shows two machines as one.
    expect(sunk).toHaveLength(1);
    expect(sunk[0]).toMatchObject({ node: 'edge-7', name: 'cpu_percent', app: 'payments', value: 42 });
    expect(sunk[0]!.labels).toEqual({ region: 'eu' });
  });

  it('refuses a batch that does not say which node it came from', async () => {
    const { svc } = master();

    for (const nodeId of ['', '   ', undefined as unknown as string]) {
      await expect(
        svc.receiveBatch({ nodeId, batchId: 'b1', entries: [], checksum: 'x' } as never),
      ).rejects.toThrow(/nodeId/);
    }
  });
});
