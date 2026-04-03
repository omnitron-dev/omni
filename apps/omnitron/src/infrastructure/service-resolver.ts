/**
 * Service Resolver — Converts high-level InfrastructureConfig into
 * low-level ResolvedContainer specs ready for Docker.
 *
 * This is the core abstraction that translates declarative config:
 *   { postgres: { databases: { main: {}, storage: {} }, port: 5432 } }
 * Into concrete Docker container definitions:
 *   { name: 'omnitron-postgres', image: 'postgres:17-alpine', ports: [...], env: [...] }
 */

import type {
  InfrastructureConfig,
  GatewayServiceConfig,
  ResolvedContainer,
  IServiceRequirement,
  IDockerServiceConfig,
  IServiceOverride,
  ContainerHealthCheck,
} from './types.js';

/**
 * Container naming: {project}-{stack}-{service}
 * Examples: omni-dev-postgres, omni-dev-redis, daos-test-minio
 * Omnitron's own containers: omnitron-pg, omnitron-nginx (no project/stack prefix)
 *
 * Docker labels for stack grouping (Docker Desktop groups containers visually):
 *   com.docker.compose.project = omnitron-{project}-{stack}
 *   com.docker.compose.service = {service}
 *   omnitron.project = {project}
 *   omnitron.stack = {stack}
 */
let CONTAINER_PREFIX = 'omnitron';

/** Set the container prefix for project-scoped infrastructure */
export function setContainerPrefix(project: string, env: string): void {
  CONTAINER_PREFIX = `${project}-${env}`;
}

/** Get current prefix */
export function getContainerPrefix(): string {
  return CONTAINER_PREFIX;
}

function containerName(service: string): string {
  return `${CONTAINER_PREFIX}-${service}`;
}

/**
 * Stack ownership labels — injected into every stack-scoped container.
 * Used by orphan reconciliation on daemon startup to identify
 * containers that belong to a specific project/stack.
 */
let STACK_LABELS: Record<string, string> = {};

/** Set stack labels for subsequent container creation calls */
export function setStackLabels(project: string, stack: string): void {
  STACK_LABELS = {
    'omnitron.project': project,
    'omnitron.stack': stack,
    // Docker Desktop groups containers by com.docker.compose.project label
    'com.docker.compose.project': `omnitron-${project}-${stack}`,
  };
}

/** Clear stack labels (for internal/global containers) */
export function clearStackLabels(): void {
  STACK_LABELS = {};
}

/** Get current stack labels */
function stackLabels(): Record<string, string> {
  return { ...STACK_LABELS };
}

// =============================================================================
// Service Requirement → ResolvedContainer (generic resolver for ALL services)
// =============================================================================

/**
 * Resolve an app-declared IServiceRequirement into a ResolvedContainer.
 * Applies networkMode variant selection and stack-level overrides.
 *
 * Returns null if:
 * - No Docker config (external-only service)
 * - Service is disabled by stack override
 * - Stack override provides an external address
 */
export function resolveServiceRequirement(
  serviceName: string,
  requirement: IServiceRequirement,
  override?: IServiceOverride,
  appName?: string,
): ResolvedContainer | null {
  // Skip disabled or external services
  if (override?.disabled) return null;
  if (override?.external) return null;

  const baseDocker = requirement.docker;
  if (!baseDocker) return null; // No Docker config = external-only

  // Deep-merge: base → networkMode variant → stack override
  let docker: IDockerServiceConfig = { ...baseDocker };

  if (requirement.networkMode && baseDocker.variants?.[requirement.networkMode]) {
    docker = deepMergeDocker(docker, baseDocker.variants[requirement.networkMode]!);
  }

  if (override?.docker) {
    docker = deepMergeDocker(docker, override.docker);
  }

  // Resolve image
  const image = docker.image ?? docker.build?.tag ?? `${serviceName}:latest`;

  // Map ports: requirement.ports defines container ports, docker.portMappings overrides host ports
  const ports = Object.entries(requirement.ports).map(([name, containerPort]) => ({
    host: docker.portMappings?.[name] ?? containerPort,
    container: containerPort,
  }));

  // Resolve volumes
  const volumes = Object.entries(docker.volumes ?? {}).map(([name, vol]) => {
    if (typeof vol === 'string') {
      return { source: `${CONTAINER_PREFIX}-${serviceName}-${name}`, target: vol };
    }
    const isBindMount = vol.source.startsWith('/') || vol.source.startsWith('.');
    const entry: { source: string; target: string; readonly?: boolean } = {
      source: isBindMount ? vol.source : `${CONTAINER_PREFIX}-${serviceName}-${name}`,
      target: vol.target,
    };
    if (vol.readonly) entry.readonly = vol.readonly;
    return entry;
  });

  // Convert IServiceHealthCheck → ContainerHealthCheck
  const healthCheck = docker.healthCheck ?? convertHealthCheck(requirement.healthCheck, requirement.ports);

  return {
    name: containerName(serviceName),
    image,
    ports,
    environment: docker.environment ?? {},
    volumes,
    command: docker.command,
    entrypoint: docker.entrypoint,
    critical: requirement.critical ?? true,
    healthCheck,
    labels: {
      'omnitron.managed': 'true',
      'omnitron.service': serviceName,
      'com.docker.compose.service': serviceName,
      ...(appName && { 'omnitron.app': appName }),
      ...stackLabels(),
      ...(docker.labels ?? {}),
    },
    restart: docker.restart ?? 'unless-stopped',
    shmSize: docker.shmSize,
    resources: docker.resources,
  };
}

