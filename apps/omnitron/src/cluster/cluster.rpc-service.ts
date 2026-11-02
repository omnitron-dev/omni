import { Service, Public } from '@omnitron-dev/titan/decorators';
import { ADMIN_ROLES, CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
import type { LeaderElection, ClusterStateInfo } from './leader-election.js';

/** Authority is held in PostgreSQL; peers cannot vote or announce a leader. */
@Service({ name: 'OmnitronCluster' })
export class ClusterRpcService {
  constructor(private readonly election: LeaderElection) {}

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getClusterState(): Promise<ClusterStateInfo> {
    return this.election.getClusterState();
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async stepDown(): Promise<{ success: boolean; message: string }> {
    if (!this.election.isLeader) return { success: false, message: 'This node has no confirmed leadership lease' };
    await this.election.stepDown();
    return { success: true, message: 'Leadership lease released; another controller may acquire it' };
  }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async isLeader(): Promise<{ leader: boolean; nodeId: string; term: string | null }> {
    const state = this.election.getClusterState();
    return { leader: state.state === 'leader', nodeId: state.nodeId, term: state.term };
  }
}
