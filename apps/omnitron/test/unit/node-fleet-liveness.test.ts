/**
 * The fleet section's silent failures.
 *
 * Every case here was observed on a live daemon, not reasoned about: the
 * health-monitor worker had died shortly after boot, the master kept its
 * proxy, and for two days `checkNodeStatus`, `checkAllNodes`,
 * `triggerNodeCheck` and `getNodeHealthSummaries` all answered
 * `TitanError: Service with id HealthMonitor@1.0.0 not found` while the
 * console rendered the worker's last report as the current state of the
 * fleet — dots and all, with no age shown anywhere.
 *
 * Four distinct faults stacked to produce that, and each gets a test:
 *   1. nothing watched the worker's process,
 *   2. the RPC guards tested the proxy for null rather than calling it,
 *   3. a node's host went to a shell,
 *   4. a removed node's row stayed in SQLite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SystemWorkerManager } from '../../src/workers/system-worker-manager.js';
import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';
import {
  assertNodeHost,
  normalizeCheckConfig,
  DEFAULT_CHECK_CONFIG,
} from '../../src/services/remote-ops.service.js';

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
};

// =============================================================================
// 1. A worker that dies must take its registration with it
// =============================================================================

/** A PM stand-in whose handles can be made to fire `exit`. */
function makePm() {
  const handles = new Map<string, any>();
  let seq = 0;
  return {
    handles,
    spawn: vi.fn(async () => {
      const processId = `pid-${++seq}`;
      const listeners = new Set<(info: any) => void>();
      handles.set(processId, {
        id: processId,
        isAlive: () => true,
        onExit(handler: (info: any) => void) {
          listeners.add(handler);
          return () => listeners.delete(handler);
        },
        /** Test hook: end the process. */
        __die(info: Partial<{ code: number; signal: string; expected: boolean }> = {}) {
          for (const l of [...listeners]) {
            l({ workerId: processId, serviceName: 'HealthMonitor', code: null, signal: null, expected: false, ...info });
          }
        },
      });
      return { __processId: processId } as any;
    }),
    kill: vi.fn(async (processId: string) => {
      handles.get(processId)?.__die({ expected: true });
    }),
    getWorkerHandle: (processId: string) => handles.get(processId),
  };
}

describe('SystemWorkerManager — a worker that dies', () => {
  it('drops the registration so `get()` stops handing out a dead proxy', async () => {
    const pm = makePm();
    const manager = new SystemWorkerManager(pm as any, silentLogger);

    await manager.spawn('health-monitor', '/tmp/worker.js', {});
    expect(manager.get('health-monitor')).not.toBeNull();

    pm.handles.get('pid-1')!.__die();

    // This is the whole outage in one assertion: the proxy stayed, so every
    // caller kept reaching for a process that no longer existed.
    expect(manager.get('health-monitor')).toBeNull();
    expect(manager.isAlive('health-monitor')).toBe(false);
    expect(manager.list()).toHaveLength(0);
  });

  it('tells subscribers, and distinguishes a crash from a stop', async () => {
    const pm = makePm();
    const manager = new SystemWorkerManager(pm as any, silentLogger);
    const seen: any[] = [];
    manager.onExit('health-monitor', (e) => seen.push(e));

    await manager.spawn('health-monitor', '/tmp/worker.js', {});
    pm.handles.get('pid-1')!.__die({ code: 1 });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: 'health-monitor', expected: false, code: 1 });

    // A deliberate stop must NOT read as a crash — a restart scheduled on the
    // way out is a worker respawned into a shutting-down daemon.
    await manager.spawn('health-monitor', '/tmp/worker.js', {});
    await manager.stop('health-monitor');
    expect(seen[1]).toMatchObject({ expected: true });
  });

  it('allows a respawn under the same name', async () => {
    const pm = makePm();
    const manager = new SystemWorkerManager(pm as any, silentLogger);

    await manager.spawn('health-monitor', '/tmp/worker.js', {});
    pm.handles.get('pid-1')!.__die();

    // `spawn` throws when the name is taken. Without the exit handler
    // clearing it, a crashed worker could never be restarted for the life of
    // the daemon.
    await expect(manager.spawn('health-monitor', '/tmp/worker.js', {})).resolves.toBeDefined();
    expect(manager.get('health-monitor')).not.toBeNull();
  });

  it('a late exit from a replaced process does not evict its successor', async () => {
    const pm = makePm();
    const manager = new SystemWorkerManager(pm as any, silentLogger);

    await manager.spawn('health-monitor', '/tmp/worker.js', {});
    pm.handles.get('pid-1')!.__die();
    await manager.spawn('health-monitor', '/tmp/worker.js', {});

    pm.handles.get('pid-1')!.__die(); // the old process, reported twice
    expect(manager.get('health-monitor')).not.toBeNull();
  });
});