/**
 * Resolve all app-declared infrastructure services into ResolvedContainer[].
 * Respects dependsOn ordering — dependencies come first.
 */
export function resolveAppInfrastructure(
  infrastructure: Record<string, IServiceRequirement>,
  overrides?: Record<string, IServiceOverride>,
  appName?: string,
): ResolvedContainer[] {
  const containers: ResolvedContainer[] = [];
  const resolved = new Set<string>();
  const pending = new Map(Object.entries(infrastructure));

  // Topological sort by dependsOn
  const resolve = (name: string, req: IServiceRequirement): void => {
    if (resolved.has(name)) return;
    resolved.add(name);

    // Resolve dependencies first
    for (const dep of req.dependsOn ?? []) {
      const depReq = pending.get(dep);
      if (depReq) resolve(dep, depReq);
    }

    const override = overrides?.[`${appName}/${name}`] ?? overrides?.[name];
    const container = resolveServiceRequirement(name, req, override, appName);
    if (container) containers.push(container);
  };

  for (const [name, req] of pending) {
    resolve(name, req);
  }

  return containers;
}

/** Convert IServiceHealthCheck to Docker ContainerHealthCheck */
function convertHealthCheck(check?: IServiceRequirement['healthCheck'], ports?: Record<string, number>): ContainerHealthCheck | undefined {
  if (!check) return undefined;

  const parseInterval = (s?: string): string => s ?? '30s';

  switch (check.type) {
    case 'command':
      return {
        test: ['CMD-SHELL', check.target],
        interval: parseInterval(check.interval),
        timeout: parseInterval(check.timeout),
        retries: check.retries ?? 5,
        startPeriod: parseInterval(check.startPeriod),
      };
    case 'tcp':
      return {
        test: ['CMD-SHELL', `nc -z localhost ${check.target} || exit 1`],
        interval: parseInterval(check.interval),
        timeout: parseInterval(check.timeout),
        retries: check.retries ?? 5,
        startPeriod: parseInterval(check.startPeriod),
      };
    case 'http':
      return {
        test: ['CMD-SHELL', `curl -sf http://localhost${check.target} || exit 1`],
        interval: parseInterval(check.interval),
        timeout: parseInterval(check.timeout),
        retries: check.retries ?? 5,
        startPeriod: parseInterval(check.startPeriod),
      };
    case 'jsonrpc': {
      const portName = check.jsonrpc?.port ?? 'rpc';
      const port = ports?.[portName] ?? portName;
      const method = check.jsonrpc?.method ?? check.target;
      const auth = check.jsonrpc?.auth;
      const authStr = auth ? `-u ${auth.user}:${auth.password} ${auth.type === 'digest' ? '--digest' : ''}` : '';
      return {
        test: ['CMD-SHELL', `curl -sf ${authStr} -X POST http://localhost:${port} -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"health","method":"${method}"}' || exit 1`],
        interval: parseInterval(check.interval),
        timeout: parseInterval(check.timeout),
        retries: check.retries ?? 5,
        startPeriod: parseInterval(check.startPeriod),
      };
    }
    default:
      return undefined;
  }
}

