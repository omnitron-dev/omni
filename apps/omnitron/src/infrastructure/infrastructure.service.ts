/**
 * InfrastructureService — Self-healing infrastructure provisioner
 *
 * Manages the complete lifecycle of infrastructure containers:
 *   1. Desired state declared in omnitron.config.ts
 *   2. Reconciliation loop diffs desired vs actual state
 *   3. Creates/starts/recreates containers as needed
 *   4. Continuous health monitoring with auto-restart
 *   5. Post-provisioning setup (create databases, buckets, etc.)
 *
 * Replaces: docker-compose.dev.yml + dev.sh + .env.dev
 *
 * Architecture:
 *   InfrastructureConfig → ServiceResolver → ResolvedContainer[]
 *   ResolvedContainer[] → ContainerRuntime → Docker CLI
 *   Health Loop → detect failure → auto-restart (exponential backoff)
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { computeBackoff } from '@omnitron-dev/titan/utils';
import type {
  InfrastructureConfig,
  InfrastructureState,
  ContainerState,
  ResolvedContainer,
  ReconcileAction,
} from './types.js';
import { resolveInfrastructure, resolveOmnitronPg, getManagedNetwork } from './service-resolver.js';
import { PhantomEndpointJanitor } from './phantom-endpoint-janitor.js';
import { LOCAL_INFRA_HOST } from '../shared/local-infra-host.js';
import {
  isDockerAvailable,
  getContainerState,
  createContainer,
  startContainer,
  removeContainer,
  ensureImage,
  waitForHealthy,
  createVolume,
  containerSpecHash,
} from './container-runtime.js';
import { summariseProvisioning, describeProvisioning } from './provisioning-outcome.js';
import {
  OMNITRON_PG_PORT,
  OMNITRON_PG_USER,
  OMNITRON_PG_PASSWORD,
  OMNITRON_PG_DATABASE,
} from '../database/connection.js';

const RECONCILE_INTERVAL = 30_000; // 30s health sweep
const STARTUP_TIMEOUT = 120_000; // 2min max per service
/** Consecutive 'unhealthy' ticks before recreate. 2 ticks @ 30s = 60s grace. */
const UNHEALTHY_RESTART_THRESHOLD = 2;
/** Restart circuit-breaker: first failed-restart backoff, doubled each failure. */
const RESTART_BACKOFF_BASE = 30_000; // 30s
/** Restart circuit-breaker: backoff ceiling (30s → 1m → 2m … capped here). */
const RESTART_BACKOFF_MAX = 15 * 60_000; // 15min

/**
 * Restart-circuit-breaker backoff schedule: the delay (ms) to wait before the
 * next restart attempt after `failures` consecutive failed (re)creates.
 * Exponential from RESTART_BACKOFF_BASE, capped at RESTART_BACKOFF_MAX so a
 * permanently-broken service settles into an occasional retry instead of
 * hammering the supervisor every 30s.
 *
 * Delegates to the shared titan `computeBackoff` (the same helper the downstream
 * backends and the titan packages use) so the exponential shape lives in ONE
 * place. Exported for tests.
 */
export function restartBackoffMs(failures: number): number {
  if (failures < 1) return 0;
  return computeBackoff({ attempt: failures - 1, baseMs: RESTART_BACKOFF_BASE, maxMs: RESTART_BACKOFF_MAX });
}

// Omnitron internal PG connection defaults live in `database/connection.ts`
// so the container spec below and every client that connects to it are
// derived from the same values (see the import above).

/**
 * What to do about the control plane's own database.
 *
 * Three cases that look alike and are not:
 *
 *   - a node's daemon keeps its state in SQLite and needs no database at all;
 *   - one is running, so it gets the same reconcile — and so the same
 *     `containerSpecHash` drift check — as every app service;
 *   - nothing is running, so provision.
 *
 * The middle case is the one that was missing. "Already running" was read as
 * "configured as declared", and the database was adopted exactly as it stood.
 * Measured: `omnitron-pg`, created before published ports were bound to
 * loopback, survived on 0.0.0.0:5480 through the fix that reached all eleven
 * other managed containers, and still answered `nc -vz <lan-address> 5480`
 * from another machine months later, while `daos-dev-postgres` beside it in
 * `docker ps` was correctly on 127.0.0.1.
 *
 * `reconcileName` is the subtlety. The control-plane database is ONE
 * container per host — it owns port 5480 — but each daemon resolves a name
 * carrying its own project prefix, so a daemon on the `daos/dev` stack
 * computes `daos-dev-pg` while the container that exists is `omnitron-pg`.
 * Reconciling the running container against a spec under the OTHER name
 * creates a second one and collides on the port; the first version of this
 * did exactly that and corrected nothing. The name to reconcile is therefore
 * the name of the container that is actually there, and the spec is
 * everything else. `containerSpecHash` does not cover the name, so the drift
 * comparison is unaffected either way.
 *
 * A differing name is not evidence of another owner: only omnitron creates
 * this container, and it carries omnitron's own `omnitron.internal` label.
 */
