/**
 * The «Sync» column read a field that was only ever assigned `null`.
 *
 * `IStackNodeStatus.syncStatus` was written at both sites that build it as a
 * literal `null`, and `stack status` renders a column from it. So the column
 * existed, had a heading, and could not display a value under any
 * circumstances. Beside it, `syncSummary` reported `syncedSlaves: 0` and
 * `totalPending: 0` — also literals, also next to a `totalSlaves` that was
 * genuinely counted.
 *
 * `summariseSync` counts the figures; this is the other half — the wire. The
 * summary is only as good as what reaches it, and a counter fed `null`
 * forever counts exactly as wrong as a literal.
 *
 * `OmnitronSync.getSyncStatus` has answered per node since it was written,
 * and only the node's own page ever called it. It rides the heartbeat here
 * because the heartbeat already reaches every node every 15 s: the view costs
 * one extra call per node per sweep and nothing at read time.
 *
 * Two conditions matter more than the happy path, and both are the same
 * mistake as the literal, one level down:
 *
 *   - a node that cannot answer must report NOTHING, not its last figure —
 *     a stale «0 pending» about a node silent for hours is the reading this
 *     path exists to prevent;
 *   - a disconnected node must report nothing for the same reason.
 */

import { describe, it, expect } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

import { SlaveConnector } from '../../src/cluster/slave-connector.js';
import type { ISyncStatus } from '../../src/shared/dto/project.js';

const status = (over: Partial<ISyncStatus> = {}): ISyncStatus => ({
  connected: true,
  lastSyncAt: 1_700_000_000_000,
  pendingItems: 0,
  bufferSize: 0,
  lastError: null,
  failedAttempts: 0,
  ...over,
});

/**
 * A connection in the state the sweep finds it: registered, connected, with
 * a peer that answers `queryInterface`. `answer` is what the node says about
 * itself, or a throw for a node that cannot say anything.
 */
function connectedSlave(connector: SlaveConnector, answer: () => Promise<ISyncStatus>) {
  const conn = {
    config: { host: '203.0.113.7', port: 9700 },
    status: 'connected' as const,
    netron: null,
    peer: {
      queryInterface: async (name: string) => {
        if (name !== 'OmnitronSync') throw new Error(`unexpected interface ${name}`);
        return { getSyncStatus: answer };
      },
    },
    lastHeartbeat: Date.now(),
    syncStatus: null,
    lastError: null,
    reconnectAttempt: 0,
    reconnectTimer: null,
    link: null,
  };
  // The sweep's own registry. Reached directly because the alternative is a
  // real TCP dial, and what is under test is what the connector does with
  // the answer, not how it got the socket.
  (connector as unknown as { connections: Map<string, unknown> }).connections.set(
    '203.0.113.7:9700',
    conn,
  );
  return conn;
}

describe('a column that could never show anything', () => {
  it('carries what the node said about its own buffer', async () => {
    const connector = new SlaveConnector(createNullLogger(), null);
    connectedSlave(connector, async () => status({ pendingItems: 47_407, lastSyncAt: null }));

    await (connector as unknown as { refreshSyncStatus: (c: unknown) => Promise<void> })
      .refreshSyncStatus(
        (connector as unknown as { connections: Map<string, unknown> }).connections.get(
          '203.0.113.7:9700',
        ),
      );

    const [connection] = connector.getConnections();
    expect(connection?.syncStatus, 'the field the «Sync» column reads').not.toBeNull();
    expect(connection?.syncStatus?.pendingItems).toBe(47_407);
    expect(connection?.syncStatus?.lastSyncAt, 'pending climbing while this stands still').toBeNull();

    connector.dispose();
  });

  it('forgets a figure it can no longer confirm', async () => {
    // The node answered once and then stopped answering. Keeping the old
    // number would report «0 pending» about a node that has said nothing
    // since — the literal's mistake, one level down.
    const connector = new SlaveConnector(createNullLogger(), null);
    let answering = true;
    connectedSlave(connector, async () => {
      if (!answering) throw new Error('Request timeout');
      return status({ pendingItems: 0 });
    });

    const refresh = () =>
      (connector as unknown as { refreshSyncStatus: (c: unknown) => Promise<void> }).refreshSyncStatus(
        (connector as unknown as { connections: Map<string, unknown> }).connections.get(
          '203.0.113.7:9700',
        ),
      );

    await refresh();
    expect(connector.getConnections()[0]?.syncStatus?.pendingItems).toBe(0);

    answering = false;
    await refresh();
    expect(connector.getConnections()[0]?.syncStatus, 'unknown, not zero').toBeNull();

    connector.dispose();
  });

  it('says nothing about a node it is not connected to', async () => {
    // Control: the sweep skips it, and so must the read. A node with no
    // peer cannot have a current figure.
    const connector = new SlaveConnector(createNullLogger(), null);
    const conn = connectedSlave(connector, async () => status({ pendingItems: 5 }));

    await (connector as unknown as { refreshSyncStatus: (c: unknown) => Promise<void> })
      .refreshSyncStatus(conn);
    expect(connector.getConnections()[0]?.syncStatus?.pendingItems).toBe(5);

    await (connector as unknown as { disconnectSlave: (c: unknown) => Promise<void> })
      .disconnectSlave(conn);

    const [connection] = connector.getConnections();
    expect(connection?.status).toBe('disconnected');
    expect(connection?.syncStatus, 'a dropped node keeps no last figure').toBeNull();

    connector.dispose();
  });
});
