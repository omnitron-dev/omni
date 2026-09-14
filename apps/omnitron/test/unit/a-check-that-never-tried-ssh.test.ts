/**
 * The daemon's fallback check reported an SSH refusal it never attempted.
 *
 * Two producers fill `INodeStatus`. The health-monitor worker opens an SSH
 * session on every remote round. The daemon's own fallback — which runs
 * whenever that worker is down — pings the host and probes the Netron port,
 * and opens no SSH session at all, because a node running omnitron is reached
 * over Netron and SSH is how you install it there in the first place.
 *
 * The fallback wrote `sshConnected: false`, with the comment "SSH not
 * checked". `false` does not mean "not checked" to anything downstream: the
 * console branched on it to decide it could not know the omnitron state and
 * rendered "Waiting for SSH connection", `omnitron node ls` printed SSH
 * `○ down`, and the reason the check DID have — in `omnitronError` — was
 * shown by nobody.
 *
 * Observed 2026-09-14 on the development fleet: a node whose SSH answered in
 * 311 ms, whose stored history said so, and whose card read "Waiting for SSH
 * connection" because the card was being served by the fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { INodeStatus } from '../../src/shared/dto/nodes.js';

const ping = vi.fn(async () => ({ reachable: true, latencyMs: 12 }));

vi.mock('../../src/services/remote-ops.service.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  RemoteOpsService: class {
    ping = ping;
  },
}));

const { NodeManagerService } = await import('../../src/services/node-manager.service.js');

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
};

/**
 * A node manager holding one remote node, with the registry write path and
 * the secret vault stubbed out — neither is what this file is about.
 */
function managerWithRemoteNode() {
  const svc = new (NodeManagerService as any)(silentLogger, { get: () => null, set: () => {}, delete: () => {} });
  const node = {
    id: 'n1',
    name: 'edge-1',
    host: '203.0.113.7',
    sshPort: 22,
    sshUser: 'root',
    isLocal: false,
    daemonPort: 9700,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  (svc as any).nodes.set(node.id, node);
  (svc as any).remoteOps = { ping };
  // 203.0.113.0/24 is TEST-NET-3 and routes nowhere, so the Netron probe runs
  // its full budget before failing. That failure is what these tests want;
  // waiting the production 30 seconds for it is not.
  (svc as any).checkConfig = { ...(svc as any).checkConfig, omnitronCheckTimeout: 150 };
  return svc;
}

beforeEach(() => {
  ping.mockClear();
});

describe('a check that opened no SSH session', () => {
  it('leaves sshConnected null rather than claiming a refusal', async () => {
    const svc = managerWithRemoteNode();

    const status: INodeStatus = await svc.checkNodeStatus('n1');

    // The whole point: `null` is "not attempted", `false` is "refused". The
    // console, the CLI and the health summary all branch on the difference.
    expect(status.sshConnected).toBeNull();
    expect(status.sshLatencyMs).toBeNull();
  });

  it('still reports what it DID measure', async () => {
    const svc = managerWithRemoteNode();

    const status: INodeStatus = await svc.checkNodeStatus('n1');

    // A fallback that says nothing is worse than no fallback: this check
    // reaches the host and the daemon port, and both answers are real.
    expect(status.pingReachable).toBe(true);
    expect(status.pingLatencyMs).toBe(12);
    expect(status.omnitronConnected).toBe(false);
    expect(status.omnitronError).toBeTruthy();
  });

  it('does not let "not attempted" count as reachability', async () => {
    const svc = managerWithRemoteNode();
    ping.mockResolvedValueOnce({ reachable: false, latencyMs: null, error: 'timeout' } as never);

    await svc.checkNodeStatus('n1');
    const [summary] = svc.getHealthSummaries('n1');

    // `reachable` is `sshConnected || pingReachable || omnitronConnected`.
    // A truthy "not attempted" would have made every unreachable node look
    // degraded rather than offline — which is the state an alert fires on.
    expect(summary.status).toBe('offline');
  });

  it('keeps the local node at a real true', async () => {
    const svc = managerWithRemoteNode();
    const status: INodeStatus = await svc.checkNodeStatus('local');

    // We ARE this machine; there is nothing to attempt and the answer is
    // known. `null` here would be a different lie.
    expect(status.sshConnected).toBe(true);
  });
});