// =============================================================================
// 2. A worker call that fails must fall back, not propagate
// =============================================================================

function makeNodeManager(overrides: Record<string, any> = {}) {
  return {
    listNodes: vi.fn(() => []),
    checkNodeStatus: vi.fn(async (id: string) => ({
      nodeId: id, pingReachable: true, pingLatencyMs: 1, sshConnected: false,
      sshLatencyMs: null, omnitronConnected: false, checkedAt: new Date().toISOString(),
    })),
    checkAllNodes: vi.fn(async () => [
      { nodeId: 'local', pingReachable: true, pingLatencyMs: 0, sshConnected: true, sshLatencyMs: 0, omnitronConnected: true, checkedAt: new Date().toISOString() },
    ]),
    updateStatusCacheFromWorker: vi.fn(),
    getHealthSummaries: vi.fn(() => [{ nodeId: 'local', status: 'online', lastCheck: null, lastSeenOnline: null, consecutiveFailures: 0 }]),
    reportWorkerUnavailable: vi.fn(),
    reportProblem: vi.fn(),
    removeNode: vi.fn(async () => {}),
    // The registry row, read before it is deleted: an audit entry for a
    // removal that names only a uuid is a row nobody can read afterwards,
    // because the name it would have needed went with the row.
    getNode: vi.fn(() => ({ id: 'node-1', name: 'node-1', host: '10.0.0.1' })),
    ...overrides,
  } as any;
}

/** The exact failure the live daemon returned for two days. */
const DEAD_WORKER = () => {
  throw Object.assign(new Error('Service with id HealthMonitor@1.0.0 not found'), { code: 404 });
};

