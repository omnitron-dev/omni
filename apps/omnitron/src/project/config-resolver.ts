/**
 * Config Resolver — Generates per-app config from requirements + environment
 *
 * Pipeline:
 *   1. Read app's `requires` from bootstrap.ts
 *   2. Read active environment config from omnitron.config.ts
 *   3. Resolve infrastructure addresses (local Docker vs remote vs cluster)
 *   4. Allocate Redis DB indexes (avoid conflicts)
 *   5. Generate IResolvedAppConfig per app
 *   6. Inject into app via environment variables
 *
 * This replaces:
 *   - apps/main/config/default.json
 *   - apps/messaging/config/default.json
 *   - infra/.env.dev
 *   - Hardcoded localhost:5432 in every app
 */

import type {
  IEcosystemConfig,
  IEcosystemAppEntry,
  IAppDefinition,
  IResolvedAppConfig,
  IStackConfig,
  StackName,
  OmnitronAppConfig,
} from '../config/types.js';
import type { IServiceRequirement, IResolvedServiceAddress } from '../infrastructure/types.js';
import type { StackPortAllocation } from '../infrastructure/stack-infra-manager.js';

// =============================================================================
// Types
// =============================================================================

export interface InfrastructureAddresses {
  postgres: { host: string; port: number; user: string; password: string };
  redis: { host: string; port: number; password?: string | undefined };
  s3?: { endpoint: string; accessKey: string; secretKey: string } | undefined;
  gateway?: { host: string; port: number } | undefined;
}

/**
 * Generic service addresses resolved from normalized services + port allocation.
 * Each key is a service name, value has host + per-port addresses + resolved secrets.
 */
export interface GenericServiceAddresses {
  [serviceName: string]: IResolvedServiceAddress;
}

/**
 * Resolve addresses for all normalized services.
 * Uses StackPortAllocation.servicePorts for port allocation.
 * For local stacks: host = localhost, ports from allocation.
 * For remote/cluster: host from stack nodes.
 */
export function resolveGenericServiceAddresses(
  normalizedServices: Record<string, IServiceRequirement>,
  stackConfig: IStackConfig,
  portAllocation?: StackPortAllocation,
): GenericServiceAddresses {
  const addresses: GenericServiceAddresses = {};
  const host = stackConfig.type === 'local'
    ? 'localhost'
    : stackConfig.nodes?.[0]?.host ?? 'localhost';

  for (const [name, svc] of Object.entries(normalizedServices)) {
    // Resolve ports: use stack port allocation if available, else service defaults
    const allocatedPorts = portAllocation?.servicePorts[name];
    const resolvedPorts: Record<string, number> = {};
    for (const [portName, defaultPort] of Object.entries(svc.ports)) {
      resolvedPorts[portName] = allocatedPorts?.[portName] ?? defaultPort;
    }

    // Resolve secrets
    const secrets: Record<string, string> = {};
    if (svc.secrets) {
      for (const [k, v] of Object.entries(svc.secrets)) {
        secrets[k] = typeof v === 'string' ? v : '';
      }
    }

    addresses[name] = { host, ports: resolvedPorts, secrets };
  }

  return addresses;
}

// =============================================================================
// Resolver
// =============================================================================

/**
 * Convert resolved config to standardized URL-based environment variables.
 * Produces DATABASE_URL, REDIS_URL, S3_*, JWT_SECRET — no app-specific prefix.
 */