export function decideControlPlaneDatabase(input: {
  needsControlPlaneDatabase: boolean;
  running: { name?: string; status?: string; specHash?: string | undefined } | null;
  desiredName: string;
}): { action: 'skip' | 'provision' } | { action: 'reconcile'; reconcileName: string } {
  if (!input.needsControlPlaneDatabase) return { action: 'skip' };
  if (input.running?.status !== 'running') return { action: 'provision' };
  return { action: 'reconcile', reconcileName: input.running.name ?? input.desiredName };
}

export class InfrastructureService {
  private desiredContainers: ResolvedContainer[] = [];
  /** What the most recent reconcile did to each service. */
  private readonly lastActions = new Map<string, string>();
  private readonly omnitronPgContainer: ResolvedContainer;
  private usingGlobalOmnitronPg = false;
  private healthTimer: NodeJS.Timeout | null = null;
  private readonly state: InfrastructureState = { services: {}, ready: false };
  private readonly normalizedServices: Record<string, import('./types.js').IServiceRequirement>;

  /**
   * Per-service consecutive-unhealthy counter. Restart only fires after
   * UNHEALTHY_RESTART_THRESHOLD ticks in a row to avoid flapping during
   * cold-start / transient health-check timeouts. Reset to 0 on a healthy
   * observation. Without this, a service that briefly fails one health
   * probe (network blip, slow query) would be torn down and recreated,
   * making transient pressure look like outages.
   */
  private unhealthyTicks = new Map<string, number>();

  /**
   * Per-service restart circuit-breaker. A container whose (re)create keeps
   * failing — an image that won't pull, or infra stuck on an unrecoverable
   * error — must NOT be retried every 30s forever: that churn (docker calls +
   * error logging) is what wedged the daemon's event loop and let an external
   * "socket unreachable → SIGTERM" kill the whole daemon during the 2026-05
   * outage. After each failed restart we back off exponentially (30s → 1m →
   * 2m … capped at 15m); a successful restart or an externally-recovered
   * 'running' observation resets it.
   */
  private restartBackoff = new Map<string, { failures: number; nextAttemptAt: number }>();

  /**
   * T#75: phantom-endpoint janitor instance. Created in `provision()`
   * once we know Docker is reachable; torn down in `teardown()`.
   */
  private phantomJanitor: PhantomEndpointJanitor | null = null;

  constructor(
    private readonly logger: ILogger,
    private readonly config: InfrastructureConfig,
    normalizedServices?: Record<string, import('./types.js').IServiceRequirement>,
    private readonly presetRegistry?: import('./presets/registry.js').PresetRegistry,
    /**
     * Stack overrides. A service marked `disabled` here is not provisioned,
     * and one pointed at an `external` address is not provisioned either —
     * there is nothing to create, and the address reaches the application
     * through its environment instead.
     */
    private readonly serviceOverrides?: Record<string, import('./types.js').IServiceOverride>,
    /**
     * Whether this daemon stores its own state in Postgres.
     *
     * True for a master, which is where projects, nodes, metrics and logs
     * live. False for a node: its daemon keeps that in SQLite and reads a
     * Postgres never.
     */
    private readonly needsControlPlaneDatabase = true,
  ) {
    this.normalizedServices = normalizedServices ?? {};
    this.desiredContainers = resolveInfrastructure(config, normalizedServices, serviceOverrides);
    this.omnitronPgContainer = resolveOmnitronPg();
  }

  /**
   * Add app-declared infrastructure containers to the provisioning list.
   * Called by StackInfrastructureManager after resolving app requirements.
   *
   * T#76: dedupe by container name. The `${CONTAINER_PREFIX}-${service}`
   * naming convention means two apps that BOTH declare a `postgres`
   * requirement produce two identical-named entries. Pre-T#76, the
   * provisioning loop tried to create the container twice; Docker's
   * name-uniqueness check failed the second create with "name already
   * in use", leaving the second app's perspective on infrastructure
   * broken (it saw a failure that, from the cluster's view, was a
   * benign collision — the shared service was actually fine).
   *
   * The intended semantics for shared infrastructure is "all apps that
   * declare `postgres` use the same container", so the first
   * declaration wins. When subsequent declarations differ in shape
   * (image / env / ports), log a structured warning so the operator
   * can reconcile intent vs. config.
   */
  addAppContainers(containers: ResolvedContainer[]): void {
    for (const c of containers) {
      const existing = this.desiredContainers.find((d) => d.name === c.name);
      if (!existing) {
        this.desiredContainers.push(c);
        continue;
      }
      if (!shallowContainerEqual(existing, c)) {
        this.logger.warn(
          {
            container: c.name,
            existingImage: existing.image,
            duplicateImage: c.image,
          },
          'Duplicate container declaration with differing shape — keeping first; check for conflicting app infrastructure requirements (T#76)',
        );
      }
      // else: identical declaration, silent dedupe — this is the common case
    }
  }

