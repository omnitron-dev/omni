import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { SlaveConnector } from '../../src/cluster/slave-connector.js';
import { meshReading } from '../../src/shared/sync-reading.js';

const network = vi.hoisted(() => ({ peers: [] as any[], instances: [] as any[] }));
vi.mock('@omnitron-dev/titan/netron', () => ({
  NETRON_EVENT_PEER_DISCONNECT: 'peer:disconnect',
  Netron: class {
    handlers = new Map<string, () => void>();
    stop = vi.fn(async () => {});
    constructor() { network.instances.push(this); }
    registerTransport() {}
    setTransportOptions() {}
    on(name: string, handler: () => void) { this.handlers.set(name, handler); }
    connect = vi.fn(async () => network.peers.shift());
  },
}));
const connectors: SlaveConnector[] = [];
const config = { host: 'test.invalid', port: 9700, nodeId: 'registered-id', project: 'project', stack: 'production' };
const status = (pendingItems = 0) => ({ connected: false, pendingItems, bufferSize: 100, lastSyncAt: Date.now(), failedAttempts: 0, lastError: null });
function peer() {
  const ping = vi.fn(async () => ({ version: 'test' }));
  const getSyncStatus = vi.fn(async () => status());
  return { ping, getSyncStatus, queryInterface: vi.fn(async (name: string) => name === 'OmnitronDaemon'
    ? { ping } : { getSyncStatus, drainBuffer: async () => ({ entries: [] }) }) };
}
function connector(dial?: any) {
  const c = new SlaveConnector(createNullLogger(), null, { cleanupTimeout: 50, heartbeatInterval: 60000,
    dial: dial ?? (async () => ({ via: 'ssh-tunnel', url: 'tcp://127.0.0.1:1', close: async () => {} })) });
  connectors.push(c); return c;
}
beforeEach(() => { vi.useFakeTimers(); network.peers.length = 0; network.instances.length = 0; });
afterEach(async () => {
  for (const c of connectors.splice(0)) { const closing = c.dispose(); await vi.advanceTimersByTimeAsync(50); await closing; }
  vi.useRealTimers();
});
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('mesh recovery and resource ownership', () => {
  it('recovers past a stuck tunnel close and ignores callbacks from the old connection', async () => {
    const first = peer(), next = peer(); network.peers.push(first, next);
    const dial = vi.fn()
      .mockResolvedValueOnce({ via: 'ssh-tunnel', url: 'tcp://127.0.0.1:1', close: () => new Promise(() => {}) })
      .mockResolvedValue({ via: 'ssh-tunnel', url: 'tcp://127.0.0.1:2', close: async () => {} });
    const c = connector(dial); await c.addSlave(config); await settle();
    first.ping.mockRejectedValueOnce(new Error('Socket closed during RPC'));
    await expect(c.invokeOnSlave(config.host, 9700, 'OmnitronDaemon', 'ping', [])).rejects.toThrow('Socket closed');
    expect(c.getConnections()[0]?.status).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(50);
    expect(c.getConnections()[0]).toMatchObject({ status: 'error', cleanupError: expect.stringContaining('cleanup timed out'), reconnectAttempt: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.getConnections()[0]?.status).toBe('connected');
    expect((c as any).connections.get('test.invalid:9700').config).toEqual(config);
    network.instances[0].handlers.get('peer:disconnect')(); await settle();
    expect(c.getConnections()[0]?.status).toBe('connected');
    expect(dial).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect a removed node after a slow dial completes', async () => {
    let finish!: (link: any) => void;
    const close = vi.fn(async () => {});
    const c = connector(() => new Promise(resolve => { finish = resolve; }));
    await c.addSlave(config); await settle();
    await c.removeSlave(config.host, 9700);
    finish({ url: 'tcp://127.0.0.1:1', via: 'ssh-tunnel', close }); await settle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.getConnections()).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
    expect(network.instances).toHaveLength(0);
  });

  it('uses the actual Netron disconnect event and never retries business failures', async () => {
    const first = peer(); network.peers.push(first, peer());
    const c = connector(); await c.addSlave(config); await settle();
    first.ping.mockRejectedValueOnce(new Error('Missing required role'));
    await expect(c.invokeOnSlave(config.host, 9700, 'OmnitronDaemon', 'ping', [])).rejects.toThrow('Missing required role');
    expect(c.getConnections()[0]?.status).toBe('connected');
    network.instances[0].handlers.get('peer:disconnect')(); await settle();
    expect(c.getConnections()[0]).toMatchObject({ status: 'error', lastError: 'RPC transport disconnected' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.getConnections()[0]?.status).toBe('connected');
  });

  it('discards a replication reading completed by a replaced peer', async () => {
    const first = peer(), next = peer();
    let finish!: (value: any) => void;
    first.getSyncStatus.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    next.getSyncStatus.mockResolvedValue(status(23));
    network.peers.push(first);
    const c = connector(); await c.addSlave(config); await settle();
    const conn = (c as any).connections.get('test.invalid:9700');
    conn.peer = next;
    await (c as any).refreshSyncStatus(conn);
    finish(status(999)); await settle();
    expect(c.getConnections()[0]?.syncStatus?.pendingItems).toBe(23);
  });

  it('retains a stalled ingestion cause until a successful pull, without acknowledging rejected entries', async () => {
    const c = connector();
    const ackDrained = vi.fn();
    const drainBuffer = vi.fn(async () => ({ entries: [{ id: 'rejected' }] }));
    const remote = { queryInterface: async () => ({ drainBuffer, ackDrained }) };
    (c as any).syncService = { receiveBatch: async () => ({ acceptedIds: [], duplicateIds: [], discardedIds: [] }) };
    const conn = { config, peer: remote, status: 'connected', lastPullError: null };
    await (c as any).pullSyncData('test.invalid:9700', conn);
    expect(conn.lastPullError).toContain('Replication stalled');
    expect(ackDrained).not.toHaveBeenCalled();
    drainBuffer.mockResolvedValue({ entries: [] });
    await (c as any).pullSyncData('test.invalid:9700', conn);
    expect(conn.lastPullError).toBeNull();
  });
});

it('reports connection, retries, fresh acknowledgements and unknown stale readings separately', () => {
  const now = Date.now();
  const mesh = { nodeId: 'node', inMesh: true, status: 'connected' as const, via: 'ssh-tunnel' as const,
    authenticated: true, lastHeartbeat: now, lastError: null, syncStatus: status(5), syncStatusAt: now };
  expect(meshReading(mesh, now)).toMatchObject({ state: 'connected', replication: 'in sync · 5 since the last pull' });
  expect(meshReading(mesh, now + 61000)).toMatchObject({ state: 'stale', replication: expect.stringContaining('Unknown') });
  expect(meshReading({ ...mesh, lastPullError: 'database unavailable' }, now).replication).toContain('database unavailable');
  const lost = meshReading({ ...mesh, status: 'error', lastError: 'Heartbeat timeout', reconnectAt: now + 3000, reconnectAttempt: 2 }, now);
  expect(lost.connection).toContain('Retry in 3 s (attempt 2)');
  expect(lost.replication).toContain('Unknown');
  expect(lost.error).toBe('Heartbeat timeout');
});