export function resolvedConfigToEnv(
  config: IResolvedAppConfig,
  appName: string,
  stackName: string
): Record<string, string> {
  const env: Record<string, string> = {};

  env['APP_NAME'] = appName;
  env['STACK_NAME'] = stackName;

  if (config.database) {
    const db = config.database;
    const password = db.password ? `:${db.password}` : '';
    env['DATABASE_URL'] = `${db.dialect ?? 'postgres'}://${db.user}${password}@${db.host}:${db.port}/${db.database}`;
  }

  if (config.redis) {
    const r = config.redis;
    const password = r.password ? `:${r.password}@` : '';
    env['REDIS_URL'] = `redis://${password}${r.host}:${r.port}/${r.db}`;
  }

  if (config.s3) {
    // Generic S3 vars (used by S3Adapter fallback)
    env['S3_ENDPOINT'] = config.s3.endpoint;
    env['S3_ACCESS_KEY'] = config.s3.accessKey;
    env['S3_SECRET_KEY'] = config.s3.secretKey;
    env['S3_BUCKET'] = config.s3.bucket;

    // App-prefixed S3 vars for ConfigModule (STORAGE_ prefix, __ separator, camelCase)
    // This ensures storage.s3.* config is available even when config/default.json is not loadable.
    const prefix = appName.toUpperCase();
    env[`${prefix}_STORAGE__BACKEND`] = 's3';
    env[`${prefix}_STORAGE__S3__ENDPOINT`] = config.s3.endpoint;
    env[`${prefix}_STORAGE__S3__ACCESS_KEY_ID`] = config.s3.accessKey;
    env[`${prefix}_STORAGE__S3__SECRET_ACCESS_KEY`] = config.s3.secretKey;
    env[`${prefix}_STORAGE__S3__BUCKET`] = config.s3.bucket;
    env[`${prefix}_STORAGE__S3__FORCE_PATH_STYLE`] = 'true';
  }

  if (config.auth?.jwtSecret) {
    env['JWT_SECRET'] = config.auth.jwtSecret;
  }

  // Titan service module Redis URLs
  if (config['discoveryRedis']) {
    const dr = config['discoveryRedis'] as { host: string; port: number; db: number; password?: string };
    const password = dr.password ? `:${dr.password}@` : '';
    env['DISCOVERY_REDIS_URL'] = `redis://${password}${dr.host}:${dr.port}/${dr.db}`;
  }

  if (config['notificationsRedis']) {
    const nr = config['notificationsRedis'] as { host: string; port: number; db: number; password?: string };
    const password = nr.password ? `:${nr.password}@` : '';
    env['NOTIFICATIONS_REDIS_URL'] = `redis://${password}${nr.host}:${nr.port}/${nr.db}`;
  }

  if (config['priceverseRedis']) {
    const pr = config['priceverseRedis'] as { host: string; port: number; db: number; password?: string };
    const password = pr.password ? `:${pr.password}@` : '';
    env['PRICEVERSE_REDIS_URL'] = `redis://${password}${pr.host}:${pr.port}/${pr.db}`;
  }

  // Gateway Redis — main app writes maintenance state to gateway's dedicated Redis DB
  if (config['gatewayRedis']) {
    const gr = config['gatewayRedis'] as { host: string; port: number; db: number; password?: string };
    const password = gr.password ? `:${gr.password}@` : '';
    env['GATEWAY_REDIS_URL'] = `redis://${password}${gr.host}:${gr.port}/${gr.db}`;
  }

  // Custom infrastructure service env vars (resolved from templates)
  if (config['_customEnv']) {
    Object.assign(env, config['_customEnv'] as Record<string, string>);
  }

  return env;
}

// =============================================================================
// Secret Resolution
// =============================================================================

function resolveServiceSecrets(
  secrets: Record<string, string | import('../infrastructure/types.js').SecretRef>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value === 'string') {
      resolved[key] = value;
    } else {
      // SecretRef — resolved asynchronously via resolveServiceSecretsAsync.
      // In synchronous context, use placeholder (will be resolved later by resolveSecretRefs).
      resolved[key] = `<secret:${value.secret}>`;
    }
  }
  return resolved;
}

/**
 * Resolve service secrets asynchronously using the SecretsService.
 * Resolves `{ secret: 'key' }` references to actual values from the encrypted store.
 */
export async function resolveServiceSecretsAsync(
  secrets: Record<string, string | import('../infrastructure/types.js').SecretRef>,
  getSecret: (key: string) => Promise<string | null>,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value === 'string') {
      resolved[key] = value;
    } else {
      const secretValue = await getSecret(value.secret);
      resolved[key] = secretValue ?? '';
    }
  }
  return resolved;
}

// =============================================================================
// Custom Service Env Resolution
// =============================================================================

/**
 * Resolve custom service addresses into environment variables.
 * Uses ${...} templates from IServiceRequirement.env.
 *
 * Templates:
 *   ${host}          — resolved hostname/IP
 *   ${port:name}     — resolved port for named port
 *   ${secret:name}   — resolved secret value
 */