  /**
   * Provision all infrastructure services.
   * Ensures Docker is available, pulls images, creates/starts containers,
   * runs post-provisioning setup, and starts the health monitor.
   */
  async provision(): Promise<InfrastructureState> {
    // 1. Verify Docker is available
    if (!(await isDockerAvailable())) {
      throw new Error(
        'Docker is not available. Omnitron requires Docker to manage infrastructure.\n' +
        'Install Docker: https://docs.docker.com/get-docker/'
      );
    }

    // 2. Provision Omnitron's internal PostgreSQL (logs, metrics, portal users, etc.)
    //    Skip if the global omnitron-pg is already running (avoids port conflict).
    //    The stack-prefixed container (e.g. omni-dev-pg) shares the same port,
    //    so we must not create/start it when the global one is active.
    const globalOmnitronPg = await getContainerState('omnitron-pg');
    const decision = decideControlPlaneDatabase({
      needsControlPlaneDatabase: this.needsControlPlaneDatabase,
      running: globalOmnitronPg,
      desiredName: this.omnitronPgContainer.name,
    });

    if (decision.action === 'skip') {
      // A node's daemon keeps its own state in SQLite — `SlaveStorageService`,
      // `~/.omnitron/data/slave.db` — and reads this database never. Creating
      // it anyway gave every provisioned node a Postgres nobody queries, on
      // default credentials, and until published ports were bound to
      // loopback it was reachable from the internet: measured answering on
      // 0.0.0.0:5480 on a host whose firewall allows only SSH.
      //
      // The control plane's database belongs to the control plane.
      this.logger.debug('This daemon keeps its own state in SQLite — not provisioning a control-plane database');
    } else if (decision.action === 'reconcile') {
      this.usingGlobalOmnitronPg = true;

      // A stack-prefixed leftover cannot run beside the global one — they
      // share port 5480 — so it goes before anything else touches that port.
      if (this.omnitronPgContainer.name !== decision.reconcileName) {
        const stalePg = await getContainerState(this.omnitronPgContainer.name);
        if (stalePg) {
          try {
            await removeContainer(this.omnitronPgContainer.name);
            this.logger.info({ service: this.omnitronPgContainer.name }, 'Removed stale stack-prefixed PG container');
          } catch { /* already gone */ }
        }
      }

      // The same reconcile, and so the same drift check, as every app
      // service — under the name the container actually has. Its data lives
      // in the `omnitron-pg-data` volume and outlives the container it is
      // recreated into.
      // Name AND volume, not one of them. `resolveOmnitronPg` derives both
      // from the container prefix, so overriding only the name produced a
      // container called `omnitron-pg` mounting `daos-dev-pg-data` — the
      // global identity on a stack-scoped volume, and the stack's own
      // `omnitron-pg-data` left dangling where a `docker volume prune` would
      // take it silently. The two names are one decision and must move
      // together.
      const reconciled = { ...this.omnitronPgContainer, name: decision.reconcileName };
      if (decision.reconcileName !== this.omnitronPgContainer.name) {
        reconciled.volumes = this.omnitronPgContainer.volumes.map((v) =>
          v.target === '/var/lib/postgresql/data' ? { ...v, source: `${decision.reconcileName}-data` } : v,
        );
      }
      await this.reconcileService(reconciled);
    } else {
      try {
        await this.provisionOmnitronDatabase();
      } catch (err) {
        this.logger.error(
          { error: (err as Error).message },
          'Failed to provision Omnitron internal database'
        );
        this.state.services[this.omnitronPgContainer.name] = {
          name: this.omnitronPgContainer.name,
          image: this.omnitronPgContainer.image,
          status: 'exited',
          error: (err as Error).message,
        };
      }
    }

    this.logger.info(
      { services: this.desiredContainers.map((c) => c.name) },
      'Provisioning app infrastructure'
    );

    // 3. Reconcile every app service in parallel.
    //
    // Pre-fix this was a serial `for await` loop over up to a dozen
    // containers. For an already-healthy stack (the common cold-boot
    // case where Docker preserved containers across a daemon
    // restart) each reconcileService is a single `docker inspect`
    // round-trip — but doing nine of them serially still costs
    // multiple seconds of latency on the critical path before
    // apps can even start spawning.
    //
    // Safety: `reconcileService` holds a per-name lock
    // (`this.reconciling`), so parallel calls for the SAME
    // container still serialise. Cross-container ordering (e.g.
    // monero-wallet-rpc must talk to monero-daemon) is enforced
    // by each container's own healthcheck loop — the wallet's
    // health probe retries until the daemon's RPC accepts
    // connections, so launching them in parallel just extends the
    // wallet's first-try wait, not its end state.
    await Promise.all(
      this.desiredContainers.map(async (desired) => {
        try {
          await this.reconcileService(desired);
        } catch (err) {
          this.logger.error(
            { service: desired.name, error: (err as Error).message },
            'Failed to provision service'
          );
          this.state.services[desired.name] = {
            name: desired.name,
            image: desired.image,
            status: 'exited',
            error: (err as Error).message,
          };
        }
      }),
    );

    // 4. Post-provisioning setup (create databases, buckets, etc.)
    await this.postProvision();

    // 4. Start health monitor
    this.startHealthMonitor();

    // T#75: start the phantom-endpoint janitor. It periodically
    // cleans up stale endpoint records on the managed network so
    // a Docker daemon restart / host suspend doesn't leave us
    // unable to recreate containers ("endpoint with name X
    // already exists in network ...").
    this.phantomJanitor = new PhantomEndpointJanitor({
      networks: [getManagedNetwork()],
      intervalMs: 60_000,
      logger: this.logger,
    });
    this.phantomJanitor.start();

    // Readiness is measured, not announced.
    //
    // These two lines were `ready = true` and "Infrastructure provisioned
    // and healthy", unconditionally — and every service reconciles inside a
    // `Promise.all` whose per-service catch records `exited` and continues.
    // So a run where every container failed ended exactly like a run where
    // all of them came up, and the gate below this waits on a flag that
    // could not say no. See `summariseProvisioning`.
    const outcome = summariseProvisioning(this.desiredContainers, this.state.services);
    this.state.ready = outcome.ready;
    this.state.lastReconciled = new Date().toISOString();

    if (outcome.ready) {
      this.logger.info(describeProvisioning(outcome));
    } else {
      this.logger.error(
        {
          missing: outcome.missing.map((s) => s.name),
          failed: outcome.failed.map((s) => ({ name: s.name, status: s.status, error: s.error })),
          running: outcome.running.length,
        },
        describeProvisioning(outcome),
      );
    }

    return this.state;
  }

