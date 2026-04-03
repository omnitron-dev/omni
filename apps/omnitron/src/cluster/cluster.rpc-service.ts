/**
 * Cluster RPC Service
 *
 * Netron RPC endpoints for cluster operations:
 * - Vote requests (election protocol)
 * - Leader heartbeats
 * - Cluster state queries
 * - Step-down commands
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
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
   */
  @Public({ auth: { allowAnonymous: true } })
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
