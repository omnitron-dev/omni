/**
 * Infrastructure RPC Service
 *
 * Netron RPC endpoints for infrastructure container management
 * (Docker-based PostgreSQL, Redis, MinIO, etc.).
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { VIEWER_ROLES } from '../shared/roles.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { InfrastructureState, ContainerState } from '../infrastructure/types.js';

@Service({ name: 'OmnitronInfra' })
export class InfrastructureRpcService {
  constructor(private readonly getInfra: () => InfrastructureService | null) {}

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getState(): Promise<InfrastructureState | null> {
    const infra = this.getInfra();
    return infra ? infra.getState() : null;
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async listContainers(): Promise<ContainerState[]> {
    const infra = this.getInfra();
    if (!infra) return [];
    const state = infra.getState();
    return Object.values(state.services);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getConnectionInfo(data: { service: string }): Promise<Record<string, unknown> | null> {
    const infra = this.getInfra();
    if (!infra) return null;
    return infra.getConnectionInfo(data.service);
  }
}
