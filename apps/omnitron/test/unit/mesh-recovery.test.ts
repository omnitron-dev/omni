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
const status = (pendingItems = 0) => ({ connected: false, oldestPendingAgeMs: 1000, pendingItems, bufferSize: 100, lastSyncAt: Date.now(), failedAttempts: 0, lastError: null });
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
  it('survives twenty successive transport losses without accumulating connections or changing registry identity', async () => {
    for (let n = 0; n < 21; n++) network.peers.push(peer());
    const closed = vi.fn(async () => {});
    const c = connector(async () => ({ url: 'tcp://127.0.0.1:1', via: 'ssh-tunnel', close: closed }));
    await c.addSlave(config); await settle();
    for (let cycle = 0; cycle < 20; cycle++) {
      network.instances[cycle].handlers.get('peer:disconnect')(); await settle();
      expect(c.getConnections()[0]).toMatchObject({ status: 'error', reconnectAttempt: 1 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(c.getConnections()).toHaveLength(1);
      expect(c.getConnections()[0]).toMatchObject({ status: 'connected', reconnectAttempt: 0 });
      expect((c as any).connections.get('test.invalid:9700').config).toEqual(config);
    }
    expect(closed).toHaveBeenCalledTimes(20);
    for (const old of network.instances.slice(0, -1)) expect(old.stop).toHaveBeenCalledOnce();
  });

  it('reports authentication only after this peer verifies the credential and drops it on disconnect', async () => {
    let accept!: (value: { success: boolean }) => void;
    const authenticated = { ...peer(), runTask: vi.fn(() => new Promise(resolve => { accept = resolve; })) };
    network.peers.push(authenticated, peer());
    const c = connector(async () => ({ url: 'tcp://127.0.0.1:1', via: 'direct', token: 'test-credential', close: async () => {} }));
    await c.addSlave(config); await settle();
    expect(c.getConnections()[0]).toMatchObject({ status: 'connecting', authenticated: false });
    accept({ success: true }); await settle();
    expect(c.getConnections()[0]).toMatchObject({ status: 'connected', authenticated: true });
    network.instances[0].handlers.get('peer:disconnect')(); await settle();
    expect(c.getConnections()[0]?.authenticated).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.getConnections()[0]?.authenticated).toBe(false);
  });

  it('renews once for concurrent calls on the same peer without replaying any operation or replacing its tunnel', async () => {
    const effects = vi.fn(async () => 'done');
    const remote = { ...peer(), runTask: vi.fn(async () => ({ success: true })) };
    const discover = remote.queryInterface;
    remote.queryInterface = vi.fn(async (name: string) => name === 'Mutations' ? { execute: effects } : discover(name)) as any;
    network.peers.push(remote);
    const close = vi.fn(async () => {});
    const renew = vi.fn(async () => ({ token: 'renewed', expiresAt: Date.now() + 300_000 }));
    const c = connector(async () => ({ url: 'tcp://127.0.0.1:1', via: 'ssh-tunnel', token: 'initial',
      expiresAt: Date.now() + 300_000, refreshCredential: renew, close }));
    await c.addSlave(config); await settle();
    vi.setSystemTime(Date.now() + 275_000);
    await Promise.all(Array.from({ length: 12 }, () => c.invokeOnSlave(config.host, 9700, 'Mutations', 'execute', [])));
    expect(renew).toHaveBeenCalledOnce();
    expect(remote.runTask.mock.calls).toEqual([
      ['authenticate', { token: 'initial' }], ['authenticate', { token: 'renewed' }],
    ]);
    expect(effects).toHaveBeenCalledTimes(12);
    expect(close).not.toHaveBeenCalled();
    expect(network.instances).toHaveLength(1);
    expect(c.getConnections()[0]).toMatchObject({ authenticated: true, credentialExpiresAt: Date.now() + 300_000,
      credentialRefreshedAt: Date.now(), lastCredentialError: null });
  });

  it('refuses a mutation after renewal rejection and reports the actual authentication failure', async () => {
    const remote = { ...peer(), runTask: vi.fn().mockResolvedValueOnce({ success: true }).mockResolvedValue({ success: false, error: 'signature mismatch' }) };
    network.peers.push(remote);
    const rejected = vi.fn();
    const c = connector(async () => ({ url: 'tcp://127.0.0.1:1', via: 'direct', token: 'initial', expiresAt: Date.now() + 300_000,
      refreshCredential: async () => ({ token: 'renewed', expiresAt: Date.now() + 300_000 }), onRejected: rejected }));
    await c.addSlave(config); await settle();
    const calls = remote.ping.mock.calls.length;
    vi.setSystemTime(Date.now() + 275_000);
    await expect(c.invokeOnSlave(config.host, 9700, 'OmnitronDaemon', 'ping', [])).rejects.toThrow('signature mismatch');
    expect(remote.ping).toHaveBeenCalledTimes(calls);
    expect(rejected).toHaveBeenCalledWith('signature mismatch');
    expect(c.getConnections()[0]).toMatchObject({ authenticated: false, status: 'error', lastCredentialError: expect.stringContaining('signature mismatch') });
  });

  it('never publishes a late refresh into a replacement connection', async () => {
    let finish!: (value: { token: string; expiresAt: number }) => void;
    const remote = { ...peer(), runTask: vi.fn(async () => ({ success: true })) };
    const next = { ...peer(), runTask: vi.fn(async () => ({ success: true })) };
    network.peers.push(remote, next);
    const firstLink = { url: 'tcp://127.0.0.1:1', via: 'direct', token: 'initial', expiresAt: Date.now() + 300_000,
      refreshCredential: () => new Promise(resolve => { finish = resolve; }) };
    const nextLink = { url: 'tcp://127.0.0.1:2', via: 'direct', token: 'replacement', expiresAt: Date.now() + 900_000 };
    const c = connector(vi.fn().mockResolvedValueOnce(firstLink).mockResolvedValue(nextLink));
    await c.addSlave(config); await settle(); vi.setSystemTime(Date.now() + 275_000);
    const result = c.invokeOnSlave(config.host, 9700, 'OmnitronDaemon', 'ping', []).catch(error => error);
    await settle();
    network.instances[0].handlers.get('peer:disconnect')(); await settle();
    await vi.advanceTimersByTimeAsync(5000);
    finish({ token: 'late-old-token', expiresAt: Date.now() + 300_000 }); await settle();
    expect((await result).message).toContain('connection changed');
    expect(c.getConnections()[0]).toMatchObject({ status: 'connected', authenticated: true, lastCredentialError: null });
    expect(remote.runTask).toHaveBeenCalledTimes(1);
    expect(next.runTask).toHaveBeenCalledWith('authenticate', { token: 'replacement' });
    expect(nextLink.token).toBe('replacement');
  });

  it('expires non-renewable credentials before dispatch and never advertises expired authority', async () => {
    const remote = { ...peer(), runTask: vi.fn(async () => ({ success: true })) };
    network.peers.push(remote);
    const c = connector(async () => ({ url: 'tcp://127.0.0.1:1', via: 'direct', token: 'initial', expiresAt: Date.now() + 300_000 }));
    await c.addSlave(config); await settle();
    vi.setSystemTime(Date.now() + 300_001);
    expect(c.getConnections()[0]?.authenticated).toBe(false);
    const calls = remote.ping.mock.calls.length;
    await expect(c.invokeOnSlave(config.host, 9700, 'OmnitronDaemon', 'ping', [])).rejects.toThrow('credential expired');
    expect(remote.ping).toHaveBeenCalledTimes(calls);
  });

  it('bounds a stuck refresh and fences a late authentication completion after timeout', async () => {
    let accept!: (value: { success: boolean }) => void;
    const remote = { ...peer(), runTask: vi.fn().mockResolvedValueOnce({ success: true })
      .mockImplementation(() => new Promise(resolve => { accept = resolve; })) };
    network.peers.push(remote);
    const link = { url: 'tcp://127.0.0.1:1', via: 'direct', token: 'initial', expiresAt: Date.now() + 300_000,
      refreshCredential: async () => ({ token: 'late', expiresAt: Date.now() + 300_000 }) };
    const c = connector(async () => link);
    await c.addSlave(config); await settle(); vi.setSystemTime(Date.now() + 275_000);
    const result = c.invokeOnSlave(config.host, 9700, 'OmnitronDaemon', 'ping', []).catch(error => error);
    await settle(); await vi.advanceTimersByTimeAsync(10_000);
    expect((await result).message).toContain('renewal timed out');
    accept({ success: true }); await settle();
    expect(link.token).toBe('initial');
    expect(c.getConnections()[0]).toMatchObject({ authenticated: false, lastCredentialError: 'Service credential renewal timed out' });
  });

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
  expect(meshReading(mesh, now)).toMatchObject({ state: 'connected', replication: 'keeping up · 5 waiting, oldest 1 s' });
  expect(meshReading(mesh, now + 61000)).toMatchObject({ state: 'stale', replication: expect.stringContaining('Unknown') });
  expect(meshReading({ ...mesh, lastPullError: 'database unavailable' }, now).replication).toContain('database unavailable');
  const lost = meshReading({ ...mesh, status: 'error', lastError: 'Heartbeat timeout', reconnectAt: now + 3000, reconnectAttempt: 2 }, now);
  expect(lost.connection).toContain('Retry in 3 s (attempt 2)');
  expect(lost.replication).toContain('Unknown');
  expect(lost.error).toBe('Heartbeat timeout');
});
