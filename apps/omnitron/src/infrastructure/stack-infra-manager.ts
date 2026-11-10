import { isDeepStrictEqual } from 'node:util';
import { hostPortsOverlap, inspectStackContainers, removeContainer } from './container-runtime.js';
import { ownsStackInfrastructure } from '../project/infrastructure-ownership.js';
import { RecoveryBusyError, RecoveryMutation } from '../daemon/recovery-state.js';
import { usesGatewayTemplate, withInfrastructureScope } from './service-resolver.js';
/**
 * StackInfrastructureManager — Per-stack infrastructure isolation
 *
 * Each stack gets its own InfrastructureService instance with namespaced
 * Docker containers, ports, and Redis DB ranges. This ensures stacks
 * (dev, test, prod) can run simultaneously without conflicts.
 *
 * Container naming: omnitron-{project}-{stack}-{service}
 *   e.g., omnitron-myproj-dev-postgres, omnitron-myproj-test-redis
 *
 * Port allocation: base port + stack offset
 *   dev:  postgres:5432, redis:6379, minio:9000
 *   test: postgres:5532, redis:6479, minio:9100
 *   prod: postgres:5632, redis:6579, minio:9200
 *
 * Redis DB allocation: stacks get non-overlapping DB ranges
 *   dev:  0-4
 *   test: 5-9
 *   prod: 10-14
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { InfrastructureConfig } from './types.js';
import type { IStackConfig, IStackSettings } from '../config/types.js';
import { InfrastructureService } from './infrastructure.service.js';
import { setContainerPrefix, setStackLabels, gatewayHostPort } from './service-resolver.js';
import { gatewayRedisDb as gatewayRedisDbOf } from './gateway-redis-db.js';

// =============================================================================
// Default port offsets per stack index
// =============================================================================

const DEFAULT_PORT_OFFSETS: Record<string, { postgres: number; redis: number; minio: number }> = {
  dev: { postgres: 0, redis: 0, minio: 0 },
  test: { postgres: 100, redis: 100, minio: 100 },
  staging: { postgres: 200, redis: 200, minio: 200 },
  prod: { postgres: 300, redis: 300, minio: 300 },
};

const REDIS_DB_RANGE_SIZE = 5;

// =============================================================================
// Manager
// =============================================================================

export class StackInfrastructureManager {
  /** Incoming declarations contain the destination's actual published ports; local stack offsets have already been resolved. */
  async provisionHosted<T>(project: string, stack: string, work: (apply: (
    config: InfrastructureConfig, definition: InfrastructureService
  ) => Promise<InfrastructureService>) => Promise<T>, legacy?: InfrastructureService | null): Promise<T> {
    const key = `${project}/${stack}`;
    return this.mutateStack(key, () => withInfrastructureScope(project, stack, () => work(async (config, definition) => {
      const allocation = this.computePortAllocation(project, stack, {
        portOffsets: { postgres: 0, redis: 0, minio: 0 }, redisDbOffset: 0,
      }, config);
      if (legacy) this.checkClaims(key, definition, 'host infrastructure', legacy);
      this.instances.get(key)?.resumeStack({ project, stack });
      return this.installDefinition(project, stack, definition, allocation);
    })));
  }
  captureRecoveryState(): Awaited<ReturnType<StackInfrastructureManager['prepareHandoff']>> {
    if (this.mutations.size || this.handoffFrozen) throw new RecoveryBusyError('Stack infrastructure ownership is changing');
    return [...this.instances].map(([key, service]) => {
      const allocation = this.portAllocations.get(key);
      if (!allocation) throw new Error(`Infrastructure port ownership is missing for ${key}`);
      return { key, allocation: structuredClone(allocation), infrastructure: service.captureRecoveryState() };
    });
  }

  async prepareHandoff(): Promise<Array<{
    key: string; allocation: StackPortAllocation;
    infrastructure: import('./infrastructure.service.js').InfrastructureHandoffState;
  }>> {
    if (this.mutations.size || this.handoffFrozen) throw new RecoveryBusyError('Stack infrastructure ownership is changing');
    this.handoffFrozen = true;
    const records = [];
    try {
      for (const [key, service] of this.instances) {
        const allocation = this.portAllocations.get(key);
        if (!allocation) throw new Error(`Infrastructure port ownership is missing for ${key}`);
        records.push({ key, allocation, infrastructure: await service.prepareHandoff() });
      }
      return structuredClone(records);
    } catch (error) { this.resumeAfterHandoff(); throw error; }
  }

  resumeAfterHandoff(): void {
    for (const service of this.instances.values()) service.resumeAfterHandoff();
    this.handoffFrozen = false;
  }

  async adoptHandoff(records: Awaited<ReturnType<StackInfrastructureManager['prepareHandoff']>>): Promise<void> {
    if (this.instances.size || this.mutations.size) throw new Error('Infrastructure must be empty before handoff adoption');
    this.handoffFrozen = true;
    for (const record of records) {
      if (this.instances.has(record.key)) throw new Error(`Duplicate infrastructure owner ${record.key}`);
      const service = await InfrastructureService.adoptHandoff(this.logger, record.infrastructure);
      this.instances.set(record.key, service);
      this.portAllocations.set(record.key, structuredClone(record.allocation));
    }
  }

  /** Active infrastructure services keyed by `${project}/${stack}` */
  private readonly instances = new Map<string, InfrastructureService>();

  /** Port allocations keyed by `${project}/${stack}` */
  private readonly portAllocations = new Map<string, StackPortAllocation>();

  private readonly mutations = new Map<string, InfrastructureService | undefined>();
  private handoffFrozen = false;

  /** Reserve the allocation before asynchronous resolution as well as native work. */
  private async mutateStack<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.handoffFrozen) throw new RecoveryBusyError('Stack infrastructure ownership is frozen');
    if (this.mutations.has(key)) throw new RecoveryBusyError(`Infrastructure mutation is already in progress for ${key}`);
    this.mutations.set(key, undefined);
    try { return await operation(); }
    finally { this.mutations.delete(key); }
  }

  /** Deterministic hash of stack name → offset index for unknown stack names */

  constructor(private readonly logger: ILogger) {}

  /**
   * Create and provision infrastructure for a stack.
   * Returns the InfrastructureService instance (already provisioned).
   */
  @RecoveryMutation()
  async provisionStack(
    project: string,
    stack: string,
    stackConfig: IStackConfig,
    baseInfraConfig: InfrastructureConfig,
    appDefinitions?: Map<string, import('../config/types.js').IAppDefinition>,
    projectRoot?: string
  ): Promise<InfrastructureService> {
    if (!ownsStackInfrastructure(stackConfig)) throw new Error('This stack does not own infrastructure provisioning');
    const key = `${project}/${stack}`;
    return this.mutateStack(key, () => withInfrastructureScope(project, stack, () =>
      this.provisionStackScoped(project, stack, stackConfig, baseInfraConfig, appDefinitions, projectRoot)
    ));
  }

  /** Same resolver as provisioning, without reserving ports, registering owners or touching Docker. */
  async planStack(
    project: string, stack: string, config: IStackConfig, infrastructure: InfrastructureConfig,
    definitions?: Map<string, import('../config/types.js').IAppDefinition>, directory?: string,
  ): Promise<import('./types.js').ResolvedContainer[]> {
    if (!ownsStackInfrastructure(config)) return [];
    return withInfrastructureScope(project, stack, async () => {
      const allocation = this.computePortAllocation(project, stack, config.settings, infrastructure);
      const service = await this.resolveStackDefinition(project, stack, config, infrastructure, allocation, definitions, directory, true);
      return service.getDesiredContainers();
    });
  }

  private async provisionStackScoped(
    project: string,
    stack: string,
    stackConfig: IStackConfig,
    baseInfraConfig: InfrastructureConfig,
    appDefinitions?: Map<string, import('../config/types.js').IAppDefinition>,
    projectRoot?: string
  ): Promise<InfrastructureService> {
    // 1. Compute port allocation for this stack
    const portAlloc = this.computePortAllocation(project, stack, stackConfig.settings, baseInfraConfig);
    const definition = await this.resolveStackDefinition(project, stack, stackConfig, baseInfraConfig, portAlloc, appDefinitions, projectRoot);
    return this.installDefinition(project, stack, definition, portAlloc);
  }

  private async installDefinition(project: string, stack: string, definition: InfrastructureService, portAlloc: StackPortAllocation): Promise<InfrastructureService> {
    const key = `${project}/${stack}`;
    for (const [owner, service] of [...this.instances, ...this.mutations]) {
      if (service && owner !== key) this.checkClaims(key, definition, owner, service);
    }
    this.mutations.set(key, definition);
    const existing = this.instances.get(key);
    const infraService = existing ?? definition;

    // Register BEFORE provision so the UI can query intermediate state
    // during the provisioning process (which may take 30+ seconds).
    this.instances.set(key, infraService);

    try {
      await infraService.provision(existing ? definition : undefined);
      this.portAllocations.set(key, portAlloc);
      return infraService;
    } catch (err) {
      // Retain the observer and declared resources after a failed retry.
      // A normalization failure above never changes the existing definition.
      if (!existing) {
        this.instances.delete(key);
        this.portAllocations.delete(key);
      } else if (isDeepStrictEqual(existing.getDesiredContainers(), definition.getDesiredContainers())) this.portAllocations.set(key, portAlloc);
      this.logger.error({ project, stack, error: (err as Error).message }, 'Failed to provision stack infrastructure');
      throw err;
    }
  }

  private checkClaims(key: string, definition: InfrastructureService, owner: string, service: InfrastructureService): void {
    const occupied = service.getDesiredContainers();
    for (const candidate of definition.getDesiredContainers()) {
      for (const other of occupied) {
        const port = candidate.ports.find(p => other.ports.some(binding => hostPortsOverlap(p, binding)));
        const volume = candidate.volumes.find(v => other.volumes.some(m => m.source === v.source && (!v.readonly || !m.readonly)));
        const resource = candidate.name === other.name ? 'container ' + candidate.name :
          port ? 'host port ' + port.host : volume ? 'writable volume source ' + volume.source : undefined;
        if (resource) throw Error(`Cannot provision ${key}: ${resource} is reserved by ${owner} (${other.name})`);
      }
    }
  }

  /** Resolve the current declaration without provisioning or changing containers. */
  @RecoveryMutation()
  async refreshOwnership(
    project: string, stack: string, stackConfig: IStackConfig, baseInfraConfig: InfrastructureConfig,
    appDefinitions?: Map<string, import('../config/types.js').IAppDefinition>, projectRoot?: string,
  ): Promise<{ released: string[]; adopted: string[] }> {
    const key = `${project}/${stack}`;
    return this.mutateStack(key, () => this.refreshOwnershipScoped(project, stack, stackConfig, baseInfraConfig, appDefinitions, projectRoot));
  }

  private async refreshOwnershipScoped(
    project: string, stack: string, stackConfig: IStackConfig, baseInfraConfig: InfrastructureConfig,
    appDefinitions?: Map<string, import('../config/types.js').IAppDefinition>, projectRoot?: string,
  ): Promise<{ released: string[]; adopted: string[] }> {
    const key = `${project}/${stack}`;
    const existing = this.instances.get(key);
    const allocation = this.portAllocations.get(key);
    if (!ownsStackInfrastructure(stackConfig)) {
      const released = existing ? await existing.relinquishMonitoring() : [];
      this.instances.delete(key);
      this.portAllocations.delete(key);
      return { released, adopted: [] };
    }
    if (!existing || !allocation) throw new Error(`No active infrastructure ownership for ${key}`);
    return withInfrastructureScope(project, stack, async () => {
      const candidate = await this.resolveStackDefinition(project, stack, stackConfig, baseInfraConfig, allocation, appDefinitions, projectRoot, true);
      return existing.refreshOwnershipFrom(candidate);
    });
  }

  private async resolveStackDefinition(
    project: string, stack: string, stackConfig: IStackConfig, baseInfraConfig: InfrastructureConfig,
    portAlloc: StackPortAllocation,
    appDefinitions?: Map<string, import('../config/types.js').IAppDefinition>, projectRoot?: string,
    strict = true,
  ): Promise<InfrastructureService> {
    const key = `${project}/${stack}`;
    // 2. Build stack-specific infrastructure config with port overrides
    const stackInfraConfig = this.mergeInfraConfig(baseInfraConfig, stackConfig, portAlloc);

    // 3. Set container prefix and stack ownership labels for this stack's containers
    const containerPrefix = stackConfig.settings?.containerPrefix ?? `${project}-${stack}`;
    setContainerPrefix(project, stack);
    setStackLabels(project, stack);

    this.logger.info(
      {
        project,
        stack,
        containerPrefix,
        ports: {
          postgres: portAlloc.postgresPort,
          redis: portAlloc.redisPort,
          minio: portAlloc.minioPort,
        },
        redisDbRange: `${portAlloc.redisDbStart}-${portAlloc.redisDbEnd}`,
      },
      'Resolved stack infrastructure'
    );

    // 4. Normalize infrastructure config through preset system
    let normalizedServices: Record<string, import('./types.js').IServiceRequirement> | undefined;
    // Declared here rather than hoisted out of the try/catch with `var`:
    // both arms below assign it and the code after the block uses it, which
    // is exactly what a `let` in the enclosing scope says.
    let infraService: InfrastructureService;
    try {
      const { normalizeInfraConfig } = await import('./config-normalizer.js');
      const { createDefaultRegistry } = await import('./presets/index.js');
      const registry = createDefaultRegistry();
      normalizedServices = normalizeInfraConfig(stackInfraConfig, registry);

      // Gateway is resolved separately (needs special volume mounts + entrypoint).
      // Exclude from generic resolver to avoid creating a "bare" gateway container.
      const servicesForResolver = { ...normalizedServices };
      if (usesGatewayTemplate(normalizedServices['gateway'])) delete servicesForResolver['gateway'];

      this.logger.info(
        { services: Object.keys(normalizedServices), resolved: Object.keys(servicesForResolver) },
        'Normalized infrastructure services via presets'
      );

      // 4a. Create InfrastructureService with normalized services + preset registry
      infraService = new InfrastructureService(
        this.logger.child({ stack: key }),
        stackInfraConfig,
        servicesForResolver,
        registry,
        undefined,
        false // An application stack never owns the host control-plane database.
      );
    } catch (err) {
      if (strict) throw err;
      this.logger.warn({ error: (err as Error).message }, 'Preset normalization failed — only application declarations will be resolved');
      infraService = new InfrastructureService(
        this.logger.child({ stack: key }),
        stackInfraConfig,
        {},
        undefined,
        undefined,
        false
      );
    }

    // 5. Add app-declared infrastructure services (bitcoin, monero, etc.)
    if (appDefinitions) {
      const { resolveAppInfrastructure } = await import('./service-resolver.js');
      for (const [appName, definition] of appDefinitions) {
        const infraReqs = definition.omnitronConfig?.infrastructure;
        if (!infraReqs) continue;

        const appContainers = resolveAppInfrastructure(infraReqs, stackConfig.serviceOverrides, appName);

        if (appContainers.length > 0) {
          infraService.addAppContainers(appContainers);
          this.logger.info(
            { app: appName, services: appContainers.map((c) => c.name) },
            'Resolved app infrastructure services'
          );
        }
      }
    }

    // 6. Resolve API gateway if present in normalized services or legacy config
    const gatewayInServices = normalizedServices?.['gateway'];
    const legacyGateway = stackInfraConfig.gateway;
    if ((usesGatewayTemplate(gatewayInServices) || (!gatewayInServices && legacyGateway)) && projectRoot) {
      const { resolveGateway, gatewayConfigOf, containerEndpoint, REDIS_CONTAINER_PORT } =
        await import('./service-resolver.js');
      // The gateway's own database, by the one rule every side uses
      // (gateway-redis-db.ts). `redisDbEnd + 1` was 5 — geo's database, since
      // sample outgrew the five-wide range this was the end of.
      const gatewayRedisDb = gatewayRedisDbOf(
        (stackInfraConfig.redis as { databases?: Record<string, number> } | undefined)?.databases
      );
      const redisPassword =
        typeof stackInfraConfig.redis?.password === 'string' ? stackInfraConfig.redis.password : undefined;
      // Over the stack network, by container name. `host.docker.internal`
      // and the host-published port sent the gateway out to the host and
      // back, which a Linux node does not allow once the ports are bound to
      // loopback — see `containerEndpoint`.
      const endpoint = containerEndpoint('redis', REDIS_CONTAINER_PORT);
      const redisConfig: { host: string; port: number; db: number; password?: string } = {
        host: endpoint.host,
        port: endpoint.port,
        db: gatewayRedisDb,
      };
      if (redisPassword) redisConfig.password = redisPassword;

      const gwPort = gatewayHostPort(gatewayInServices, legacyGateway);
      // Every field of the stack's gateway block — its config dir, the
      // frontend it serves at `/`, its env and its volumes (`gatewayConfigOf`).
      const gatewayContainer = resolveGateway(
        gatewayConfigOf(gatewayInServices?._presetConfig, legacyGateway, gwPort, gatewayRedisDb),
        redisConfig,
        projectRoot
      );
      infraService.addAppContainers([gatewayContainer]);
      this.logger.info(
        { gateway: gatewayContainer.name, port: gwPort, redisDb: gatewayRedisDb },
        'Resolved API gateway'
      );
    }

    return infraService;
  }

  async inspectStopContainers(project: string, stack: string) {
    const owner = this.getInstance(project, stack);
    return owner ? inspectStackContainers({ project, stack }, owner.getTeardownNames()) : [];
  }

  @RecoveryMutation()
  async teardownStack(project: string, stack: string, reviewed: ReadonlyArray<{ id: string; name: string }>): Promise<void> {
    const key = `${project}/${stack}`;
    return this.mutateStack(key, () => this.teardownStackScoped(project, stack, reviewed));
  }

  private async teardownStackScoped(project: string, stack: string, reviewed: ReadonlyArray<{ id: string; name: string }>): Promise<void> {
    const key = `${project}/${stack}`;
    const infraService = this.instances.get(key);

    if (!infraService) {
      if (reviewed.length) throw new Error('Infrastructure owner disappeared after review; container removal is unconfirmed');
      this.logger.debug({ project, stack }, 'No infrastructure to teardown');
      return;
    }

    try {
      const names = await infraService.relinquishMonitoring();
      const inspect = () => inspectStackContainers({ project, stack }, names);
      const current = await inspect();
      const ids = new Set(reviewed.map(container => container.id));
      if (current.some(container => !ids.has(container.id))) throw new Error('Stack containers changed before removal; review the current allocation');
      const outcomes = await Promise.allSettled(current.map(container => removeContainer(container.id, { graceful: true })));
      const failures = outcomes.flatMap((result, index) => result.status === 'rejected' ? [`${current[index]!.name}: ${String(result.reason)}`] : []);
      if (failures.length) throw new Error(`Container stop incomplete: ${failures.join(', ')}`);
      if ((await inspect()).length) throw new Error('Stack containers are still present after removal');
    } catch (err) {
      this.logger.error({ project, stack, error: (err as Error).message }, 'Failed to teardown stack infrastructure');
      throw err;
    }

    this.instances.delete(key);
    this.portAllocations.delete(key);
  }

  /** Release local monitors; a supervisor restart must preserve the data plane. */
  dispose(): void {
    for (const infra of this.instances.values()) infra.dispose();
    this.instances.clear();
    this.portAllocations.clear();
  }

  /**
   * Explicitly remove all stack infrastructure.
   */
  @RecoveryMutation()
  async teardownAll(): Promise<void> {
    if (this.mutations.size || this.handoffFrozen) throw new RecoveryBusyError('Stack infrastructure ownership is changing');
    this.handoffFrozen = true;
    try { await this.teardownAllOwned(); }
    finally { this.handoffFrozen = false; }
  }

  private async teardownAllOwned(): Promise<void> {
    const entries = [...this.instances.entries()];
    const failures: unknown[] = [];
    for (const [key, infraService] of entries) {
      try {
        await infraService.teardown();
        this.instances.delete(key);
        this.portAllocations.delete(key);
      } catch (err) {
        this.logger.warn({ stack: key, error: (err as Error).message }, 'Failed to teardown');
        failures.push(err);
      }
    }
    if (failures.length) throw new AggregateError(failures, `Infrastructure stop incomplete: ${failures.map(String).join('; ')}`);
  }

  /**
   * Get the InfrastructureService for a stack.
   */
  getInstance(project: string, stack: string): InfrastructureService | null {
    return this.instances.get(`${project}/${stack}`) ?? null;
  }

  /** Every stack with infrastructure on this machine. */
  listInstances(): Array<{ project: string; stack: string; infra: InfrastructureService }> {
    return [...this.instances.entries()].map(([key, infra]) => {
      const slash = key.indexOf('/');
      return { project: key.slice(0, slash), stack: key.slice(slash + 1), infra };
    });
  }

  /**
   * Get the port allocation for a stack.
   */
  getPortAllocation(project: string, stack: string): StackPortAllocation | null {
    return this.portAllocations.get(`${project}/${stack}`) ?? null;
  }

  /**
   * Get connection info for a specific service in a stack.
   */
  getConnectionInfo(project: string, stack: string, service: string): Record<string, unknown> | null {
    const infraService = this.instances.get(`${project}/${stack}`);
    return infraService?.getConnectionInfo(service) ?? null;
  }

  /**
   * Get normalized services for a stack (from preset system).
   */
  getNormalizedServices(
    project: string,
    stack: string
  ): Record<string, import('./types.js').IServiceRequirement> | null {
    const infraService = this.instances.get(`${project}/${stack}`);
    return infraService?.getNormalizedServices() ?? null;
  }

  // ===========================================================================
  // Private — Port & DB Allocation
  // ===========================================================================

  private computePortAllocation(
    project: string,
    stack: string,
    settings: IStackSettings | undefined,
    baseConfig: InfrastructureConfig
  ): StackPortAllocation {
    const basePg = baseConfig.postgres?.port ?? 5432;
    const baseRedis = baseConfig.redis?.port ?? 6379;
    const baseMinio = baseConfig.minio?.ports?.api ?? 9000;

    // Use explicit offsets from settings, or auto-compute from stack name
    const offsets = settings?.portOffsets ?? DEFAULT_PORT_OFFSETS[stack];
    const hashOffset = offsets ? 0 : stackNameHash(stack) * 100;
    const pgOffset = offsets?.postgres ?? hashOffset;
    const redisOffset = offsets?.redis ?? hashOffset;
    const minioOffset = offsets?.minio ?? hashOffset;

    // Redis DB range
    const dbOffset = settings?.redisDbOffset ?? this.getRedisDbOffset(stack);

    const postgresPort = basePg + pgOffset;
    const redisPort = baseRedis + redisOffset;
    const minioPort = baseMinio + minioOffset;
    const minioConsolePort = (baseConfig.minio?.ports?.console ?? 9001) + minioOffset;

    // Generic service ports map
    const servicePorts: Record<string, Record<string, number>> = {
      postgres: { main: postgresPort },
      redis: { main: redisPort },
      minio: { api: minioPort, console: minioConsolePort },
    };

    return {
      servicePorts,
      postgresPort,
      redisPort,
      minioPort,
      minioConsolePort,
      redisDbStart: dbOffset,
      redisDbEnd: dbOffset + REDIS_DB_RANGE_SIZE - 1,
      containerPrefix: settings?.containerPrefix ?? `${project}-${stack}`,
    };
  }

  private getRedisDbOffset(stack: string): number {
    const knownOffsets: Record<string, number> = {
      dev: 0,
      test: REDIS_DB_RANGE_SIZE,
      staging: REDIS_DB_RANGE_SIZE * 2,
      prod: REDIS_DB_RANGE_SIZE * 3,
    };
    return knownOffsets[stack] ?? stackNameHash(stack) * REDIS_DB_RANGE_SIZE;
  }

  /**
   * Merge base infrastructure config with stack overrides and port allocation.
   */
  private mergeInfraConfig(
    base: InfrastructureConfig,
    stackConfig: IStackConfig,
    portAlloc: StackPortAllocation
  ): InfrastructureConfig {
    const override = stackConfig.infrastructure ?? {};

    const merged: InfrastructureConfig = { ...base };

    // PostgreSQL
    if (merged.postgres) {
      merged.postgres = {
        ...merged.postgres,
        ...override.postgres,
        port: portAlloc.postgresPort,
      };
    }

    // Redis
    if (merged.redis) {
      merged.redis = {
        ...merged.redis,
        ...override.redis,
        port: portAlloc.redisPort,
      };
    }

    // MinIO
    if (merged.minio) {
      merged.minio = {
        ...merged.minio,
        ...override.minio,
        ports: {
          api: portAlloc.minioPort,
          console: portAlloc.minioConsolePort,
        },
      };
    }

    // Custom containers
    if (override.containers) {
      merged.containers = { ...merged.containers, ...override.containers };
    }

    return merged;
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Deterministic hash of a stack name → small positive integer (4-15 range).
 * Ensures the same stack name always gets the same port offset, even across restarts.
 */
function stackNameHash(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  // Map to range 4-15 (avoid 0-3 which are reserved for dev/test/staging/prod)
  return 4 + (Math.abs(hash) % 12);
}

export interface StackPortAllocation {
  /** Generic per-service port map: serviceName → { portName → hostPort } */
  servicePorts: Record<string, Record<string, number>>;
  /** Legacy accessors (will be removed when config-resolver is genericized) */
  postgresPort: number;
  redisPort: number;
  minioPort: number;
  minioConsolePort: number;
  redisDbStart: number;
  redisDbEnd: number;
  containerPrefix: string;
}
