/**
 * Fleet RPC Service
 *
 * Netron RPC endpoints for multi-node fleet management from webapp and CLI.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES, OPERATOR_ROLES } from '../shared/roles.js';
import type { FleetService, FleetNode, FleetSummary, NodeRegistration, NodeRole } from './fleet.service.js';

@Service({ name: 'OmnitronFleet' })
export class FleetRpcService {
  constructor(private readonly fleet: FleetService) {}

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listNodes(): Promise<FleetNode[]> {
    return this.fleet.listNodes();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getSummary(): Promise<FleetSummary> {
    return this.fleet.getSummary();
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async registerNode(data: NodeRegistration): Promise<FleetNode> {
    return this.fleet.registerNode(data);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async removeNode(data: { nodeId: string }): Promise<{ success: boolean }> {
    await this.fleet.removeNode(data.nodeId);
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getNode(data: { nodeId: string }): Promise<FleetNode | null> {
    return this.fleet.getNode(data.nodeId);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async setRole(data: { nodeId: string; role: NodeRole }): Promise<FleetNode> {
    return this.fleet.setRole(data.nodeId, data.role);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async drainNode(data: { nodeId: string }): Promise<{ success: boolean }> {
    await this.fleet.drainNode(data.nodeId);
    return { success: true };
  }

  /** Called by follower daemons to report heartbeat */
  @Public({ auth: { allowAnonymous: true } })
  async heartbeat(data: { nodeId: string }): Promise<{ ok: boolean }> {
    await this.fleet.heartbeat(data.nodeId);
    return { ok: true };
  }
}