  /**
   * What this service was asked to provide.
   *
   * Exposed because a caller cannot tell "present and fine" from "never
   * attempted" by reading `state.services` alone: the second leaves no entry,
   * and an absent entry is indistinguishable from an absent problem.
   */
  getDesiredServices(): ReadonlyArray<{ name: string; image?: string | undefined }> {
    return this.desiredContainers.map((c) => ({ name: c.name, image: c.image }));
  }

  /**
   * Services whose socket is new since this reconcile began.
   *
   * `noop` is the only action that leaves an existing connection usable.
   * Everything else means anything already connected is holding a dead pool.
   */
  getRestartedServices(): string[] {
    return [...this.lastActions.entries()]
      .filter(([, action]) => action === 'create' || action === 'start' || action === 'recreate')
      .map(([name]) => name);
  }

  /**
   * Stop all managed infrastructure containers.
   */
  async teardown(): Promise<void> {
    this.stopHealthMonitor();
    // T#75: stop the janitor BEFORE removing containers so a final
    // tick can't race the teardown's `docker rm` and produce noisy
    // disconnect-of-already-disconnected errors.
    if (this.phantomJanitor) {
      this.phantomJanitor.stop();
      this.phantomJanitor = null;
    }

    // Remove all containers in parallel for fast shutdown.
    // Skip the stack-prefixed PG when using the global omnitron-pg (it's shared).
    const allContainers = this.usingGlobalOmnitronPg
      ? [...this.desiredContainers].reverse()
      : [...[...this.desiredContainers].reverse(), this.omnitronPgContainer];

    await Promise.allSettled(
      allContainers.map(async (c) => {
        try {
          await removeContainer(c.name);
          this.logger.info({ service: c.name }, 'Container removed');
        } catch {
          // Already removed
        }
      }),
    );

    this.state.ready = false;
  }

  /**
   * Get current infrastructure state.
   */
  getState(): InfrastructureState {
    return this.state;
  }

  /**
   * Get normalized services (from preset system).
   * Used by config-resolver for generic address resolution.
   */
  getNormalizedServices(): Record<string, import('./types.js').IServiceRequirement> {
    return this.normalizedServices;
  }

  /**
   * Databases declared for this stack's postgres (e.g. main, storage, geo).
   * Source of truth for "which DBs must be backed up" — read straight from
   * the same `infrastructure.postgres.databases` block omnitron provisions
   * from, so the backup set can never drift from the provisioned set.
   */
  getPostgresDatabases(): string[] {
    const pg = this.config.postgres;
    if (!pg || !pg.databases) return [];
    return Object.keys(pg.databases);
  }