/** Deep merge Docker configs (base + variant/override) */
function deepMergeDocker(
  base: IDockerServiceConfig,
  overlay: Partial<IDockerServiceConfig>,
): IDockerServiceConfig {
  const merged: IDockerServiceConfig = { ...base, ...overlay };
  if (base.environment || overlay.environment) {
    merged.environment = { ...base.environment, ...overlay.environment };
  }
  if (base.portMappings || overlay.portMappings) {
    merged.portMappings = { ...base.portMappings, ...overlay.portMappings };
  }
  if (base.labels || overlay.labels) {
    merged.labels = { ...base.labels, ...overlay.labels };
  }
  if (overlay.volumes === undefined && base.volumes) {
    merged.volumes = base.volumes;
  }
  if (overlay.resources === undefined && base.resources) {
    merged.resources = base.resources;
  }
  return merged;
}

// =============================================================================
// Omnitron Internal PostgreSQL
// =============================================================================

/**
 * Omnitron's own PostgreSQL container for internal data (logs, metrics,
 * alerts, portal users, deployments, cluster state).
 * Runs on port 5480 to avoid conflicting with app PG on 5432.
 */
export function resolveOmnitronPg(options?: {
  port?: number;
  user?: string;
  password?: string;
  image?: string;
}): ResolvedContainer {
  const image = options?.image ?? 'postgres:17-alpine';
  const port = options?.port ?? 5480;
  const user = options?.user ?? 'omnitron';
  const password = options?.password ?? 'omnitron';

  return {
    name: `${CONTAINER_PREFIX}-pg`,
    image,
    ports: [{ host: port, container: 5432 }],
    environment: {
      POSTGRES_USER: user,
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: 'omnitron',
    },
    volumes: [
      { source: `${CONTAINER_PREFIX}-pg-data`, target: '/var/lib/postgresql/data' },
    ],
    command: [
      'postgres',
      '-c', 'max_connections=50',
      '-c', 'shared_buffers=64MB',
      '-c', 'log_statement=none',
      '-c', 'log_min_duration_statement=500',
    ],
    healthCheck: {
      test: ['CMD-SHELL', `pg_isready -U ${user} -d omnitron`],
      interval: '5s',
      timeout: '5s',
      retries: 5,
    },
    labels: {
      'omnitron.managed': 'true',
      'omnitron.service': 'omnitron-pg',
      'omnitron.internal': 'true',
    },
    restart: 'unless-stopped',
    shmSize: '128m',
  };
}

// =============================================================================
// Omnitron Nginx (Webapp + API Gateway)
// =============================================================================

/**
 * Omnitron's nginx container serving:
 * - Static webapp files from /usr/share/nginx/html (webapp dist/)
 * - API gateway: /api/* → daemon Netron HTTP (internal port)
 * - WebSocket proxy for real-time features
 *
 * Port 9800 (public) → nginx → port 9801 (internal daemon HTTP)
 */
/**
 * Resolve API gateway container (OpenResty + Lua).
 *
 * Mounts project-level nginx configs as read-only bind volumes.
 * Parameterized via env vars — same config works for dev (Docker) and prod (bare-metal).
 *
 * @param config    Gateway service config from omnitron.config.ts
 * @param redisConfig  Stack's Redis connection info (host, port, password)
 * @param projectRoot  Absolute path to project root (for resolving configDir)
 */
