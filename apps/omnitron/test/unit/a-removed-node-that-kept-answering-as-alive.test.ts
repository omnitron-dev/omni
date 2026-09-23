/**
 * A node removed from the registry went on being reported alive.
 *
 * Measured 2026-09-23 on the live master: `omnitron node check` at 08:48:29Z
 * printed
 *
 *     126457d0-e6d3-4366-92f4-b149b3b6864c: SSH ●  Omnitron ●
 *
 * for a node removed at 07:28:00Z. The worker's summary for it read `online,
 * checkedAt 07:27:49.607Z` — 82 minutes old, its age shown nowhere — because:
 *
 *   - the worker's `updateNodes` replaced its node list and kept its status
 *     cache, so `getStatusSummaries` and every round's broadcast served the
 *     removed node for ever;
 *   - the daemon's `updateStatusCacheFromWorker` wrote each broadcast back,
 *     a node not in its registry included, every minute;
 *   - `checkAllNodes` returned whatever the worker said.
 *
 * (The CLI half — a bare id printed where a name was missing, and no age —
 * is judged in the-id-node-list-prints-accepted-by-no-command.test.ts.)
 */

import { describe, it, expect, vi } from 'vitest';

import { HealthMonitorService } from '../../src/workers/health-monitor.service.js';
import { NodeManagerService } from '../../src/services/node-manager.service.js';
import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';
import type { INodeHealthSummary } from '../../src/workers/types.js';

const silent: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silent,
};

const REMOVED = '126457d0-e6d3-4366-92f4-b149b3b6864c';
const KEPT = '16f3dd5a-2727-49e5-90a2-d762b57073f6';

function summary(nodeId: string, checkedAt = '2026-09-23T07:27:49.607Z'): INodeHealthSummary {
  return {
    nodeId,
    status: 'online',
    lastSeenOnline: checkedAt,
    consecutiveFailures: 0,
    lastCheck: {
      nodeId, checkedAt, checkDurationMs: 900,
      pingReachable: true, pingLatencyMs: 40, pingError: null,
      sshConnected: true, sshLatencyMs: 300, sshError: null,
      omnitronConnected: true, omnitronVersion: '0.2.0', omnitronPid: 7,
      omnitronUptime: 100, omnitronRole: 'slave', omnitronError: null, os: null,
    },
  };
}

const target = (id: string) => ({
  id, name: id.slice(0, 8), host: '203.0.113.7', sshPort: 22, sshUser: 'root', sshAuthMethod: 'key',
  runtime: 'node', daemonPort: 9700, isLocal: false, offlineTimeout: null,
});

describe('the health worker', () => {
  it('forgets a node the master removed', () => {
    const worker = new HealthMonitorService({ logger: silent } as never);
    const internals = worker as unknown as { nodes: Map<string, unknown>; statusCache: Map<string, INodeHealthSummary> };
    internals.nodes.set(REMOVED, target(REMOVED));
    internals.nodes.set(KEPT, target(KEPT));
    internals.statusCache.set(REMOVED, summary(REMOVED));
    internals.statusCache.set(KEPT, summary(KEPT));

    worker.updateNodes(JSON.stringify([target(KEPT)]));

    // What `getStatusSummaries` returns is what every round broadcasts.
    expect(worker.getStatusSummaries().map((s) => s.nodeId)).toEqual([KEPT]);
  });
});

describe('the daemon\'s status cache', () => {
  it('does not take a status for a node its registry does not hold', () => {
    const touched: string[] = [];
    const manager = new NodeManagerService(silent, {
      selectNodesSync: () => [],
      upsertNodeSync: () => {},
      deleteNodeSync: () => {},
      touchNodeHeartbeatSync: (id: string) => touched.push(id),
      kvGetSync: () => null,
      kvSetSync: () => {},
    } as never);

    manager.updateStatusCacheFromWorker([summary(REMOVED)]);

    expect(manager.getHealthSummaries().map((s) => s.nodeId)).not.toContain(REMOVED);
    expect(manager.listNodes().map((n) => n.id)).not.toContain(REMOVED);
    // Nor a heartbeat written against a row that was deleted.
    expect(touched).not.toContain(REMOVED);
  });
});

describe('what the RPC answers', () => {
  /** A registry holding one node, and a worker that remembers two. */
  function rpcWithStaleWorker() {
    const registry = {
      getNode: vi.fn((id: string) => (id === KEPT ? { id, name: 'daos-test' } : null)),
      updateStatusCacheFromWorker: vi.fn(),
      getHealthSummaries: vi.fn(() => [summary(KEPT)]),
      checkAllNodes: vi.fn(async () => []),
      reportWorkerUnavailable: vi.fn(),
    } as any;
    const rpc = new NodeManagerRpcService(registry);
    rpc.setHealthWorkerProxy({
      triggerCheck: vi.fn(async () => [summary(KEPT), summary(REMOVED)]),
      getStatusSummaries: vi.fn(async () => [summary(KEPT), summary(REMOVED)]),
    });
    return rpc;
  }

  it('checkAllNodes names only registered nodes', async () => {
    const statuses = await rpcWithStaleWorker().checkAllNodes();
    expect(statuses.map((s) => s.nodeId)).toEqual([KEPT]);
  });

  it('getNodeHealthSummaries names only registered nodes', async () => {
    const summaries = await rpcWithStaleWorker().getNodeHealthSummaries();
    expect(summaries.map((s) => s.nodeId)).toEqual([KEPT]);
  });

  it('triggerNodeCheck names only registered nodes', async () => {
    const summaries = await rpcWithStaleWorker().triggerNodeCheck({});
    expect(summaries.map((s) => s.nodeId)).toEqual([KEPT]);
  });
});