  /**
   * Resolved container name for an infra service (e.g. 'postgres' →
   * 'acme-dev-postgres'). Taken from the already-resolved desired containers
   * so it reflects the real container prefix rather than re-deriving it from
   * the mutable module-global. Returns null if the stack has no such service.
   */
  getResolvedContainerName(service: string): string | null {
    const match = this.desiredContainers.find((d) => d.name.endsWith(`-${service}`));
    return match?.name ?? null;
  }

  /**
   * Get connection info for an infrastructure service.
   * Used by config generator to resolve { infra: 'postgres', database: 'main' }.
   */
  getConnectionInfo(service: string): Record<string, unknown> | null {
    switch (service) {
      case 'postgres': {
        const pg = this.config.postgres;
        if (!pg) return null;
        return {
          host: LOCAL_INFRA_HOST,
          port: pg.port ?? 5432,
          user: pg.user ?? 'postgres',
          password: typeof pg.password === 'string' ? pg.password : 'postgres',
        };
      }
      case 'redis': {
        const redis = this.config.redis;
        if (!redis) return null;
        return {
          host: LOCAL_INFRA_HOST,
          port: redis.port ?? 6379,
          password: typeof redis.password === 'string' ? redis.password : undefined,
          databases: redis.databases ?? {},
        };
      }
      case 'minio': {
        const minio = this.config.minio;
        if (!minio) return null;
        return {
          endpoint: `http://${LOCAL_INFRA_HOST}:${minio.ports?.api ?? 9000}`,
          accessKey: minio.accessKey ?? 'minioadmin',
          secretKey: typeof minio.secretKey === 'string' ? minio.secretKey : 'minioadmin',
          forcePathStyle: true,
        };
      }
      case 'omnitron-pg':
        return {
          host: LOCAL_INFRA_HOST,
          port: OMNITRON_PG_PORT,
          user: OMNITRON_PG_USER,
          password: OMNITRON_PG_PASSWORD,
          database: OMNITRON_PG_DATABASE,
        };
      default:
        return null;
    }
  }

  // ===========================================================================
  // Private — Reconciliation
  // ===========================================================================

  /**
   * Per-name in-flight reconcile lock (T#58). A health sweep that
   * overlaps a previous slow sweep — or a reconcile triggered by
   * `ensureXxx` calls happening concurrently — used to enter
   * `reconcileService` twice for the same container. The first did
   * `removeContainer` then `createAndStart`; the second saw the
   * container missing mid-recreate and tried to recreate it too,
   * producing name conflicts, partial state, and (with Docker's
   * own restart-policy in the mix) occasional duplicate containers.
   */
  private readonly reconciling = new Set<string>();

  /**
   * Where this node keeps each service's config files, once a master sent them.
   *
   * The gateway is not an ordinary preset container — it needs four bind
   * mounts, an entrypoint and fifteen upstream variables, and `resolveGateway`
   * is the only thing that produces them. The constructor resolved everything
   * through the generic preset path, because at construction time this node
   * had no files and no local path to mount from.
   *
   * So this RE-RESOLVES rather than patching the volumes of a container built
   * without them. A spec assembled by the wrong resolver is missing more than
   * paths, and rewriting one field of it would produce a container that looks
   * configured and is not — which is the failure that was already shipping,
   * one level down.
   *
   * Called before `provision()`, so the recreation the changed spec hash
   * implies happens on the first pass rather than the second.
   */
  setConfigRoots(
    roots: Map<string, string>,
    staticRoots: Map<string, string>,
    redis: { host: string; port: number; db: number; password?: string },
  ): void {
    if (roots.size === 0) return;
    this.desiredContainers = resolveInfrastructure(
      this.config,
      this.normalizedServices,
      this.serviceOverrides,
      roots,
      { redis, staticRoots },
    );
  }

  private async reconcileService(desired: ResolvedContainer): Promise<void> {
    // T#58: per-name lock around the whole inspect→decide→act loop.
    if (this.reconciling.has(desired.name)) {
      this.logger.debug({ service: desired.name }, 'Reconcile already in flight — skipping');
      return;
    }
    this.reconciling.add(desired.name);
    try {
      await this.reconcileServiceLocked(desired);
    } finally {
      this.reconciling.delete(desired.name);
    }
  }

