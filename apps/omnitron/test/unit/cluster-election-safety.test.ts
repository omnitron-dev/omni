/**
 * Leader election: who may be heard, and where peers are called.
 *
 * Both defects here were invisible for the same reason — the election path
 * fails silently by design. `callPeerRpc` swallows every error as "peer
 * unreachable" and heartbeats are fire-and-forget, so a wrong port and a
 * forged leader look identical to a quiet cluster.
 */

import { describe, it, expect, vi } from 'vitest';

import { LeaderElection } from '../../src/cluster/leader-election.js';
import type { FleetNode } from '../../src/shared/dto/fleet.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
  child: () => silentLogger,
} as never;

function node(id: string, rpcPort: number | null = 9801): FleetNode {
  return {
    id,
    hostname: id,
    address: '10.0.0.9',
    port: 9700,
    role: 'follower',
    status: 'online',
    lastHeartbeat: null,
    metadata: rpcPort === null ? {} : { rpcPort },
    createdAt: new Date().toISOString(),
  } as FleetNode;
}

/** A fleet registry holding exactly the nodes given. */
const fleetOf = (...nodes: FleetNode[]) => ({ listNodes: async () => nodes }) as never;

function election(fleet: unknown, nodeId = 'self') {
  return new LeaderElection(nodeId, fleet as never, silentLogger);
}

describe('what an unreadable registry means', () => {
  it('does not make a node leader', async () => {
    // The defect: `catch { this.becomeLeader() }` under the comment "become
    // leader by default (single node)". A registry that cannot be read says
    // nothing about how many nodes exist — three nodes losing Postgres
    // together each concluded they were alone, and each took charge. The
    // election produced the split-brain it exists to prevent.
    const e = election({ listNodes: async () => { throw new Error('pg down'); } });
    await e.start();

    await e.forceElection();

    expect(e.getClusterState().state).not.toBe('leader');
    await e.stop();
  });

  it('does make a node leader when the registry answers and holds no peers', async () => {
    // The distinction the fix rests on: an answer of "nobody" is a
    // measurement; a failure to answer is not. Without this the fix could be
    // "never become leader", which breaks every single-node deployment.
    const e = election(fleetOf());
    await e.start();

    await e.forceElection();

    expect(e.getClusterState().state).toBe('leader');
    await e.stop();
  });

  it('keeps trying rather than giving up', async () => {
    // Standing down is only safe if the node comes back to it. A node that
    // stood down permanently would leave a cluster leaderless once the
    // registry recovered.
    const e = election({ listNodes: async () => { throw new Error('pg down'); } });
    await e.start();
    await e.forceElection();

    expect(e.getClusterState().state).toBe('follower');
    await e.stop();
  });
});

describe('who may be heard', () => {
  it('ignores a heartbeat from a node that is not in the fleet', async () => {
    // The attack this blocks: `leaderHeartbeat({ leaderId: 'x', term: 1e9 })`
    // from anyone who can reach the port. Before the membership check the
    // receiver adopted the term, stepped down, and reset its election timer
    // on every further heartbeat — so the real cluster never recovered and
    // every master-only job (alerts, fleet heartbeat, telemetry relay)
    // stopped with it.
    const e = election(fleetOf(node('peer-1')));
    await e.start();
    const termBefore = e.getClusterState().term;

    await e.onHeartbeat({ leaderId: 'attacker', term: 1_000_000 } as never);

    expect(e.getClusterState().term).toBe(termBefore);
    expect(e.getClusterState().leaderId).not.toBe('attacker');
    await e.stop();
  });

  it('refuses a vote to a node that is not in the fleet', async () => {
    const e = election(fleetOf(node('peer-1')));
    await e.start();

    const response = await e.onVoteRequest({ candidateId: 'attacker', term: 1_000_000 } as never);

    expect(response.granted).toBe(false);
    await e.stop();
  });

  it('treats an unreadable registry as unknown, never as trusted', async () => {
    // Failing open here would mean a node that has lost its database accepts
    // any leader — the worst moment to start believing strangers.
    const e = election({ listNodes: async () => { throw new Error('pg down'); } });
    await e.start();

    expect((await e.onVoteRequest({ candidateId: 'peer-1', term: 9 } as never)).granted).toBe(false);
    await e.stop();
  });

  it('still accepts a registered peer', async () => {
    // A check that only rejects is satisfied by rejecting everything.
    const e = election(fleetOf(node('peer-1')));
    await e.start();

    const response = await e.onVoteRequest({ candidateId: 'peer-1', term: 1_000 } as never);

    expect(response.granted).toBe(true);
    await e.stop();
  });
});
