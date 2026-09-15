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
import type { InfrastructureConfig } from '../infrastructure/types.js';
import { summariseProvisioning, describeProvisioning } from '../infrastructure/provisioning-outcome.js';
import type { InfrastructureState, ContainerState } from '../infrastructure/types.js';
import type { IOmnitronInfraService } from '../shared/dto/services.js';
import {
  startContainer,
  stopContainer,
  removeContainer,
  getContainerLogs,
  listManagedContainers,
} from '../infrastructure/container-runtime.js';

@Service({ name: 'OmnitronInfra' })
export class InfrastructureRpcService implements IOmnitronInfraService {
  constructor(
    private readonly getInfra: () => InfrastructureService | null,
    /**
     * How this daemon builds and adopts an infrastructure it is asked for.
     *
     * The daemon does it, not this service: it holds the logger the node
     * logs through, and it is what has to remember the result — the same
     * field `getState`, the health indicator and the shutdown path read.
     *
     * Absent on a daemon that will not host one, and the call is then
     * refused by name rather than silently doing nothing, which is the
     * difference between "this node does not do that" and "it worked".
     */
    private readonly hostInfra?: (config: InfrastructureConfig) => InfrastructureService,
  ) {}

  /**
   * Bring up the infrastructure a stack needs, here, on this node.
   *
   * A node deployed to by `omnitron stack start` received its applications
   * and nothing for them to connect to. `startRemoteStack` provisioned the
   * daemon, shipped the artifacts and opened the mesh connection; the
   * stack's `infrastructure` block — its Postgres, its Redis, its MinIO —
   * was read by the master and never left it. Worse, a provisioned slave is
   * started with `--no-infra`, and the boot path is guarded by
   * `config.infrastructure && !isSlave`, so a node would not have acted on
   * one even if it had been given one.
   *
   * Everything needed was already here. `InfrastructureService` reconciles
   * containers against a desired set, waits on health, and keeps a janitor
   * for stale endpoints; it runs against the `docker` CLI directly, which is
   * what a provisioned node has. The only thing missing was a way to ask.
   *
   * The master orchestrates and the node executes, which is the same
   * division the mesh already uses: a node that loses its master keeps
   * supervising what it was given.
   *
   * Idempotent, because reconciliation is: calling it twice with the same
   * config leaves the containers alone and returns the same report.
   */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async provisionStack(data: { config: InfrastructureConfig }): Promise<{
    ready: boolean;
    detail: string;
    running: string[];
    failed: Array<{ name: string; status: string; error: string | null }>;
    missing: string[];
  }> {
    if (!this.hostInfra) {
      throw Errors.badRequest('This daemon does not host stack infrastructure.');
    }
    if (!data?.config || typeof data.config !== 'object') {
      throw Errors.badRequest('provisionStack requires an `infrastructure` config.');
    }

    // Reused when this node already has one: reconciliation is idempotent,
    // and building a second service would give the node two janitors and
    // two health monitors over one set of containers.
    const service = this.getInfra() ?? this.hostInfra(data.config);

    const state = await service.provision();
    const outcome = summariseProvisioning(service.getDesiredServices(), state.services);

    return {
      ready: outcome.ready,
      detail: describeProvisioning(outcome),
      running: outcome.running.map((s) => s.name),
      failed: outcome.failed.map((s) => ({ name: s.name, status: String(s.status), error: s.error ?? null })),
      missing: outcome.missing.map((s) => s.name),
    };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getState(): Promise<InfrastructureState | null> {
    const infra = this.getInfra();
    return infra ? infra.getState() : null;
  }

  /**
   * Containers this Omnitron manages, read from the container runtime.
   *
   * This used to return `Object.values(infra.getState().services)` — the
   * daemon's in-memory bookkeeping, which is populated only when THIS daemon
   * process provisioned them. Containers outlive the daemon, so after any
   * restart the map is empty while the containers keep running: `omnitron
   * infra status` listed eleven and the console's containers page listed
   * none, and said "No containers found. Infrastructure containers will
   * appear here when Docker is running" — an empty state indistinguishable
   * from a broken query, which is why it went unnoticed.
   *
   * `listManagedContainers` asks the runtime and filters on the
   * `omnitron.managed` label, so it answers the same in a fresh daemon as in
   * one that did the provisioning — and it is the same call the CLI makes,
   * which is what stops the two from disagreeing again.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async listContainers(): Promise<ContainerState[]> {
    return listManagedContainers();
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
  private async assertManaged(name: string): Promise<void> {
    // Resolved against the runtime for the same reason as `listContainers`:
    // the in-memory map is empty after a daemon restart, so this rejected
    // every name and the console's start / stop / remove buttons failed with
    // "Managed container not found" against containers that were plainly
    // running in the list beside them.
    const managed = await listManagedContainers();
    if (!managed.some((container) => container.name === name)) {
      throw Errors.notFound('Managed container', name);
    }
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startContainer(data: { name: string }): Promise<{ success: boolean }> {
    await this.assertManaged(data.name);
    await startContainer(data.name);
    return { success: true };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopContainer(data: { name: string; timeout?: number }): Promise<{ success: boolean }> {
    await this.assertManaged(data.name);
    await stopContainer(data.name, data.timeout);
    return { success: true };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async removeContainer(data: { name: string }): Promise<{ success: boolean }> {
    await this.assertManaged(data.name);
    await removeContainer(data.name);
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getContainerLogs(data: { name: string; tail?: number }): Promise<{ logs: string }> {
    await this.assertManaged(data.name);
    // Cap the tail so a viewer cannot ask the daemon to buffer an unbounded
    // amount of container output into a single RPC response.
    const tail = Math.min(Math.max(data.tail ?? 100, 1), 5_000);
    return { logs: await getContainerLogs(data.name, tail) };
  }
}