describe('NodeManagerRpcService — the worker is an optimisation', () => {
  let nodeManager: any;
  let rpc: NodeManagerRpcService;

  beforeEach(() => {
    nodeManager = makeNodeManager();
    rpc = new NodeManagerRpcService(nodeManager);
  });

  it('checkNodeStatus answers from the daemon when the worker call throws', async () => {
    rpc.setHealthWorkerProxy({ triggerCheck: DEAD_WORKER, getStatusSummaries: DEAD_WORKER } as any);

    const status = await rpc.checkNodeStatus({ id: 'node-1' });

    expect(status.nodeId).toBe('node-1');
    expect(nodeManager.checkNodeStatus).toHaveBeenCalledWith('node-1');
    expect(nodeManager.reportWorkerUnavailable).toHaveBeenCalled();
  });

  it('drops the dead proxy so the next call does not pay for it again', async () => {
    const triggerCheck = vi.fn(DEAD_WORKER);
    rpc.setHealthWorkerProxy({ triggerCheck, getStatusSummaries: DEAD_WORKER } as any);
    expect(rpc.hasHealthWorker()).toBe(true);

    await rpc.checkNodeStatus({ id: 'node-1' });
    expect(rpc.hasHealthWorker()).toBe(false);

    await rpc.checkAllNodes();
    expect(triggerCheck).toHaveBeenCalledTimes(1);
  });

  it('checkAllNodes and getNodeHealthSummaries degrade instead of throwing', async () => {
    rpc.setHealthWorkerProxy({ triggerCheck: DEAD_WORKER, getStatusSummaries: DEAD_WORKER } as any);
    await expect(rpc.checkAllNodes()).resolves.toHaveLength(1);

    rpc.setHealthWorkerProxy({ triggerCheck: DEAD_WORKER, getStatusSummaries: DEAD_WORKER } as any);
    await expect(rpc.getNodeHealthSummaries()).resolves.toEqual([]);
  });

  it('triggerNodeCheck with no worker runs the checks rather than reporting an empty fleet', async () => {
    rpc.setHealthWorkerProxy(null);

    const summaries = await rpc.triggerNodeCheck({});

    // It used to answer `[]` — on a page whose subject is the fleet, an empty
    // array is not "the worker is down", it is "you have no nodes".
    expect(nodeManager.checkAllNodes).toHaveBeenCalled();
    expect(summaries).toHaveLength(1);
  });

  it('falls through when the worker answers with nothing usable', async () => {
    // Not the same as "the worker threw". A worker that has been spawned but
    // not yet told which nodes exist answers with summaries that carry no
    // `lastCheck` — and the guard tested the RAW length, so it passed, and
    // then returned the FILTERED list, which is empty. An empty array on the
    // page whose subject is the fleet reads as "you have no nodes".
    rpc.setHealthWorkerProxy({
      triggerCheck: vi.fn(async () => [
        { nodeId: 'node-1', status: 'unknown', lastCheck: null, lastSeenOnline: null, consecutiveFailures: 0 },
      ]),
      getStatusSummaries: vi.fn(async () => []),
    } as any);

    const statuses = await rpc.checkAllNodes();

    expect(nodeManager.checkAllNodes).toHaveBeenCalled();
    expect(statuses).toHaveLength(1);
  });

  it('triggerNodeCheck does the same with an empty answer', async () => {
    rpc.setHealthWorkerProxy({
      triggerCheck: vi.fn(async () => []),
      getStatusSummaries: vi.fn(async () => []),
    } as any);

    const summaries = await rpc.triggerNodeCheck({});

    expect(nodeManager.checkAllNodes).toHaveBeenCalled();
    expect(summaries).toHaveLength(1);
  });

  it('still prefers the worker when it answers', async () => {
    const summary = {
      nodeId: 'node-1',
      status: 'online',
      lastSeenOnline: null,
      consecutiveFailures: 0,
      lastCheck: {
        nodeId: 'node-1', checkedAt: '2026-09-14T00:00:00.000Z', checkDurationMs: 3,
        pingReachable: true, pingLatencyMs: 2, pingError: null,
        sshConnected: true, sshLatencyMs: 9, sshError: null,
        omnitronConnected: true, omnitronVersion: '0.2.0', omnitronPid: 7,
        omnitronUptime: 100, omnitronRole: 'slave', omnitronError: null, os: null,
      },
    };
    rpc.setHealthWorkerProxy({
      triggerCheck: vi.fn(async () => [summary]),
      getStatusSummaries: vi.fn(async () => [summary]),
    } as any);

    const status = await rpc.checkNodeStatus({ id: 'node-1' });
    expect(status.omnitronVersion).toBe('0.2.0');
    expect(nodeManager.checkNodeStatus).not.toHaveBeenCalled();
  });

  it('caps what one call may ask the database for', async () => {
    const getHistory = vi.fn(async () => []);
    const getUptimeBar = vi.fn(async () => []);
    rpc.setHealthRepository({ getHistory, getUptimeBar, deleteHistory: vi.fn() } as any);

    await rpc.getCheckHistory({ nodeId: 'n', limit: 10_000_000 });
    await rpc.getUptimeBar({ nodeId: 'n', bucketCount: 10_000_000 });
    // A page size is the cost of the request; it is the server's to decide.
    expect(getHistory.mock.calls[0]![1]).toBe(500);
    expect(getUptimeBar.mock.calls[0]![1]).toBe(400);

    // NaN used to sail past every bound and reach the query.
    await rpc.getCheckHistory({ nodeId: 'n', limit: Number.NaN });
    expect(getHistory.mock.calls[1]![1]).toBe(50);
  });

  it('removing a node removes its check history too', async () => {
    const deleteHistory = vi.fn(async () => 12);
    rpc.setHealthRepository({ getHistory: vi.fn(), getUptimeBar: vi.fn(), deleteHistory } as any);

    await rpc.removeNode({ id: 'node-1' });

    expect(nodeManager.removeNode).toHaveBeenCalledWith('node-1');
    expect(deleteHistory).toHaveBeenCalledWith('node-1');
  });

  it('a failed history delete does not fail the removal that already happened', async () => {
    rpc.setHealthRepository({
      getHistory: vi.fn(), getUptimeBar: vi.fn(),
      deleteHistory: vi.fn(async () => { throw new Error('pg is down'); }),
    } as any);

    await expect(rpc.removeNode({ id: 'node-1' })).resolves.toBeUndefined();
    expect(nodeManager.reportProblem).toHaveBeenCalled();
  });
});

