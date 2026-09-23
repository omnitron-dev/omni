/**
 * One call the worker refused detached it for the life of the daemon.
 *
 * Measured 2026-09-23 on the live master:
 *
 *     $ omnitron node check 16f3dd5a          # the id `node list` prints
 *     Failed: Node not found: 16f3dd5a
 *
 * and at 08:49:56.649Z the master logged «Health monitor worker unavailable —
 * serving this check from the daemon» although the worker was alive and
 * checking. `getNodeHealthSummaries` fell from 3 entries to 0, and every
 * later check went through the daemon's own path. On 2026-09-22 at 18:48:14Z
 * the same happened from a single «RPC request timed out after 5000ms».
 *
 * `callWorker` set the proxy to null on ANY error, and only a worker RESPAWN
 * ever wired it again — a live worker is never respawned. The worker throws
 * for an id it does not hold, so a typo was enough.
 */

import { describe, it, expect, vi } from 'vitest';

import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';

const REGISTERED = '16f3dd5a-2727-49e5-90a2-d762b57073f6';

const summary = {
  nodeId: REGISTERED,
  status: 'online',
  lastSeenOnline: '2026-09-23T08:49:00.000Z',
  consecutiveFailures: 0,
  lastCheck: {
    nodeId: REGISTERED, checkedAt: '2026-09-23T08:49:00.000Z', checkDurationMs: 900,
    pingReachable: true, pingLatencyMs: 40, pingError: null,
    sshConnected: true, sshLatencyMs: 300, sshError: null,
    omnitronConnected: true, omnitronVersion: '0.2.0', omnitronPid: 7,
    omnitronUptime: 100, omnitronRole: 'slave', omnitronError: null, os: null,
  },
};

/** The registry, holding one node, and the daemon's own answers about it. */
function registry() {
  return {
    getNode: vi.fn((id: string) => (id === REGISTERED ? { id, name: 'daos-test', host: '37.27.130.185' } : null)),
    checkNodeStatus: vi.fn(async (id: string) => ({
      nodeId: id, pingReachable: true, pingLatencyMs: 40, sshConnected: null, sshLatencyMs: null,
      omnitronConnected: true, checkedAt: new Date().toISOString(),
    })),
    checkAllNodes: vi.fn(async () => []),
    updateStatusCacheFromWorker: vi.fn(),
    getHealthSummaries: vi.fn(() => [summary]),
    reportWorkerUnavailable: vi.fn(),
  } as any;
}

/** A live worker: it checks what it knows, and refuses what it does not. */
function liveWorker() {
  return {
    triggerCheck: vi.fn(async (nodeId?: string) => {
      if (nodeId && nodeId !== REGISTERED) throw new Error(`Node not found: ${nodeId}`);
      return [summary];
    }),
    getStatusSummaries: vi.fn(async () => [summary]),
  };
}

describe('a node id the registry does not hold', () => {
  it('is refused in the registry\'s words, before the worker is asked', async () => {
    const nodes = registry();
    const worker = liveWorker();
    const rpc = new NodeManagerRpcService(nodes);
    rpc.setHealthWorkerProxy(worker);

    await expect(rpc.checkNodeStatus({ id: '16f3dd5a' })).rejects.toThrow(/Node with id 16f3dd5a not found/);

    expect(worker.triggerCheck).not.toHaveBeenCalled();
    expect(rpc.hasHealthWorker()).toBe(true);
  });

  it('is refused by triggerNodeCheck too', async () => {
    const worker = liveWorker();
    const rpc = new NodeManagerRpcService(registry());
    rpc.setHealthWorkerProxy(worker);

    await expect(rpc.triggerNodeCheck({ nodeId: 'daos-test' })).rejects.toThrow(/not found/);
    expect(worker.triggerCheck).not.toHaveBeenCalled();
  });

  it('leaves the fleet summaries where they were', async () => {
    // The measured symptom: three summaries before the typo, none after.
    const rpc = new NodeManagerRpcService(registry());
    rpc.setHealthWorkerProxy(liveWorker());

    expect(await rpc.getNodeHealthSummaries()).toHaveLength(1);
    await rpc.checkNodeStatus({ id: '16f3dd5a' }).catch(() => undefined);
    expect(await rpc.getNodeHealthSummaries()).toHaveLength(1);
  });
});

describe('a worker call that fails', () => {
  it('costs that call, and the next one asks the worker again', async () => {
    const nodes = registry();
    const worker = liveWorker();
    worker.triggerCheck.mockRejectedValueOnce(new Error('RPC request timed out after 5000ms'));
    const rpc = new NodeManagerRpcService(nodes);
    rpc.setHealthWorkerProxy(worker);

    // Served from the daemon, and said so in its log.
    await rpc.checkNodeStatus({ id: REGISTERED });
    expect(nodes.checkNodeStatus).toHaveBeenCalledTimes(1);
    expect(nodes.reportWorkerUnavailable).toHaveBeenCalledWith('triggerCheck', expect.any(Error));

    // And the worker answers the next one.
    const status = await rpc.checkNodeStatus({ id: REGISTERED });
    expect(worker.triggerCheck).toHaveBeenCalledTimes(2);
    expect(nodes.checkNodeStatus).toHaveBeenCalledTimes(1);
    expect(status.omnitronVersion).toBe('0.2.0');
    expect(rpc.hasHealthWorker()).toBe(true);
  });
});

describe('the fleet summaries without a worker', () => {
  it('come from the daemon, not as an empty fleet', async () => {
    const nodes = registry();
    const rpc = new NodeManagerRpcService(nodes);

    expect(await rpc.getNodeHealthSummaries()).toEqual([summary]);
  });

  it('come from the daemon when the worker call throws', async () => {
    const nodes = registry();
    const rpc = new NodeManagerRpcService(nodes);
    rpc.setHealthWorkerProxy({
      triggerCheck: vi.fn(),
      getStatusSummaries: vi.fn(async () => {
        throw new Error('RPC request timed out after 5000ms');
      }),
    });

    expect(await rpc.getNodeHealthSummaries()).toEqual([summary]);
  });
});
