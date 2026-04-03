/**
 * StackInfrastructureManager — Per-stack infrastructure isolation
 *
 * Each stack gets its own InfrastructureService instance with namespaced
 * Docker containers, ports, and Redis DB ranges. This ensures stacks
 * (dev, test, prod) can run simultaneously without conflicts.
 *
 * Container naming: omnitron-{project}-{stack}-{service}
 *   e.g., omnitron-daos-dev-postgres, omnitron-daos-test-redis
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
import { setContainerPrefix, setStackLabels } from './service-resolver.js';

// =============================================================================
// Default port offsets per stack index
// =============================================================================

const DEFAULT_PORT_OFFSETS: Record<string, { postgres: number; redis: number; minio: number }> = {
  dev:     { postgres: 0,   redis: 0,   minio: 0 },
  test:    { postgres: 100, redis: 100, minio: 100 },
  staging: { postgres: 200, redis: 200, minio: 200 },
  prod:    { postgres: 300, redis: 300, minio: 300 },
};

const REDIS_DB_RANGE_SIZE = 5;

// =============================================================================
// Manager
// =============================================================================

export class StackInfrastructureManager {
  /** Active infrastructure services keyed by `${project}/${stack}` */
  private readonly instances = new Map<string, InfrastructureService>();

  /** Port allocations keyed by `${project}/${stack}` */
  private readonly portAllocations = new Map<string, StackPortAllocation>();

  /** Deterministic hash of stack name → offset index for unknown stack names */

  constructor(private readonly logger: ILogger) {}

  /**
   * Create and provision infrastructure for a stack.
   * Returns the InfrastructureService instance (already provisioned).
   */
  async provisionStack(
    project: string,
    stack: string,
    stackConfig: IStackConfig,
    baseInfraConfig: InfrastructureConfig,
    appDefinitions?: Map<string, import('../config/types.js').IAppDefinition>,
    projectRoot?: string,
  ): Promise<InfrastructureService> {
    const key = `${project}/${stack}`;

    if (this.instances.has(key)) {
      this.logger.warn({ project, stack }, 'Stack infrastructure already provisioned');
      return this.instances.get(key)!;
    }

    // 1. Compute port allocation for this stack
    const portAlloc = this.computePortAllocation(project, stack, stackConfig.settings, baseInfraConfig);
    this.portAllocations.set(key, portAlloc);

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
      'Provisioning stack infrastructure'
    );

    // 4. Normalize infrastructure config through preset system
    let normalizedServices: Record<string, import('./types.js').IServiceRequirement> | undefined;
    try {
      const { normalizeInfraConfig } = await import('./config-normalizer.js');
      const { createDefaultRegistry } = await import('./presets/index.js');
      const registry = createDefaultRegistry();
      normalizedServices = normalizeInfraConfig(stackInfraConfig, registry);

      // Gateway is resolved separately (needs special volume mounts + entrypoint).
      // Exclude from generic resolver to avoid creating a "bare" gateway container.
      const servicesForResolver = { ...normalizedServices };
      delete servicesForResolver['gateway'];

      this.logger.info(
        { services: Object.keys(normalizedServices), resolved: Object.keys(servicesForResolver) },
        'Normalized infrastructure services via presets'
      );

      // 4a. Create InfrastructureService with normalized services + preset registry
      var infraService = new InfrastructureService(
        this.logger.child({ stack: key }),
        stackInfraConfig,
        servicesForResolver,
        registry,
      );
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Preset normalization failed — using legacy resolvers');
      var infraService = new InfrastructureService(
        this.logger.child({ stack: key }),
        stackInfraConfig
      );
    }

    // 5. Add app-declared infrastructure services (bitcoin, monero, etc.)
    if (appDefinitions) {
      const { resolveAppInfrastructure } = await import('./service-resolver.js');
      for (const [appName, definition] of appDefinitions) {
        const infraReqs = definition.omnitronConfig?.infrastructure;
        if (!infraReqs) continue;

        const appContainers = resolveAppInfrastructure(
          infraReqs,
          stackConfig.serviceOverrides,
          appName,
        );

        if (appContainers.length > 0) {
          infraService.addAppContainers(appContainers);
          this.logger.info(
            { app: appName, services: appContainers.map(c => c.name) },
            'Resolved app infrastructure services'
          );
        }
      }
    }

    // 6. Resolve API gateway if present in normalized services or legacy config
    const gatewayInServices = normalizedServices?.['gateway'];
    const legacyGateway = stackInfraConfig.gateway;
    if ((gatewayInServices || legacyGateway) && projectRoot) {
      const { resolveGateway } = await import('./service-resolver.js');
      const gatewayRedisDb = portAlloc.redisDbEnd + 1;
      const redisPassword = typeof stackInfraConfig.redis?.password === 'string'
        ? stackInfraConfig.redis.password
        : undefined;
      const redisConfig: { host: string; port: number; db: number; password?: string } = {
        host: 'host.docker.internal',
        port: portAlloc.redisPort,
        db: gatewayRedisDb,
      };
      if (redisPassword) redisConfig.password = redisPassword;

      // Read config from preset-expanded service or legacy field
      const gwPort = gatewayInServices?.ports['http'] ?? legacyGateway?.port ?? 8080;
      const gwConfigDir = (gatewayInServices?._presetConfig?.['configDir'] as string)
        ?? legacyGateway?.configDir
        ?? 'infra/nginx';

      const gatewayContainer = resolveGateway(
        { port: gwPort, configDir: gwConfigDir, redisDb: gatewayRedisDb },
        redisConfig,
        projectRoot,
      );
      infraService.addAppContainers([gatewayContainer]);
      this.logger.info(
        { gateway: gatewayContainer.name, port: gwPort, redisDb: gatewayRedisDb },
        'Resolved API gateway'
      );
    }

    // Register BEFORE provision so the UI can query intermediate state
    // during the provisioning process (which may take 30+ seconds).
    this.instances.set(key, infraService);

    try {
      await infraService.provision();
      return infraService;
    } catch (err) {
      // Remove on failure — the infrastructure is not usable
      this.instances.delete(key);
      this.logger.error(
        { project, stack, error: (err as Error).message },
        'Failed to provision stack infrastructure'
      );
      throw err;
    }
  }

  /**
   * Teardown infrastructure for a stack.
   */
  async teardownStack(project: string, stack: string): Promise<void> {
    const key = `${project}/${stack}`;
    const infraService = this.instances.get(key);

    if (!infraService) {
      this.logger.debug({ project, stack }, 'No infrastructure to teardown');
      return;
    }

    try {
      await infraService.teardown();
    } catch (err) {
      this.logger.error(
        { project, stack, error: (err as Error).message },
        'Failed to teardown stack infrastructure'
      );
    }

    this.instances.delete(key);
    this.portAllocations.delete(key);
  }

  /**
   * Teardown all stack infrastructure (daemon shutdown).
   */
  async teardownAll(): Promise<void> {
    const entries = [...this.instances.entries()];
    for (const [key, infraService] of entries) {
      try {
        await infraService.teardown();
      } catch (err) {
        this.logger.warn({ stack: key, error: (err as Error).message }, 'Failed to teardown');
      }
    }
    this.instances.clear();
    this.portAllocations.clear();
  }

  /**
   * Get the InfrastructureService for a stack.
   */
  getInstance(project: string, stack: string): InfrastructureService | null {
    return this.instances.get(`${project}/${stack}`) ?? null;
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
  getNormalizedServices(project: string, stack: string): Record<string, import('./types.js').IServiceRequirement> | null {
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
    baseConfig: InfrastructureConfig,
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
    portAlloc: StackPortAllocation,
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