// =============================================================================
// 3. A host is not free text
// =============================================================================

describe('assertNodeHost', () => {
  it('accepts the three things a host can be', () => {
    expect(assertNodeHost('192.168.1.100')).toBe('192.168.1.100');
    expect(assertNodeHost('node-1.example.com')).toBe('node-1.example.com');
    expect(assertNodeHost('::1')).toBe('::1');
    expect(assertNodeHost('[2001:db8::1]')).toBe('2001:db8::1');
  });

  it('normalises the spellings that are one name to a resolver', () => {
    // A trailing dot is the root-anchored form of the same name, and an
    // uppercase label is the same name to DNS and a different string to
    // every comparison we make.
    expect(assertNodeHost('example.com.')).toBe('example.com');
    expect(assertNodeHost('  Node-1.Example.COM  ')).toBe('node-1.example.com');
  });

  it('refuses a host that would reach a shell', () => {
    // The value was interpolated into `ping -c 1 -W 5000 '<host>'` and run by
    // /bin/sh. An apostrophe ends the quoting; everything after it is a
    // command on the daemon's own machine.
    expect(() => assertNodeHost("x'; touch /tmp/pwned; '")).toThrow(/Invalid host/);
    expect(() => assertNodeHost('$(id)')).toThrow(/Invalid host/);
    expect(() => assertNodeHost('host && curl evil.example')).toThrow(/Invalid host/);
    expect(() => assertNodeHost('a`whoami`b')).toThrow(/Invalid host/);
  });

  it('refuses the empty and the malformed', () => {
    expect(() => assertNodeHost('')).toThrow(/required/);
    expect(() => assertNodeHost('   ')).toThrow(/required/);
    // Every label is a valid DNS label, so this reads as a hostname — and it
    // is a mistyped address. A numeric final label is never a real name.
    expect(() => assertNodeHost('999.1.1.1')).toThrow(/looks like an IP address/);
    expect(() => assertNodeHost('192.168.1')).toThrow(/looks like an IP address/);
    expect(() => assertNodeHost('-leading-hyphen.example')).toThrow(/Invalid host/);
    expect(() => assertNodeHost('a'.repeat(256))).toThrow(/too long/);
    expect(() => assertNodeHost('not:an:ipv6')).toThrow(/IPv6/);
  });
});

// =============================================================================
// 4. A check configuration the checker can run
// =============================================================================

describe('normalizeCheckConfig', () => {
  it('clamps a timeout that means "give up before trying"', () => {
    const cfg = normalizeCheckConfig({ pingTimeout: 0, sshTimeout: -5, concurrency: 0 });
    expect(cfg.pingTimeout).toBe(250);
    expect(cfg.sshTimeout).toBe(1_000);
    expect(cfg.concurrency).toBe(1);
  });

  it('rejects NaN rather than storing it', () => {
    // `NaN > max` is false and `NaN < min` is false, so an unclamped NaN
    // passes every bound and becomes a timeout no process can honour.
    const cfg = normalizeCheckConfig({ pingTimeout: Number.NaN, omnitronCheckTimeout: undefined });
    expect(cfg.pingTimeout).toBe(DEFAULT_CHECK_CONFIG.pingTimeout);
    expect(cfg.omnitronCheckTimeout).toBe(DEFAULT_CHECK_CONFIG.omnitronCheckTimeout);
  });

  it('caps the ceiling as well as the floor', () => {
    expect(normalizeCheckConfig({ concurrency: 100_000 }).concurrency).toBe(100);
    expect(normalizeCheckConfig({ sshTimeout: 999_999_999 }).sshTimeout).toBe(120_000);
  });

  it('keeps a boolean that is meant to be false', () => {
    expect(normalizeCheckConfig({ pingEnabled: false }).pingEnabled).toBe(false);
  });
});
