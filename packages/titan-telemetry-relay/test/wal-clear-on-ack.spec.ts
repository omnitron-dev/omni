/**
 * TR-1 regression — the relay must TRUNCATE the WAL after a successful
 * (fully-acked) forward. The happy path previously appended to the WAL but
 * never cleared it, so the WAL grew without bound and start() re-sent every
 * entry ever buffered on each restart (duplicate telemetry).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelemetryRelayService } from '../src/telemetry-relay.service.js';
import type { TelemetryEntry, TelemetryTransport } from '../src/types.js';

function makeTransport() {
  const sent: TelemetryEntry[] = [];
  let connected = true;
  const transport: TelemetryTransport = {
    isConnected: () => connected,
    connect: async () => {
      connected = true;
    },
    disconnect: async () => {
      connected = false;
    },
    send: async (entries: TelemetryEntry[]) => {
      sent.push(...entries);
      return entries.length;
    },
  };
  return { transport, sent };
}

function entry(i: number): TelemetryEntry {
  return {
    type: 'metric',
    app: 'test',
    data: { name: 'm', value: i },
    nodeId: 'node-test',
    timestamp: new Date(i + 1).toISOString(),
  } as TelemetryEntry;
}

describe('TelemetryRelayService — WAL clearing on ack (TR-1)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tr1-wal-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('clears the WAL after a fully-acked forward (no unbounded growth)', async () => {
    const { transport, sent } = makeTransport();
    const relay = new TelemetryRelayService({ role: 'producer', transport, wal: { directory: dir } });
    const wal = (relay as any).wal;

    await (relay as any).forwardEntries([entry(1), entry(2)]);

    expect(sent).toHaveLength(2);
    expect(await wal.readAll()).toHaveLength(0);
    await relay.stop();
  });

  it('does not re-send (duplicate) acked entries on restart', async () => {
    const { transport: t1, sent: sent1 } = makeTransport();
    const relay1 = new TelemetryRelayService({ role: 'producer', transport: t1, wal: { directory: dir } });
    await (relay1 as any).forwardEntries([entry(1), entry(2), entry(3)]);
    expect(sent1).toHaveLength(3);
    await relay1.stop();

    // A fresh relay boots against the SAME WAL directory and replays on start().
    const { transport: t2, sent: sent2 } = makeTransport();
    const relay2 = new TelemetryRelayService({ role: 'producer', transport: t2, wal: { directory: dir } });
    await relay2.start();

    // The WAL was truncated after the first forward → nothing to replay.
    expect(sent2).toHaveLength(0);
    await relay2.stop();
  });

  it('drains pre-existing WAL backlog together with the new batch (no data loss)', async () => {
    const { transport, sent } = makeTransport();
    const relay = new TelemetryRelayService({ role: 'producer', transport, wal: { directory: dir } });
    const wal = (relay as any).wal;

    // Simulate an un-acked backlog already durably written.
    wal.append([entry(1)]);
    await wal.flush();

    await (relay as any).forwardEntries([entry(2)]);

    // Both the backlog (E1) and the new batch (E2) are sent; WAL cleared.
    expect(sent).toHaveLength(2);
    expect(await wal.readAll()).toHaveLength(0);
    await relay.stop();
  });
});
