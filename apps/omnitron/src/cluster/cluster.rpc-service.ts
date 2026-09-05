/**
 * Cluster RPC Service
 *
 * Netron RPC endpoints for cluster operations:
 * - Vote requests (election protocol)
 * - Leader heartbeats
 * - Cluster state queries
 * - Step-down commands
 *
 * OPEN: `requestVote` and `leaderHeartbeat` are still unauthenticated.
 *
 * Peers call them over plain HTTP with no credential of any kind, because no
 * fleet credential exists — `SyncService.setMasterConnection`, the only other
 * cross-node path, has no production caller either. `LeaderElection` now
 * rejects both calls from ids absent from the fleet registry, which stops an
 * arbitrary outsider, but membership is not authentication: the ids are
 * discoverable and forgeable.
 *
 * What closes it is a fleet credential — a shared secret in `daemon.cluster`,
 * a service-role token, or mTLS on the fleet plane — and which of those is
 * right is a deployment decision, not a code cleanup. Until then the exposure
 * is bounded by the bind address: `daemon.host` defaults to loopback, so this
 * surface reaches the LAN only when an operator deliberately opts in.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';

import { VIEWER_ROLES } from '../shared/roles.js';
import type {
  LeaderElection,
  VoteRequest,
  VoteResponse,
  LeaderHeartbeatData,
  ClusterStateInfo,
} from './leader-election.js';

@Service({ name: 'OmnitronCluster' })
export class ClusterRpcService {
  constructor(private readonly election: LeaderElection) {}

  /**
   * Request vote from this node during an election.
   * Called by candidate nodes via Netron TCP.
   */
  @Public({ auth: { allowAnonymous: true } })
  async requestVote(data: VoteRequest): Promise<VoteResponse> {
    return this.election.onVoteRequest(data);
  }

  /**
   * Receive heartbeat from the current leader.
   * Called by the leader node at regular intervals via Netron TCP.
   */
  @Public({ auth: { allowAnonymous: true } })
  async leaderHeartbeat(data: LeaderHeartbeatData): Promise<{ ok: boolean }> {
    await this.election.onHeartbeat(data);
    return { ok: true };
  }

  /**
   * Get the current cluster state of this node.
   * Used by CLI (`omnitron cluster status`) and webapp dashboard.
   *
   * Both callers authenticate, so there was never a reason for this to be
   * anonymous — and it hands out the fleet's node ids, terms and leader,
   * which is exactly the reconnaissance the two calls below are weakest to.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getClusterState(): Promise<ClusterStateInfo> {
    return this.election.getClusterState();
  }

  /**
   * Force the current leader to step down.
   * Triggers a new election. Used by `omnitron cluster step-down`.
   */
  @Public()
  async stepDown(): Promise<{ success: boolean; message: string }> {
    if (!this.election.isLeader) {
      return { success: false, message: 'This node is not the leader' };
    }

    await this.election.stepDown();
    return { success: true, message: 'Leader stepped down — new election will begin' };
  }

  /**
   * Check if this node is the current leader.
   */
  @Public()
  async isLeader(): Promise<{ leader: boolean; nodeId: string; term: number }> {
    const state = this.election.getClusterState();
    return {
      leader: this.election.isLeader,
      nodeId: state.nodeId,
      term: state.term,
    };
  }
}