export function resolveCustomServiceEnv(
  requirement: IServiceRequirement,
  address: IResolvedServiceAddress,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, template] of Object.entries(requirement.env)) {
    let value = template;

    value = value.replace(/\$\{host\}/g, address.host);

    value = value.replace(/\$\{port:(\w[\w-]*)\}/g, (_match, portName: string) =>
      String(address.ports[portName] ?? requirement.ports[portName] ?? '')
    );

    value = value.replace(/\$\{secret:(\w[\w-]*)\}/g, (_match, secretName: string) =>
      address.secrets?.[secretName] ?? ''
    );

    env[key] = value;
  }

  return env;
}

// =============================================================================
// Stack Resolution — Per-stack config with namespaced infrastructure
// =============================================================================

/**
 * Resolve all app configs for a stack deployment.
 *
 * Unlike `resolveEnvironment` which resolves a flat environment, this function
 * resolves for a specific stack within a project, applying:
 * - Stack-specific infrastructure overrides
 * - Namespaced port allocation (no conflicts between stacks)
 * - Redis DB range isolation per stack
 * - Stack-level environment variable injection
 *
 * @param config - Ecosystem config from omnitron.config.ts
 * @param project - Project name (for namespacing)
 * @param stackName - Target stack name
 * @param stackConfig - Stack configuration
 * @param appDefinitions - Bootstrap definitions with `requires` fields
 * @param portAllocation - Port allocation for this stack (from StackInfrastructureManager)
 * @param jwtSecret - Shared JWT secret
 */
