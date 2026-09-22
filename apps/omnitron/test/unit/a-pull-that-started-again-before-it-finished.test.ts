/**
 * A pull that started again before it had finished.
 *
 * The heartbeat reaches every node every 15 s, and every sweep ended with
 * `void this.pullSyncData(key, conn)` — fire and forget, whether or not the
 * previous sweep's pull was still running. While a node's backlog is small a
 * pull takes well under a second and nothing overlaps. When one pull outlasts
 * a heartbeat — the master's machine busy, its database slow — the next sweep
 * starts a second pull on the same connection, and the second drains the SAME
 * entries, because the node releases nothing until the master acknowledges
 * it. Every entry is then ingested once per pull, the pulls contend with each
 * other over each entry's claim, and they advance in lockstep: more work for
 * the same progress, which makes the next pull slower still.
 *
 * Measured in the master's own log, test node 37.27.130.185, 2026-09-22:
 *
 *     17:09:18.237  Sync pull failed  Rate limit exceeded for node 16f3dd5a…  Max 60 batches/min.
 *     17:09:18.941 … 17:09:19.063   nine pulls finish within 122 ms —
 *                                   eight of 7 918 entries and one of 7 362
 *
 * Nine times the ingest work for one pull's worth of progress, and then the
 * master's limit on batches per node — written against a slave flooding it —
 * refused the master's own pulls. The same shape at 15:43:06 (four pulls),
 * 17:03:20 (three), 17:05:34 (five) and 17:38:07 (five).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

import { SlaveConnector } from '../../src/cluster/slave-connector.js';

interface Entry {
  id: string;
  category: 'logs';
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * The node's side of a pull: a buffer that lets an entry go only when the
 * master acknowledges it, and a `drainBuffer` that can be HELD — the stand-in
 * for a pull that takes longer than one heartbeat.
 */
function node(count: number) {
  const pending = new Map<string, Entry>();
  let next = 1;
  const add = (n: number) => {
    for (let i = 0; i < n; i++) {
      const id = String(next++);
      pending.set(id, { id, category: 'logs', payload: { message: `line ${id}` }, createdAt: new Date().toISOString() });
    }
  };
  add(count);

  let held: Promise<void> | null = null;
  let release = () => {};
  let failNext: Error | null = null;
  const calls = { drain: 0 };

  const sync = {
    getSyncStatus: async () => ({
      connected: false,
      lastSyncAt: null,
      pendingItems: pending.size,
      bufferSize: 0,
      lastError: null,
      failedAttempts: 0,
    }),
    drainBuffer: async ({ limit }: { limit: number }) => {
      calls.drain++;
      if (held) await held;
      if (failNext) {
        const err = failNext;
        failNext = null;
        throw err;
      }
      return {
        nodeId: 'daos-cpp-9700',
        batchId: `batch-${calls.drain}`,
        checksum: 'not-checked-by-this-stand-in',
        entries: [...pending.values()].slice(0, limit),
      };
    },
    ackDrained: async ({ ids }: { ids: string[] }) => {
      for (const id of ids) pending.delete(id);
      return { released: ids.length };
    },
  };
  const daemon = { ping: async () => ({ version: 'test' }) };

  return {
    peer: {
      queryInterface: async (name: string) => {
        if (name === 'OmnitronSync') return sync;
        if (name === 'OmnitronDaemon') return daemon;
        throw new Error(`unexpected interface ${name}`);
      },
    },
    calls,
    add,
    get pending() {
      return pending.size;
    },
    hold() {
      held = new Promise<void>((resolve) => {
        release = () => {
          held = null;
          resolve();
        };
      });
    },
    release: () => release(),
    failNextDrain(err: Error) {
      failNext = err;
    },
  };
}

/**
 * The master's side, reduced to what this is about: which entries reached
 * ingestion, and how many times. It answers the way `receiveBatch` does — a
 * second sight of an entry is a duplicate, and still counts as delivered.
 */
function master() {
  const received: string[] = [];
  const taken = new Set<string>();
  return {
    received,
    service: {
      receiveBatch: async (batch: { entries: Array<{ id: string }> }) => {
        const acceptedIds: string[] = [];
        const duplicateIds: string[] = [];
        for (const e of batch.entries) {
          received.push(e.id);
          (taken.has(e.id) ? duplicateIds : acceptedIds).push(e.id);
          taken.add(e.id);
        }
        return {
          accepted: acceptedIds.length,
          duplicates: duplicateIds.length,
          acceptedIds,
          duplicateIds,
          failedIds: [],
          discardedIds: [],
        };
      },
    },
  };
}