  private async reconcileServiceLocked(desired: ResolvedContainer): Promise<void> {
    const actual = await getContainerState(desired.name);

    const action = this.computeAction(desired, actual);
    // A container that was created, started or recreated is listening on a
    // NEW socket. Applications already running hold pools pointing at the
    // old one, and a titan liveness probe does not notice — the app answers
    // `/health` 200 while every request it serves fails with "Connection
    // terminated unexpectedly". Whoever asked for this reconcile is the only
    // one in a position to restart them, so it has to be told.
    this.lastActions.set(desired.name, action.type);

    switch (action.type) {
      case 'noop':
        this.logger.debug({ service: desired.name }, 'Service already running');
        break;

      case 'create':
        this.logger.info({ service: desired.name, image: desired.image }, 'Creating service');
        await this.createAndStart(desired);
        break;

      case 'start':
        this.logger.info({ service: desired.name }, 'Starting existing service');
        await startContainer(action.containerId);
        await this.waitHealthy(desired.name);
        break;

      case 'recreate':
        this.logger.info(
          { service: desired.name, reason: action.reason },
          'Recreating service'
        );
        await removeContainer(desired.name);
        await this.createAndStart(desired);
        break;

      case 'remove':
        await removeContainer(action.containerId);
        break;
      default:
        break;
    }

    // Update state
    const newState = await getContainerState(desired.name);
    if (newState) {
      this.state.services[desired.name] = newState;
    }
  }

  private computeAction(
    desired: ResolvedContainer,
    actual: ContainerState | null
  ): ReconcileAction {
    if (!actual) {
      return { type: 'create', service: desired.name, config: desired };
    }

    if (actual.status === 'running') {
      // Running but detached from all networks (OrbStack/dockerd-restart
      // artifact): the container is unreachable and its published ports are
      // gone. 'running' is a lie here — recreate to re-attach + re-publish.
      if (actual.networkAttached === false) {
        return {
          type: 'recreate',
          service: desired.name,
          config: desired,
          reason: 'network-detached (running but on no network)',
        };
      }
      // Check if image changed
      if (actual.image !== desired.image && !actual.image.startsWith(desired.image)) {
        return {
          type: 'recreate',
          service: desired.name,
          config: desired,
          reason: `image changed: ${actual.image} → ${desired.image}`,
        };
      }
      // Config drift: image unchanged but the desired spec (env, ports,
      // volumes, command, extraHosts) differs from what the running container
      // was created with. Without this, an omnitron.config.ts edit that only
      // touches env — e.g. the Tor hidden-service target — is silently ignored
      // because the container is "running and healthy". Only fires when the
      // running container carries a spec-hash label; pre-upgrade containers
      // (no label) are left alone until they recreate for another reason, so
      // upgrading omnitron never churns an otherwise-healthy stack.
      if (actual.specHash) {
        const desiredHash = containerSpecHash(desired);
        if (actual.specHash !== desiredHash) {
          return {
            type: 'recreate',
            service: desired.name,
            config: desired,
            reason: `config drift (spec ${actual.specHash} → ${desiredHash})`,
          };
        }
      }
      return { type: 'noop', service: desired.name };
    }

    if (actual.status === 'exited' || actual.status === 'created') {
      return { type: 'start', service: desired.name, containerId: actual.containerId ?? desired.name };
    }

    // Dead or other — recreate
    return {
      type: 'recreate',
      service: desired.name,
      config: desired,
      reason: `status: ${actual.status}`,
    };
  }

  private async createAndStart(desired: ResolvedContainer): Promise<void> {
    // Ensure volumes exist
    for (const vol of desired.volumes) {
      if (!vol.source.startsWith('/') && !vol.source.startsWith('.')) {
        // Named volume
        await createVolume(vol.source);
      }
    }

    // Pull image
    await ensureImage(desired.image);

    // Create container via Docker CLI directly (avoids xec adapter hanging)
    const id = await createContainer(desired);
    this.logger.info({ service: desired.name, containerId: id }, 'Container created');

    // Wait for healthy (skip for non-critical services — they start in background)
    if (desired.critical === false) {
      this.logger.info({ service: desired.name }, 'Non-critical service — skipping health wait');
    } else {
      await this.waitHealthy(desired.name);
    }
  }

