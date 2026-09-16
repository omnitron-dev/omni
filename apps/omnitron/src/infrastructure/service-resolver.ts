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
 * Examples: myproj-dev-postgres, myproj-dev-redis, myproj-test-minio
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


/**
 * Where to PUBLISH the gateway, which is not where it listens.
 *
 * After preset expansion `ports` holds CONTAINER ports — openresty's
 * `defaultPorts.http` is 80, because that is what the image listens on — and
 * a port named in the config becomes a HOST mapping under
 * `docker.portMappings`. Reading `ports.http` takes the first for the second,
 * so a stack asking for 8080 gets a gateway published on 80.
 *
 * Measured on the dev stand: `omnitron.config.ts` declares
 * `gateway.ports.http = 8080` and its own comment says ":8080" three times,
 * while `daos-dev-gateway` published `80/tcp -> 0.0.0.0:80`. The consequence
 * is quiet rather than loud — a browser arriving on :80 sends
 * `Origin: http://localhost` with no port, which is not in the gateway's
 * allow-list, so the portal cannot call the API through it at all. The portal
 * is reachable on 7080, so nothing complained.
 *
 * `resolveServiceRequirement` has read it correctly all along:
 * `host: docker.portMappings?.[name] ?? containerPort`. Same expression here,
 * because it is the same question — and a port the preset does not declare
 * really is a container port, which is why the fallback is not a mistake.
 */
export function gatewayHostPort(
  service: { ports?: Record<string, number> | undefined; docker?: { portMappings?: Record<string, number> | undefined } | undefined } | undefined,
  legacy: { port?: number | undefined } | undefined,
): number {
  return service?.docker?.portMappings?.['http'] ?? service?.ports?.['http'] ?? legacy?.port ?? 8080;
}

function containerName(service: string): string {
  return `${CONTAINER_PREFIX}-${service}`;
}

/**
 * Convention-derived managed network name.
 *
 * Every container provisioned by omnitron lives on a named bridge network
 * (instead of docker's default `bridge`). This is the central piece that
 * eliminates a whole class of failures we observed in production:
 *
 *   - Docker's default `bridge` accumulates **phantom endpoint records**
 *     after dockerd restarts (host sleep/wake on macOS, dockerd crash).
 *     Recreating any container by name then fails with
 *     `endpoint with name X already exists in network bridge` — and
 *     `docker network disconnect -f bridge X` reports "not found" because
 *     the endpoint is dangling in dockerd's internal state, not actually
 *     attached. A named network has no such global pollution; if it gets
 *     corrupted we can blow it away and rebuild it without touching every
 *     other container on the host.
 *   - Inter-service DNS-by-name only works on named networks, so apps that
 *     need to reach `postgres:5432` from another container can do so
 *     without leaking host ports.
 *
 * Convention `${project}_default` matches what docker-compose creates by
 * default for `${project}` → seamless coexistence with compose-managed
 * adjacent infrastructure.
 */
export function getManagedNetwork(): string {
  return `${CONTAINER_PREFIX}_default`;
}

/**
 * Stamp the managed network onto a container spec when it doesn't already
 * declare one. Centralised so every resolver — preset and built-in alike —
 * gets the same defaults without each having to remember.
 */
