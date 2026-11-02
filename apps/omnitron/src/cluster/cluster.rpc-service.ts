import { Service, Public } from '@omnitron-dev/titan/decorators';
import { ADMIN_ROLES, CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
import { FENCED_OPERATIONS, type ClusterParticipation } from '../shared/dto/cluster.js';
import type { StopAudience } from './stop-authority.js';
import type { LeaderElection } from './leader-election.js';

/** Authority is held in PostgreSQL; peers cannot vote or announce a leader. */
@Service({ name: 'OmnitronCluster' })
export class ClusterRpcService {
  constructor(private readonly election: LeaderElection | null, private readonly enrollment: StopAudience | null = null) {}

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getClusterState(): Promise<ClusterParticipation> {
    if (this.election) return { ...this.election.getClusterState(), participant: 'controller', enabled: true };
    if (this.enrollment) return { ...this.enrollment, participant: 'worker', enabled: true, coordination: 'postgres-lease', fencedOperations: FENCED_OPERATIONS };
    return { participant: 'standalone', enabled: false };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async stepDown(): Promise<{ success: boolean; message: string }> {
    if (!this.election?.isLeader) return { success: false, message: 'This node has no confirmed leadership lease' };
    await this.election.stepDown();
    return { success: true, message: 'Leadership lease released; another controller may acquire it' };
  }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async isLeader(): Promise<{ leader: boolean; nodeId: string | null; term: string | null }> {
    if (!this.election) return { leader: false, nodeId: this.enrollment?.nodeId ?? null, term: null };
    const state = this.election.getClusterState();
    return { leader: state.state === 'leader', nodeId: state.nodeId, term: state.term };
  }
}