  private async waitHealthy(name: string): Promise<void> {
    // Poll Docker health via async CLI — avoids blocking event loop
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < STARTUP_TIMEOUT) {
      try {
        const { stdout } = await execAsync(
          `docker inspect --format='{{.State.Health.Status}}' ${name} 2>/dev/null || echo "none"`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const output = (stdout ?? '').trim().replace(/'/g, '');

        if (output === 'healthy') {
          this.logger.info({ service: name, elapsed: Date.now() - startTime }, 'Service healthy');
          return;
        }
        if (output === 'none' || output === '') {
          const { stdout: statusOut } = await execAsync(
            `docker inspect --format='{{.State.Status}}' ${name} 2>/dev/null || echo "missing"`,
            { encoding: 'utf-8', timeout: 5000 }
          );
          const status = (statusOut ?? '').trim().replace(/'/g, '');
          if (status === 'running') {
            this.logger.info({ service: name, elapsed: Date.now() - startTime }, 'Service running (no health check)');
            return;
          }
          if (status === 'exited' || status === 'dead' || status === 'missing') {
            this.logger.warn({ service: name, status }, 'Container not running');
            return;
          }
        }
      } catch {
        // docker CLI failed — retry
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    this.logger.warn({ service: name, timeout: STARTUP_TIMEOUT }, 'Service did not become healthy within timeout');
  }

  // ===========================================================================
  // Private — Post-Provisioning
  // ===========================================================================

  private async postProvision(): Promise<void> {
    await this.runPresetPostProvisionHooks();
  }

  /**
   * Generic post-provision: iterate all services, call preset hooks.
   * Replaces hardcoded createPostgresDatabases() / createMinioBuckets().
   */
  private async runPresetPostProvisionHooks(): Promise<void> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    // A preset hook is what creates the databases inside Postgres and the
    // buckets inside MinIO — the containers are running either way, so a
    // failure here is invisible until an application cannot find its
    // database.
    //
    // `this.presetRegistry!` asserted a dependency the constructor declares
    // OPTIONAL, so a caller that did not pass one — which the type permits —
    // got `Cannot read properties of undefined (reading 'get')` from a line
    // that reads as internal, after every container was already up.
    // Measured on a node provisioning a stack, where the containers stayed
    // and the databases were never made.
    if (!this.presetRegistry) {
      const withPresets = Object.entries(this.normalizedServices)
        .filter(([, r]) => r._preset)
        .map(([name]) => name);
      if (withPresets.length > 0) {
        this.logger.error(
          { services: withPresets },
          'No preset registry, so post-provision steps were skipped — these services are running but their databases and buckets were not created',
        );
      }
      return;
    }

    for (const [serviceName, requirement] of Object.entries(this.normalizedServices)) {
      if (!requirement._preset) continue;

      const preset = this.presetRegistry.get(requirement._preset);
      if (!preset?.postProvision) continue;

      const container = this.desiredContainers.find((c) => c.name.endsWith(`-${serviceName}`));
      if (!container) continue;

      const cName = container.name;
      await waitForHealthy(cName, 30_000);

      // Resolve secrets from requirement
      const secrets: Record<string, string> = {};
      if (requirement.secrets) {
        for (const [k, v] of Object.entries(requirement.secrets)) {
          secrets[k] = typeof v === 'string' ? v : '';
        }
      }

      const execInCont = async (command: string[]): Promise<string> => {
        const { stdout } = await execFileAsync('docker', ['exec', cName, ...command], {
          encoding: 'utf-8',
          timeout: 10_000,
        });
        return (stdout ?? '').trim();
      };

      try {
        await preset.postProvision({
          containerName: cName,
          userConfig: requirement._presetConfig ?? {},
          secrets,
          execInContainer: execInCont,
          logger: this.logger,
        });
      } catch (err) {
        this.logger.error(
          { service: serviceName, preset: requirement._preset, error: (err as Error).message },
          'Post-provision hook failed'
        );
      }
    }
  }

  // ===========================================================================
  // Private — Omnitron Internal Database
  // ===========================================================================

  /**
   * Provision Omnitron's own PostgreSQL container and run migrations.
   * This database stores logs, metrics, alerts, portal users, deployments, etc.
   */
  private async provisionOmnitronDatabase(): Promise<void> {
    this.logger.info('Provisioning Omnitron internal database (omnitron-pg)');

    // 1. Reconcile the omnitron-pg container
    await this.reconcileService(this.omnitronPgContainer);

    // 2. Wait for healthy
    await waitForHealthy(this.omnitronPgContainer.name, 60_000);

    // 3. Run Kysely migrations
    await this.runOmnitronMigrations();

    this.logger.info('Omnitron internal database provisioned and migrated');
  }

  /**
   * Apply the internal-database schema through the shared runner.
   *
   * This used to be a second, independently-maintained copy of the daemon's
   * migration code that only knew migrations 001–002 — and, like the
   * daemon's copy, it constructed `Migrator` from the `kysely` package root
   * where that export does not exist, so it threw on every run. Both are now
   * one call into `database/migration-runner.ts`.
   *
   * Errors propagate to `provisionOmnitronDatabase`'s caller: provisioning
   * that ends with an unmigrated database has not succeeded.
   */
  private async runOmnitronMigrations(): Promise<void> {
    const { runOmnitronMigrations } = await import('../database/migration-runner.js');
    await runOmnitronMigrations(this.logger);
  }

  // ===========================================================================
  // Private — Health Monitor (Self-Healing)
  // ===========================================================================

  private startHealthMonitor(): void {
    this.healthTimer = setInterval(() => {
      this.healthSweep().catch((err) => {
        this.logger.error({ error: (err as Error).message }, 'Health sweep failed');
      });
    }, RECONCILE_INTERVAL);
    this.healthTimer.unref();
  }

  private stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async healthSweep(): Promise<void> {
    // Include omnitron-pg in health sweep alongside app containers,
    // but skip the stack-prefixed PG when using the global omnitron-pg
    const allContainers = this.usingGlobalOmnitronPg
      ? [...this.desiredContainers]
      : [this.omnitronPgContainer, ...this.desiredContainers];
    for (const desired of allContainers) {
      const actual = await getContainerState(desired.name);

      // T#58: Docker's own `--restart=always` / `--restart=on-failure`
      // policy puts the container into the 'restarting' state for the
      // brief window between exit and re-entry. If we recreate during
      // that window we race Docker's restart — `removeContainer` mid-
      // restart leaves the daemon confused, and the recreated container
      // may end up duplicated under a renamed transient. Let Docker
      // finish; the next 30s tick will see 'running' and skip.
      if (actual?.status === 'restarting') {
        this.logger.debug(
          { service: desired.name },
          "Service is restarting via Docker's own policy — yielding to it (T#58)"
        );
        continue;
      }

      if (!actual || actual.status !== 'running') {
        this.unhealthyTicks.delete(desired.name);

        // Circuit-breaker: while a service is inside its backoff window, skip
        // the restart so a permanently-failing container can't hammer the
        // supervisor every tick and starve the daemon's event loop.
        const backoff = this.restartBackoff.get(desired.name);
        if (backoff && Date.now() < backoff.nextAttemptAt) {
          this.logger.debug(
            { service: desired.name, failures: backoff.failures, retryInMs: backoff.nextAttemptAt - Date.now() },
            'Service not running — in restart backoff, skipping tick'
          );
          continue;
        }

        this.logger.warn(
          { service: desired.name, status: actual?.status ?? 'not_found' },
          'Service not running — auto-restarting'
        );
        try {
          await this.reconcileService(desired);
          this.restartBackoff.delete(desired.name);
        } catch (err) {
          const failures = (this.restartBackoff.get(desired.name)?.failures ?? 0) + 1;
          const backoffMs = restartBackoffMs(failures);
          this.restartBackoff.set(desired.name, { failures, nextAttemptAt: Date.now() + backoffMs });
          this.logger.error(
            { service: desired.name, error: (err as Error).message, failures, backoffMs },
            'Auto-restart failed'
          );
        }
      } else if (actual.health === 'unhealthy') {
        const ticks = (this.unhealthyTicks.get(desired.name) ?? 0) + 1;
        this.unhealthyTicks.set(desired.name, ticks);

        if (ticks < UNHEALTHY_RESTART_THRESHOLD) {
          this.logger.warn(
            { service: desired.name, consecutiveUnhealthy: ticks, threshold: UNHEALTHY_RESTART_THRESHOLD },
            'Service unhealthy — waiting for confirmation before restart'
          );
        } else {
          this.unhealthyTicks.delete(desired.name);
          this.logger.warn(
            { service: desired.name, consecutiveUnhealthy: ticks },
            'Service unhealthy past threshold — restarting container'
          );
          try {
            await removeContainer(desired.name);
            await this.createAndStart(desired);
          } catch (err) {
            this.logger.error(
              { service: desired.name, error: (err as Error).message },
              'Health restart failed'
            );
          }
        }
      } else {
        // Healthy or starting — clear any accumulated unhealthy ticks and
        // reset the restart circuit-breaker (it may have recovered on its own
        // via Docker's restart policy).
        this.unhealthyTicks.delete(desired.name);
        this.restartBackoff.delete(desired.name);
      }

      // Update state
      const newState = await getContainerState(desired.name);
      if (newState) {
        this.state.services[desired.name] = newState;
      }
    }

    this.state.lastReconciled = new Date().toISOString();
  }
}

/**
 * T#76: shallow equality on the fields that drive container
 * identity. Two declarations that differ only in incidental fields
 * (label maps, restart policy adornments) should still be treated
 * as the same shared container; differences in image / env / port
 * mapping legitimately deserve an operator-facing warning.
 */
function shallowContainerEqual(a: ResolvedContainer, b: ResolvedContainer): boolean {
  if (a.image !== b.image) return false;
  if (!sameRecord(a.environment, b.environment)) return false;
  if (a.ports.length !== b.ports.length) return false;
  for (let i = 0; i < a.ports.length; i++) {
    if (a.ports[i]!.host !== b.ports[i]!.host || a.ports[i]!.container !== b.ports[i]!.container) return false;
  }
  if (a.volumes.length !== b.volumes.length) return false;
  for (let i = 0; i < a.volumes.length; i++) {
    if (a.volumes[i]!.source !== b.volumes[i]!.source || a.volumes[i]!.target !== b.volumes[i]!.target) return false;
  }
  return true;
}

function sameRecord(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a?.[k] !== b?.[k]) return false;
  return true;
}