export function resolveStack(
  config: IEcosystemConfig,
  project: string,
  stackName: StackName,
  stackConfig: IStackConfig,
  appDefinitions: Map<string, IAppDefinition>,
  portAllocation?: StackPortAllocation,
  jwtSecret?: string,
  normalizedServices?: Record<string, IServiceRequirement>,
): ResolvedStack {
  // Determine which apps run in this stack
  const enabledApps = stackConfig.apps === 'all' || !stackConfig.apps
    ? config.apps.filter((a) => a.enabled !== false)
    : config.apps.filter((a) => a.enabled !== false && (stackConfig.apps as string[]).includes(a.name));

  // Resolve infrastructure addresses based on stack type
  const addresses = resolveStackAddresses(config, stackConfig, portAllocation);

  // Generic service addresses (from preset-normalized services)
  const genericAddresses = normalizedServices
    ? resolveGenericServiceAddresses(normalizedServices, stackConfig, portAllocation)
    : undefined;

  // Build OmnitronAppConfig map from definitions (new path) or fall back to requires (legacy)
  const omnitronConfigs = new Map<string, OmnitronAppConfig>();
  let useNewPath = false;

  for (const entry of enabledApps) {
    const definition = appDefinitions.get(entry.name);
    if (definition?.omnitronConfig) {
      omnitronConfigs.set(entry.name, definition.omnitronConfig);
      useNewPath = true;
    }
  }

  // Allocate Redis DBs with stack offset
  const redisDbOffset = stackConfig.settings?.redisDbOffset ?? portAllocation?.redisDbStart ?? 0;
  const redisAllocation = useNewPath
    ? allocateRedisDBs(enabledApps.map((a) => a.name), omnitronConfigs, redisDbOffset)
    : allocateRedisDBsLegacy(enabledApps, appDefinitions, redisDbOffset);

  // Generate per-app resolved config
  const appConfigs = new Map<string, IResolvedAppConfig>();
  const sharedJwtSecret = jwtSecret ?? 'dev-omnitron-secret-key-minimum-32-chars-long!!';

  for (const entry of enabledApps) {
    const definition = appDefinitions.get(entry.name);
    const omnitronCfg = omnitronConfigs.get(entry.name);

    // New path: resolve from OmnitronAppConfig
    if (omnitronCfg) {
      const resolved: IResolvedAppConfig = {};

      // Database — use generic address if available
      if (omnitronCfg.database) {
        const dbCfg = typeof omnitronCfg.database === 'object' ? omnitronCfg.database : {};
        const dialect = dbCfg.dialect ?? 'postgres';
        const pool = dbCfg.pool ? { min: dbCfg.pool.min ?? 2, max: dbCfg.pool.max ?? 10 } : undefined;
        const dbAddr = genericAddresses?.['postgres'];

        resolved.database = {
          dialect,
          host: dbAddr?.host ?? addresses.postgres.host,
          port: dbAddr?.ports['main'] ?? addresses.postgres.port,
          database: entry.name,
          user: dbAddr?.secrets?.['user'] ?? addresses.postgres.user,
          password: dbAddr?.secrets?.['password'] ?? addresses.postgres.password,
          pool,
          ssl: stackName === 'prod',
        };
      }

      // Redis — use generic address if available
      if (omnitronCfg.redis) {
        const redisCfg = typeof omnitronCfg.redis === 'object' ? omnitronCfg.redis : {};
        const allocatedDb = redisAllocation.get(entry.name) ?? redisDbOffset;
        const redisAddr = genericAddresses?.['redis'];

        resolved.redis = {
          host: redisAddr?.host ?? addresses.redis.host,
          port: redisAddr?.ports['main'] ?? addresses.redis.port,
          db: allocatedDb,
          password: redisAddr?.secrets?.['password'] ?? addresses.redis.password,
          prefix: redisCfg.prefix,
        };
      }

      // S3/Storage — use generic address if available
      if (omnitronCfg.s3) {
        const s3Cfg = typeof omnitronCfg.s3 === 'object' ? omnitronCfg.s3 : {};
        const storageAddr = genericAddresses?.['minio'];
        const s3Port = storageAddr?.ports['api'] ?? 9000;
        const s3Host = storageAddr?.host ?? 'localhost';

        resolved.s3 = {
          endpoint: addresses.s3?.endpoint ?? `http://${s3Host}:${s3Port}`,
          accessKey: storageAddr?.secrets?.['accessKey'] ?? addresses.s3?.accessKey ?? 'minioadmin',
          secretKey: storageAddr?.secrets?.['secretKey'] ?? addresses.s3?.secretKey ?? 'minioadmin',
          bucket: s3Cfg.bucket ?? entry.name,
          forcePathStyle: true,
        };
      }

      // Auth — always inject shared JWT secret
      resolved.auth = {
        jwtSecret: sharedJwtSecret,
        algorithm: 'HS256',
      };

      // Titan service module Redis — discovery
      if (omnitronCfg.services?.discovery) {
        const discoveryDb = redisAllocation.get(`${entry.name}:discovery`) ?? redisDbOffset;
        resolved['discoveryRedis'] = {
          host: addresses.redis.host,
          port: addresses.redis.port,
          db: discoveryDb,
          password: addresses.redis.password,
        };
      }

      // Titan service module Redis — notifications
      if (omnitronCfg.services?.notifications) {
        const notificationsDb = redisAllocation.get(`${entry.name}:notifications`) ?? redisDbOffset;
        resolved['notificationsRedis'] = {
          host: addresses.redis.host,
          port: addresses.redis.port,
          db: notificationsDb,
          password: addresses.redis.password,
        };
      }

      // Cross-app Redis — priceverse price data (read-through from paysys/swap)
      if (omnitronCfg.services?.priceverse) {
        // Priceverse app's Redis DB — look up from allocation or use known offset
        const priceverseDb = redisAllocation.get('priceverse') ?? (redisDbOffset + 2);
        resolved['priceverseRedis'] = {
          host: addresses.redis.host,
          port: addresses.redis.port,
          db: priceverseDb,
          password: addresses.redis.password,
        };
      }

      // Gateway Redis — main app writes maintenance state to gateway's dedicated Redis DB
      // DB index is auto-allocated by omnitron (redisDbEnd + 1, after app range)
      const hasGateway = config.gateway || config.infrastructure?.services?.['gateway'] || normalizedServices?.['gateway'];
      if (entry.name === 'main' && hasGateway) {
        const gatewayRedisDb = redisDbOffset + 5; // After app DBs (0-4 range)
        resolved['gatewayRedis'] = {
          host: addresses.redis.host,
          port: addresses.redis.port,
          db: gatewayRedisDb,
          password: addresses.redis.password,
        };
      }

      // Custom infrastructure services — resolve env vars from templates
      if (omnitronCfg.infrastructure) {
        for (const [serviceName, requirement] of Object.entries(omnitronCfg.infrastructure)) {
          // Check for stack-level override (app-specific or global)
          const override = stackConfig.serviceOverrides?.[`${entry.name}/${serviceName}`]
            ?? stackConfig.serviceOverrides?.[serviceName];

          if (override?.disabled) continue;

          let address: IResolvedServiceAddress;

          if (override?.external) {
            // External service — use provided address directly
            address = {
              host: override.external.host,
              ports: override.external.ports,
              secrets: resolveServiceSecrets(override.external.secrets ?? requirement.secrets ?? {}),
            };
          } else {
            // Docker-provisioned — localhost with mapped ports
            const docker = requirement.docker;
            const hostPorts: Record<string, number> = {};
            for (const [portName, containerPort] of Object.entries(requirement.ports)) {
              hostPorts[portName] = docker?.portMappings?.[portName] ?? containerPort;
            }
            address = {
              host: 'localhost',
              ports: hostPorts,
              secrets: resolveServiceSecrets(requirement.secrets ?? {}),
            };
          }

          // Generate env vars from templates and merge into resolved config
          const serviceEnv = resolveCustomServiceEnv(requirement, address);
          if (!resolved['_customEnv']) resolved['_customEnv'] = {};
          Object.assign(resolved['_customEnv'] as Record<string, string>, serviceEnv);
        }
      }

      appConfigs.set(entry.name, resolved);
      continue;
    }

    // Legacy path: resolve from requires (backward compatibility)
    const requires = definition?.requires;
    const resolved: IResolvedAppConfig = {};

    if (requires?.postgres) {
      resolved.database = {
        dialect: 'postgres',
        host: addresses.postgres.host,
        port: addresses.postgres.port,
        database: requires.postgres.database,
        user: addresses.postgres.user,
        password: addresses.postgres.password,
        pool: requires.postgres.pool ? {
          min: requires.postgres.pool.min ?? 2,
          max: requires.postgres.pool.max ?? 10,
        } : undefined,
        ssl: stackName === 'prod',
      };
    }

    if (requires?.redis) {
      const allocatedDb = redisAllocation.get(entry.name) ?? requires.redis.db ?? redisDbOffset;
      resolved.redis = {
        host: addresses.redis.host,
        port: addresses.redis.port,
        db: allocatedDb,
        password: addresses.redis.password,
        prefix: requires.redis.prefix,
      };
    }

    if (requires?.s3 && addresses.s3) {
      resolved.s3 = {
        endpoint: addresses.s3.endpoint,
        accessKey: addresses.s3.accessKey,
        secretKey: addresses.s3.secretKey,
        bucket: requires.s3.buckets?.[0] ?? 'storage',
        forcePathStyle: true,
      };
    }

    if (definition?.auth?.jwt?.enabled) {
      resolved.auth = {
        jwtSecret: sharedJwtSecret,
        algorithm: 'HS256',
      };
    }

    appConfigs.set(entry.name, resolved);
  }

  return {
    project,
    stack: stackName,
    type: stackConfig.type,
    appConfigs,
    infrastructureAddresses: addresses,
    enabledApps,
    redisAllocation,
  };
}