export function resolveGateway(
  config: GatewayServiceConfig,
  redisConfig: { host: string; port: number; db: number; password?: string },
  projectRoot: string,
): ResolvedContainer {
  const image = config.image ?? 'openresty/openresty:alpine';
  const port = config.port ?? 8080;
  const redisDb = redisConfig.db;
  const configDir = config.configDir ?? 'infra/nginx';

  // Resolve absolute path to config directory
  // Use join via string concatenation (ESM-safe, avoids sync require)
  const absConfigDir = projectRoot.endsWith('/') ? projectRoot + configDir : projectRoot + '/' + configDir;

  // Default upstream host — host.docker.internal for Docker, overridable for bare-metal/cluster
  const upstreamHost = 'host.docker.internal';

  return {
    name: containerName('gateway'),
    image,
    ports: [{ host: port, container: 80 }],
    environment: {
      // Redis for maintenance mode + future PoW/rate-limit state
      REDIS_HOST: 'host.docker.internal',
      REDIS_PORT: String(redisConfig.port),
      REDIS_DB: String(redisDb),
      ...(redisConfig.password ? { REDIS_PASSWORD: redisConfig.password } : {}),
      // Upstream backend addresses (envsubst renders nginx.conf template)
      UPSTREAM_MAIN_HOST: upstreamHost,
      UPSTREAM_MAIN_PORT: '3001',
      UPSTREAM_STORAGE_HOST: upstreamHost,
      UPSTREAM_STORAGE_PORT: '3002',
      UPSTREAM_PRICEVERSE_HOST: upstreamHost,
      UPSTREAM_PRICEVERSE_PORT: '3003',
      UPSTREAM_PAYSYS_HOST: upstreamHost,
      UPSTREAM_PAYSYS_PORT: '3004',
      UPSTREAM_MESSAGING_HOST: upstreamHost,
      UPSTREAM_MESSAGING_PORT: '3005',
      UPSTREAM_MESSAGING_WS_HOST: upstreamHost,
      UPSTREAM_MESSAGING_WS_PORT: '3006',
    },
    volumes: [
      // nginx.conf template — rendered by entrypoint via envsubst
      { source: `${absConfigDir}/nginx.conf`, target: '/etc/nginx/templates/nginx.conf', readonly: true },
      // Entrypoint script (envsubst + exec openresty)
      { source: `${absConfigDir}/docker-entrypoint.sh`, target: '/docker-entrypoint.sh', readonly: true },
      // Lua modules (maintenance_check, future PoW)
      { source: `${absConfigDir}/lua`, target: '/etc/nginx/lua', readonly: true },
      // Maintenance mode HTML page
      { source: `${absConfigDir}/maintenance.html`, target: '/etc/nginx/html/maintenance.html', readonly: true },
    ],
    entrypoint: ['/bin/sh', '/docker-entrypoint.sh'],
    healthCheck: {
      test: ['CMD-SHELL', '[ -S /usr/local/openresty/nginx/logs/nginx.pid ] || kill -0 $(cat /usr/local/openresty/nginx/logs/nginx.pid 2>/dev/null) 2>/dev/null || exit 1'],
      interval: '10s',
      timeout: '5s',
      retries: 3,
    },
    labels: {
      'omnitron.managed': 'true',
      'omnitron.service': 'gateway',
      'com.docker.compose.service': 'gateway',
      ...stackLabels(),
    },
    restart: 'unless-stopped',
    extraHosts: ['host.docker.internal:host-gateway'],
    resources: config.resources,
  };
}

// =============================================================================
// Omnitron Admin Console (separate from API gateway)
// =============================================================================

/**
 * Nginx container for serving the Omnitron admin console webapp.
 * NOT the API gateway — this is the admin UI on port 9800.
 */
export function resolveOmnitronNginx(options?: {
  port?: number;
  internalApiPort?: number;
  image?: string;
  webappDistPath?: string;
}): ResolvedContainer {
  const image = options?.image ?? 'nginx:alpine';
  const port = options?.port ?? 9800;
  const internalPort = options?.internalApiPort ?? 9801;
  const webappDist = options?.webappDistPath;

  const volumes: Array<{ source: string; target: string; readonly?: boolean }> = [];
  if (webappDist) {
    volumes.push({ source: webappDist, target: '/usr/share/nginx/html', readonly: true });
  }

  return {
    name: `${CONTAINER_PREFIX}-nginx`,
    image,
    ports: [{ host: port, container: 80 }],
    environment: {
      OMNITRON_API_HOST: 'host.docker.internal',
      OMNITRON_API_PORT: String(internalPort),
    },
    volumes,
    healthCheck: {
      test: ['CMD-SHELL', 'curl -sf http://localhost/ || exit 1'],
      interval: '10s',
      timeout: '5s',
      retries: 3,
    },
    labels: {
      'omnitron.managed': 'true',
      'omnitron.service': 'omnitron-nginx',
      'omnitron.internal': 'true',
    },
    restart: 'unless-stopped',
  };
}

// =============================================================================
// Master Resolver
// =============================================================================

/**
 * Resolve an InfrastructureConfig into a list of concrete container specs.
 *
 * NEW PATH: if `normalizedServices` is provided, uses the generic resolver
 * for ALL services (postgres, redis, minio, custom — all through resolveServiceRequirement).
 *
 * LEGACY PATH: if `normalizedServices` is not provided, uses old hardcoded resolvers.
 * This will be removed once all callers migrate.
 */
/**
 * Resolve an InfrastructureConfig into concrete container specs.
 * Uses preset-normalized services map — all services go through resolveServiceRequirement().
 */
export function resolveInfrastructure(
  _config: InfrastructureConfig,
  normalizedServices?: Record<string, IServiceRequirement>,
): ResolvedContainer[] {
  if (!normalizedServices || Object.keys(normalizedServices).length === 0) {
    return [];
  }
  return resolveAppInfrastructure(normalizedServices);
}
