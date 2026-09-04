/**
 * Infrastructure RPC Service
 *
 * Netron RPC endpoints for infrastructure container management
 * (Docker-based PostgreSQL, Redis, MinIO, etc.).
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import { VIEWER_ROLES, OPERATOR_ROLES } from '../shared/roles.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { InfrastructureState, ContainerState } from '../infrastructure/types.js';
import type { IOmnitronInfraService } from '../shared/dto/services.js';
import {
  startContainer,
  stopContainer,
  removeContainer,
  getContainerLogs,
} from '../infrastructure/container-runtime.js';

@Service({ name: 'OmnitronInfra' })
export class InfrastructureRpcService implements IOmnitronInfraService {
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

  // ===========================================================================
  // Container lifecycle
  //
  // The console's containers page has had start / stop / remove / logs buttons
  // all along, wired to methods that existed nowhere — every click 404'd.
  // `container-runtime` already implements each operation; this service simply
  // never exposed them.
  //
  // Every entry point resolves the name against the daemon's OWN managed set
  // first. Without that check an operator role would be able to stop or delete
  // any container on the host — including ones belonging to other projects, or
  // to the daemon's own database — by passing its name.
  // ===========================================================================

  /**
   * @throws when the container is not one this daemon manages.
   */
  private assertManaged(name: string): void {
    const infra = this.getInfra();
    if (!infra) {
      throw Errors.badRequest('Infrastructure is not provisioned on this daemon');
    }
    const managed = Object.values(infra.getState().services).some((service) => service.name === name);
    if (!managed) {
      throw Errors.notFound('Managed container', name);
    }
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startContainer(data: { name: string }): Promise<{ success: boolean }> {
    this.assertManaged(data.name);
    await startContainer(data.name);
    return { success: true };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopContainer(data: { name: string; timeout?: number }): Promise<{ success: boolean }> {
    this.assertManaged(data.name);
    await stopContainer(data.name, data.timeout);
    return { success: true };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async removeContainer(data: { name: string }): Promise<{ success: boolean }> {
    this.assertManaged(data.name);
    await removeContainer(data.name);
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getContainerLogs(data: { name: string; tail?: number }): Promise<{ logs: string }> {
    this.assertManaged(data.name);
    // Cap the tail so a viewer cannot ask the daemon to buffer an unbounded
    // amount of container output into a single RPC response.
    const tail = Math.min(Math.max(data.tail ?? 100, 1), 5_000);
    return { logs: await getContainerLogs(data.name, tail) };
  }
}