export function applyManagedDefaults(spec: ResolvedContainer): ResolvedContainer {
  if (spec.network === undefined) spec.network = getManagedNetwork();

  // Published ports bind to loopback unless a container asks otherwise.
  //
  // Docker's default is every interface, and Docker's iptables rules are
  // inserted ahead of ufw's — so a published port is reachable from the
  // internet no matter what the host firewall says. Measured on the test
  // server, whose ufw allows 22/tcp and nothing else:
  //
  //     nc -vz 37.27.130.185 9700   → timed out (ufw, as configured)
  //     nc -vz 37.27.130.185 5480   → OPEN      (docker, straight past it)
  //
  // 5480 is omnitron's own Postgres. An operator who reads their firewall
  // rules and concludes the database is private is reading a control that
  // does not cover it, which is the worst kind of wrong: a check that
  // answers confidently about something it cannot see.
  //
  // The applications that use these containers run on the same host and
  // reach them over loopback. Anything further away comes through
  // omnitron's own transport, which is authenticated. So the default costs
  // nothing and the exposure had no beneficiary.
  //
  // A container that genuinely must be reachable says so by setting
  // `bindHost` — a deliberate line in a config, reviewable in a diff.
  for (const port of spec.ports ?? []) {
    if (port.bindHost === undefined) port.bindHost = '127.0.0.1';
  }

  return spec;
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
/**
 * An HTTP probe that works in the image it runs in.
 *
 * `curl -sf` was the generic form, and alpine-based images do not ship curl.
 * Measured on the gateway: `/bin/sh: curl: not found`, exit 1, every ten
 * seconds forever — a container serving traffic correctly (the onion in
 * front of it answered 200) reported `unhealthy` for its whole life, and
 * `provisionStack` reported the stack NOT ready because of it.
 *
 * The lesson was already learned once in this file: `resolveOmnitronNginx`
 * uses wget with a comment saying curl is not in the image. It was learned
 * for one container and not for the generic path every other service takes.
 *
 * Tries curl, then wget, then falls back to failing. Both spellings, because
 * busybox wget and GNU wget disagree about flags but agree about these:
 * `-q` quiet, `-O -` to stdout, `-T` timeout.
 */
/**
 * Which port an HTTP health check should knock on.
 *
 * The probe was `http://localhost<path>` — port 80, always. The gateway
 * listens on 8080, so the check connected to nothing:
 *
 *     wget: can't connect to remote host: Connection refused
 *
 * on a container that was serving correctly on its own port, through an
 * onion address that answered 200. Every service whose port is not 80 had
 * an unanswerable health check, and an unanswerable check is a permanent
 * negative — `provisionStack` reported the stack not ready because of it.
 *
 * A check may name its port, as the jsonrpc one already does. Otherwise the
 * service's own: `http` by convention, then whatever single port it
 * declares — a service with one port cannot mean another.
 */
function healthPort(
  check: NonNullable<IServiceRequirement['healthCheck']>,
  ports?: Record<string, number>,
): number {
  const named = (check as { port?: string }).port;
  if (named && ports?.[named]) return ports[named]!;
  if (ports?.['http']) return ports['http'];

  const declared = Object.values(ports ?? {});
  if (declared.length === 1) return declared[0]!;

  // Several ports and no way to choose: 80 is the convention, and saying so
  // here is better than an arbitrary pick that happens to work once.
  return 80;
}

function httpProbe(url: string): string {
  return (
    `curl -sf --max-time 5 ${url} >/dev/null 2>&1 ` +
    `|| wget -q -O /dev/null -T 5 ${url} >/dev/null 2>&1 ` +
    '|| exit 1'
  );
}

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

  // The stack's answer first: an application declares the network that is
  // right on a laptop, and a stack is the scope that knows when it is not.
  const networkMode = override?.networkMode ?? requirement.networkMode;
  if (networkMode && baseDocker.variants?.[networkMode]) {
    docker = deepMergeDocker(docker, baseDocker.variants[networkMode]!);
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

  return applyManagedDefaults({
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
    ...(docker.extraHosts && docker.extraHosts.length > 0 ? { extraHosts: docker.extraHosts } : {}),
    // Service requirement can override the managed network when it has
    // a legitimate reason (host-net for low-latency wallet RPC, isolated
    // network for security boundary, etc.). When unset, applyManagedDefaults
    // stamps in the project-wide bridge.
    ...(typeof docker.network === 'string' ? { network: docker.network } : {}),
  });
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

  // One helper per default, not one helper for every duration field. A
  // single `(s) => s ?? '30s'` used to serve all three, which gave `timeout`
  // the interval's default: probes ran with a 30s deadline where the type
  // and the documentation both promise 10s, so an unresponsive service was
  // marked unhealthy up to three times later than stated — and with the
  // deadline equal to the gap between probes, they can overlap.
  const everyDefault = (s?: string): string => s ?? '30s';
  const deadlineDefault = (s?: string): string => s ?? '10s';

  switch (check.type) {
    case 'command':
      return {
        test: ['CMD-SHELL', check.target],
        interval: everyDefault(check.interval),
        timeout: deadlineDefault(check.timeout),
        retries: check.retries ?? 5,
        startPeriod: everyDefault(check.startPeriod),
      };
    case 'tcp':
      return {
        test: ['CMD-SHELL', `nc -z localhost ${check.target} || exit 1`],
        interval: everyDefault(check.interval),
        timeout: deadlineDefault(check.timeout),
        retries: check.retries ?? 5,
        startPeriod: everyDefault(check.startPeriod),
      };
    case 'http':
      return {
        test: ['CMD-SHELL', httpProbe(`http://localhost:${healthPort(check, ports)}${check.target}`)],
        interval: everyDefault(check.interval),
        timeout: deadlineDefault(check.timeout),
        retries: check.retries ?? 5,
        startPeriod: everyDefault(check.startPeriod),
      };
    case 'jsonrpc': {
      const portName = check.jsonrpc?.port ?? 'rpc';
      const port = ports?.[portName] ?? portName;
      const method = check.jsonrpc?.method ?? check.target;
      const auth = check.jsonrpc?.auth;
      const authStr = auth ? `-u ${auth.user}:${auth.password} ${auth.type === 'digest' ? '--digest' : ''}` : '';
      const rpcPath = check.jsonrpc?.path ?? '/json_rpc';
      return {
        test: ['CMD-SHELL', `curl -sf ${authStr} -X POST http://localhost:${port}${rpcPath} -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"health","method":"${method}"}' || exit 1`],
        interval: everyDefault(check.interval),
        timeout: deadlineDefault(check.timeout),
        retries: check.retries ?? 5,
        startPeriod: everyDefault(check.startPeriod),
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

  return applyManagedDefaults({
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
  });
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

  return applyManagedDefaults({
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
      UPSTREAM_PRICING_HOST: upstreamHost,
      UPSTREAM_PRICING_PORT: '3003',
      UPSTREAM_PAYMENTS_HOST: upstreamHost,
      UPSTREAM_PAYMENTS_PORT: '3004',
      UPSTREAM_MESSAGING_HOST: upstreamHost,
      UPSTREAM_MESSAGING_PORT: '3005',
      UPSTREAM_MESSAGING_WS_HOST: upstreamHost,
      UPSTREAM_MESSAGING_WS_PORT: '3006',
      UPSTREAM_GEO_HOST: upstreamHost,
      UPSTREAM_GEO_PORT: '3007',
      // User-supplied env overrides/additions (e.g. PORTAL_DEV_UPSTREAM). Merged
      // last so config can override a preset default when intended.
      ...(config.env ?? {}),
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
  });
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
  /** Interface to publish on. Loopback unless the caller says otherwise. */
  bindHost?: string;
}): ResolvedContainer {
  const image = options?.image ?? 'nginx:alpine';
  const port = options?.port ?? 9800;
  const internalPort = options?.internalApiPort ?? 9801;
  const webappDist = options?.webappDistPath;

  const volumes: Array<{ source: string; target: string; readonly?: boolean }> = [];
  if (webappDist) {
    volumes.push({ source: webappDist, target: '/usr/share/nginx/html', readonly: true });
  }

  return applyManagedDefaults({
    name: `${CONTAINER_PREFIX}-nginx`,
    image,
    ports: [{ host: port, container: 80, bindHost: options?.bindHost ?? '127.0.0.1' }],
    environment: {
      OMNITRON_API_HOST: 'host.docker.internal',
      OMNITRON_API_PORT: String(internalPort),
    },
    volumes,
    // Reach the daemon on the host even when we're on a named bridge —
    // wget/curl health probes inside the container need this too.
    extraHosts: ['host.docker.internal:host-gateway'],
    // Use wget (busybox-shipped in nginx:alpine) — `curl` is not in the
    // base image, so the previous CMD-SHELL test was permanently
    // unhealthy on a vanilla alpine nginx until someone bind-mounted curl
    // in. wget is always present.
    //
    // Probe 127.0.0.1 (not `localhost`): musl resolves `localhost` to ::1
    // first, but nginx only `listen 80;` on IPv4, so an IPv6 probe gets
    // ECONNREFUSED and the container is reported permanently unhealthy even
    // though the console is serving fine over IPv4.
    healthCheck: {
      test: ['CMD-SHELL', 'wget -q --spider http://127.0.0.1/ || exit 1'],
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
  });
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
  /**
   * Stack overrides — `disabled`, `external`, per-service docker changes.
   *
   * This did not take them, and `resolveAppInfrastructure` was called
   * without them, so `serviceOverrides` was honoured for services an
   * APPLICATION declares and read by nothing for the ones a stack declares.
   * An operator writing `tiles: { disabled: true }` got tiles.
   *
   * Measured on the test server: a stack that disabled the geocoder and the
   * tile server provisioned both — a geocoding database that can reach tens
   * of gigabytes, on a host chosen for a payment system.
   */
  overrides?: Record<string, IServiceOverride>,
  /**
   * Where a service's config files live on THIS machine, by service name.
   *
   * The gateway is not an ordinary preset container: it needs four bind
   * mounts, an entrypoint and fifteen upstream variables, and `resolveGateway`
   * is the only thing that produces them. On a master they come from the
   * project root; on a node there is no project, so the files are sent over
   * and written locally, and this names where.
   *
   * Without it a node built its gateway through the generic preset path —
   * whose own `defaultDocker` comment says "Volumes and entrypoint configured
   * by resolveGateway" — and got bare openresty: an empty `Mounts` array, a
   * null entrypoint, zero UPSTREAM variables, and an onion serving
   * `Welcome to OpenResty!`.
   */
  configRoots?: Map<string, string>,
  gatewayContext?: { redis: { host: string; port: number; db: number; password?: string }; port?: number },
): ResolvedContainer[] {
  if (!normalizedServices || Object.keys(normalizedServices).length === 0) {
    return [];
  }

  const gatewayRoot = configRoots?.get('gateway');
  if (!gatewayRoot || !normalizedServices['gateway'] || !gatewayContext) {
    return resolveAppInfrastructure(normalizedServices, overrides);
  }

  // One resolver for the gateway, wherever it runs. The rest go through the
  // generic path, which is right for them.
  const { gateway: _gateway, ...rest } = normalizedServices;
  const containers = resolveAppInfrastructure(rest, overrides);
  containers.push(
    resolveGateway(
      { port: gatewayHostPort(normalizedServices['gateway'] as never, undefined), configDir: '.' },
      gatewayContext.redis,
      gatewayRoot,
    ),
  );
  return containers;
}
