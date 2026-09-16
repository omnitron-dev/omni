/**
 * Cluster RPC Service
 *
 * Netron RPC endpoints for cluster operations:
 * - Vote requests (election protocol)
 * - Leader heartbeats
 * - Cluster state queries
 * - Step-down commands
 *
 * `stepDown` and `isLeader` used to carry a bare `@Public()`, which
 * configures no auth at all — `enforceMethodAuthorization` returns early on a
 * method with no auth config, so both were open to anyone who could reach the
 * transport. They are now closed; the two below are the ones that remain open
 * on purpose.
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

import { VIEWER_ROLES, CONTROL_PLANE_ROLES } from '../shared/roles.js';
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
   *
   * A bare `@Public()` configures no auth at all, and
   * `enforceMethodAuthorization` returns early on a method with no auth
   * config — "nothing to enforce". So this sat open to anyone who could reach
   * the transport, two lines below a READ of the same cluster state that is
   * closed to viewer roles, and one method away from the two that are
   * anonymous deliberately and say so in the file header. The header
   * discusses `requestVote` and `leaderHeartbeat` at length and does not
   * mention this one: it was not a decision, it was an omission in the shape
   * of one.
   *
   * Deposing a leader is an operation, and the control plane performs it on
   * its own behalf during a rolling restart — hence the same list the other
   * master-to-node calls use rather than OPERATOR_ROLES, which a
   * `service_role` token is not a member of.
   */
  @Public({ auth: { roles: CONTROL_PLANE_ROLES } })
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
  // Reading who the leader is, closed like the state query beside it: the
  // node ids and terms it returns are the same reconnaissance.
  @Public({ auth: { roles: VIEWER_ROLES } })
  async isLeader(): Promise<{ leader: boolean; nodeId: string; term: number }> {
    const state = this.election.getClusterState();
    return {
      leader: this.election.isLeader,
      nodeId: state.nodeId,
      term: state.term,
    };
  }
}