const connectors: SlaveConnector[] = [];

/**
 * A connector holding one connected node, in the state the heartbeat finds
 * it. Reached through the registry directly: what is under test is what the
 * sweep does with a connection, not how the socket was dialled.
 */
function connected(peer: unknown, sync: unknown) {
  // An interval nobody waits for: each test drives the sweep itself.
  const connector = new SlaveConnector(createNullLogger(), sync as never, {
    heartbeatInterval: 3_600_000,
  });
  connectors.push(connector);
  const conn = {
    config: { host: '203.0.113.7', port: 9700, nodeId: '16f3dd5a-2727-49e5-90a2-d762b57073f6' },
    status: 'connected' as const,
    netron: null,
    peer,
    lastHeartbeat: Date.now(),
    syncStatus: null,
    lastSyncStatusError: null,
    lastPullError: null,
    lastError: null,
    reconnectAttempt: 0,
    reconnectTimer: null,
    link: null,
  };
  (connector as unknown as { connections: Map<string, unknown> }).connections.set('203.0.113.7:9700', conn);
  return { connector, conn };
}

/** One heartbeat, the same private the timer calls. */
const sweep = (connector: SlaveConnector) =>
  (connector as unknown as { heartbeatSweep(): Promise<void> }).heartbeatSweep();

/** Let everything that can settle, settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
  for (const connector of connectors.splice(0)) await connector.dispose();
});

describe('a pull that started again before it had finished', () => {
  it('does not start a second pull on a connection whose first is still running', async () => {
    const n = node(2_500);
    const m = master();
    const { connector } = connected(n.peer, m.service);

    n.hold();
    await sweep(connector); // the first pull starts and waits on the node
    await settle();
    await sweep(connector); // the heartbeat fifteen seconds later
    await sweep(connector); // and thirty
    await settle();

    expect(n.calls.drain, 'pulls asking this node for the same entries at once').toBe(1);

    n.release();
    await vi.waitFor(() => expect(n.pending).toBe(0));

    // Each entry reached ingestion ONCE. Three overlapping pulls offered the
    // first page three times, and the master claimed it three times.
    expect(m.received).toHaveLength(2_500);
    expect(new Set(m.received).size).toBe(2_500);
  });

  it('starts the next pull once the last one has finished', async () => {
    // The guard is a turn, not a latch: a connection that has finished a
    // pull must be pulled from again.
    const n = node(300);
    const m = master();
    const { connector } = connected(n.peer, m.service);

    await sweep(connector);
    await vi.waitFor(() => expect(n.pending).toBe(0));

    n.add(200);
    await sweep(connector);
    await vi.waitFor(() => expect(n.pending).toBe(0));
    expect(new Set(m.received).size).toBe(500);
  });

  it('gives the turn back when a pull fails', async () => {
    const n = node(50);
    const m = master();
    const { connector } = connected(n.peer, m.service);

    n.failNextDrain(new Error('Request timeout'));
    await sweep(connector);
    await settle();
    expect(n.pending, 'the failed pull released nothing').toBe(50);

    await sweep(connector);
    await vi.waitFor(() => expect(n.pending).toBe(0));
  });

  it('is not held up by a pull stuck on a peer the connection has since replaced', async () => {
    // The guard must not become the outage. A call to a node may wait up to
    // SLAVE_REQUEST_TIMEOUT — ten minutes — and a pull stuck on a peer that
    // died would, under a plain «one at a time», block every pull on the
    // reconnected peer for that long.
    const dead = node(10);
    dead.hold(); // never released
    const m = master();
    const { connector, conn } = connected(dead.peer, m.service);

    await sweep(connector);
    await settle();
    expect(dead.calls.drain).toBe(1);

    const fresh = node(10);
    conn.peer = fresh.peer; // what `connectSlave` does on reconnect
    await sweep(connector);

    await vi.waitFor(() => expect(fresh.pending).toBe(0));
    expect(dead.calls.drain, 'the stuck pull was left alone, not retried').toBe(1);
  });
});
