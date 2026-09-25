/**
 * A reconnect a deployment waited out.
 *
 * `waitUntilConnected` polled a node's status for a minute. A connection
 * that had failed was waiting on its backoff — `5 s × 1.5ⁿ`, up to
 * `maxBackoff`, 120 s — and nothing brought that forward for a caller who
 * needed the node now. On daos/test (2026-09-25) a deployment right after a
 * `fleet upgrade` restarted the node's daemon waited its 60 s, the next
 * attempt came at 66 s, and the deployment went on without the node's
 * infrastructure.
 *
 * Held here: a wait brings a pending reconnect forward, once, and a node that
 * is connected, or already connecting, is left alone.
 */
import { describe, expect, it, vi } from 'vitest';

import { SlaveConnector } from '../../src/cluster/slave-connector.js';

const quiet: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child: () => quiet };
const KEY = '10.0.0.9:9700';

function connector(status: 'disconnected' | 'error' | 'connecting' | 'connected') {
  const c: any = new SlaveConnector(quiet, null);
  const pendingFired = vi.fn();
  const conn = {
    config: { host: '10.0.0.9', port: 9700 },
    status,
    reconnectAttempt: 7,
    reconnectTimer: status === 'connected' ? null : setTimeout(pendingFired, 120_000),
  };
  c.connections.set(KEY, conn);
  // The dial itself is not the question here: what matters is WHEN it is asked for.
  c.connectSlave = vi.fn(async () => {
    conn.status = 'connected';
  });
  return { c, conn, pendingFired };
}

describe('a caller waiting for a node', () => {
  it('brings a reconnect in its backoff forward instead of waiting it out', async () => {
    const { c, conn } = connector('error');
    const t0 = Date.now();

    expect(await c.waitUntilConnected('10.0.0.9', 9700, 5_000)).toBe(true);

    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(c.connectSlave).toHaveBeenCalledTimes(1);
    expect(conn.reconnectTimer).toBeNull();
    expect(conn.reconnectAttempt).toBe(0);
    await c.dispose?.();
  });

  it('leaves a connected node, and one already connecting, alone', async () => {
    for (const status of ['connected', 'connecting'] as const) {
      const { c, conn } = connector(status);
      if (status === 'connecting') setTimeout(() => (conn.status = 'connected'), 50);
      expect(await c.waitUntilConnected('10.0.0.9', 9700, 2_000), status).toBe(true);
      expect(c.connectSlave, status).not.toHaveBeenCalled();
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      await c.dispose?.();
    }
  });
});