export interface ResolvedStack {
  project: string;
  stack: StackName;
  type: 'local' | 'remote' | 'cluster';
  appConfigs: Map<string, IResolvedAppConfig>;
  infrastructureAddresses: InfrastructureAddresses;
  enabledApps: IEcosystemAppEntry[];
  redisAllocation: Map<string, number>;
}

/**
 * Resolve infrastructure addresses for a stack deployment.
 */
function resolveStackAddresses(
  config: IEcosystemConfig,
  stackConfig: IStackConfig,
  portAllocation?: StackPortAllocation,
): InfrastructureAddresses {
  const infra = config.infrastructure;

  if (stackConfig.type === 'local') {
    // Local stack: all services on localhost with port allocation (or defaults).
    // S3/MinIO is always assumed available for local stacks (omnitron auto-provisions
    // infrastructure from app requirements when not explicitly configured).
    const minioPort = portAllocation?.minioPort ?? infra?.minio?.ports?.api ?? 9000;
    return {
      postgres: {
        host: 'localhost',
        port: portAllocation?.postgresPort ?? infra?.postgres?.port ?? 5432,
        user: infra?.postgres?.user ?? 'postgres',
        password: typeof infra?.postgres?.password === 'string' ? infra.postgres.password : 'postgres',
      },
      redis: {
        host: 'localhost',
        port: portAllocation?.redisPort ?? infra?.redis?.port ?? 6379,
        password: typeof infra?.redis?.password === 'string' ? infra.redis.password : undefined,
      },
      s3: {
        endpoint: `http://localhost:${minioPort}`,
        accessKey: infra?.minio?.accessKey ?? 'minioadmin',
        secretKey: typeof infra?.minio?.secretKey === 'string' ? infra.minio.secretKey : 'minioadmin',
      },
    };
  }

  if (stackConfig.type === 'remote' && stackConfig.nodes?.length) {
    const node = stackConfig.nodes[0]!;
    return {
      postgres: { host: node.host, port: 5432, user: 'postgres', password: 'postgres' },
      redis: { host: node.host, port: 6379 },
      s3: { endpoint: `http://${node.host}:9000`, accessKey: 'minioadmin', secretKey: 'minioadmin' },
    };
  }

  if (stackConfig.type === 'cluster' && stackConfig.nodes?.length) {
    const dbNode = stackConfig.nodes.find((n) => n.role === 'database');
    const cacheNode = stackConfig.nodes.find((n) => n.role === 'cache');
    const gwNode = stackConfig.nodes.find((n) => n.role === 'gateway');

    return {
      postgres: {
        host: dbNode?.host ?? 'localhost',
        port: dbNode?.port ?? 5432,
        user: 'postgres',
        password: 'postgres',
      },
      redis: {
        host: cacheNode?.host ?? 'localhost',
        port: cacheNode?.port ?? 6379,
      },
      gateway: gwNode ? { host: gwNode.host, port: gwNode.port ?? 8080 } : undefined,
    };
  }

  // Fallback: localhost
  return {
    postgres: { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres' },
    redis: { host: 'localhost', port: 6379 },
  };
}

/**
 * Allocate Redis DB indexes sequentially from a stack-specific offset.
 * Handles both app-level Redis and Titan service module Redis (discovery, notifications).
 */
function allocateRedisDBs(
  apps: string[],
  omnitronConfigs: Map<string, OmnitronAppConfig>,
  offset: number,
): Map<string, number> {
  const allocation = new Map<string, number>();
  let nextDb = offset;

  // App Redis DBs
  for (const appName of apps) {
    const config = omnitronConfigs.get(appName);
    if (config?.redis) {
      allocation.set(appName, nextDb++);
    }
  }

  // Titan service module Redis DBs
  for (const appName of apps) {
    const config = omnitronConfigs.get(appName);
    if (config?.services?.discovery) {
      allocation.set(`${appName}:discovery`, nextDb++);
    }
    if (config?.services?.notifications) {
      allocation.set(`${appName}:notifications`, nextDb++);
    }
  }

  return allocation;
}

/**
 * Legacy Redis DB allocation — respects explicit DB preferences from requires.
 * @deprecated Use allocateRedisDBs with OmnitronAppConfig instead.
 */
function allocateRedisDBsLegacy(
  apps: IEcosystemAppEntry[],
  definitions: Map<string, IAppDefinition>,
  offset: number,
): Map<string, number> {
  const allocation = new Map<string, number>();
  const usedDbs = new Set<number>();

  // First pass: respect explicit preferences (shifted by offset)
  for (const app of apps) {
    const def = definitions.get(app.name);
    const preferredDb = def?.requires?.redis?.db;
    if (preferredDb !== undefined) {
      const shiftedDb = preferredDb + offset;
      allocation.set(app.name, shiftedDb);
      usedDbs.add(shiftedDb);
    }
  }

  // Second pass: allocate remaining within offset range
  let nextDb = offset;
  for (const app of apps) {
    if (allocation.has(app.name)) continue;
    const def = definitions.get(app.name);
    if (!def?.requires?.redis) continue;

    while (usedDbs.has(nextDb)) nextDb++;
    allocation.set(app.name, nextDb);
    usedDbs.add(nextDb);
    nextDb++;
  }

  return allocation;
}

// =============================================================================
// Secret Resolution (Phase 5)
// =============================================================================

/**
 * Walk the config tree and resolve `{ secret: 'key' }` references
 * using the SecretsService. Returns a new config with secrets inlined.
 */
export async function resolveSecretRefs(
  config: Record<string, unknown>,
  getSecret: (key: string) => Promise<string | null>
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ('secret' in obj && typeof obj['secret'] === 'string') {
        // Resolve secret reference: { secret: 'key' } → actual value
        const secretValue = await getSecret(obj['secret'] as string);
        result[key] = secretValue ?? obj['default'] ?? '';
      } else {
        // Recurse into nested objects
        result[key] = await resolveSecretRefs(obj, getSecret);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

