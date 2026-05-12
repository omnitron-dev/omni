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
import type {
  InfrastructureConfig,
  InfrastructureState,
  ContainerState,
  ResolvedContainer,
  ReconcileAction,
} from './types.js';
import { resolveInfrastructure, resolveOmnitronPg, getManagedNetwork } from './service-resolver.js';
import { PhantomEndpointJanitor } from './phantom-endpoint-janitor.js';
import {
  isDockerAvailable,
  getContainerState,
  createContainer,
  startContainer,
  removeContainer,
  ensureImage,
  waitForHealthy,
  createVolume,
} from './container-runtime.js';

const RECONCILE_INTERVAL = 30_000; // 30s health sweep
const STARTUP_TIMEOUT = 120_000; // 2min max per service
/** Consecutive 'unhealthy' ticks before recreate. 2 ticks @ 30s = 60s grace. */
const UNHEALTHY_RESTART_THRESHOLD = 2;

/** Omnitron internal PG connection defaults */
const OMNITRON_PG_PORT = 5480;
const OMNITRON_PG_USER = 'omnitron';
const OMNITRON_PG_PASSWORD = 'omnitron';
const OMNITRON_PG_DATABASE = 'omnitron';

export class InfrastructureService {
  private readonly desiredContainers: ResolvedContainer[] = [];
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
   * T#75: phantom-endpoint janitor instance. Created in `provision()`
   * once we know Docker is reachable; torn down in `teardown()`.
   */
  private phantomJanitor: PhantomEndpointJanitor | null = null;

  constructor(
    private readonly logger: ILogger,
    private readonly config: InfrastructureConfig,
    normalizedServices?: Record<string, import('./types.js').IServiceRequirement>,
    private readonly presetRegistry?: import('./presets/registry.js').PresetRegistry,
  ) {
    this.normalizedServices = normalizedServices ?? {};
    this.desiredContainers = resolveInfrastructure(config, normalizedServices);
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
    const stackPgName = this.omnitronPgContainer.name;
    const isGlobalPgRunning = globalOmnitronPg?.status === 'running';
    const isStackPgSameAsGlobal = stackPgName === 'omnitron-pg';

    if (isGlobalPgRunning && !isStackPgSameAsGlobal) {
      // Global omnitron-pg already owns port 5480 — reuse it and skip stack-prefixed container.
      this.usingGlobalOmnitronPg = true;
      this.logger.info(
        { global: 'omnitron-pg', stackPg: stackPgName },
        'Using existing omnitron-pg (already running) — skipping stack-prefixed PG'
      );
      // Remove stale stack-prefixed container if it exists (leftover from a previous attempt)
      const stalePg = await getContainerState(stackPgName);
      if (stalePg) {
        try {
          await removeContainer(stackPgName);
          this.logger.info({ service: stackPgName }, 'Removed stale stack-prefixed PG container');
        } catch { /* already gone */ }
      }
    } else if (isGlobalPgRunning) {
      this.usingGlobalOmnitronPg = true;
      this.logger.info('Using existing omnitron-pg (already running)');
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

    // 3. Reconcile each app service
    for (const desired of this.desiredContainers) {
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
    }

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

    this.state.ready = true;
    this.state.lastReconciled = new Date().toISOString();
    this.logger.info('Infrastructure provisioned and healthy');

    return this.state;
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
   * Get connection info for an infrastructure service.
   * Used by config generator to resolve { infra: 'postgres', database: 'main' }.
   */
  getConnectionInfo(service: string): Record<string, unknown> | null {
    switch (service) {
      case 'postgres': {
        const pg = this.config.postgres;
        if (!pg) return null;
        return {
          host: 'localhost',
          port: pg.port ?? 5432,
          user: pg.user ?? 'postgres',
          password: typeof pg.password === 'string' ? pg.password : 'postgres',
        };
      }
      case 'redis': {
        const redis = this.config.redis;
        if (!redis) return null;
        return {
          host: 'localhost',
          port: redis.port ?? 6379,
          password: typeof redis.password === 'string' ? redis.password : undefined,
          databases: redis.databases ?? {},
        };
      }
      case 'minio': {
        const minio = this.config.minio;
        if (!minio) return null;
        return {
          endpoint: `http://localhost:${minio.ports?.api ?? 9000}`,
          accessKey: minio.accessKey ?? 'minioadmin',
          secretKey: typeof minio.secretKey === 'string' ? minio.secretKey : 'minioadmin',
          forcePathStyle: true,
        };
      }
      case 'omnitron-pg':
        return {
          host: 'localhost',
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
      // Check if image changed
      if (actual.image !== desired.image && !actual.image.startsWith(desired.image)) {
        return {
          type: 'recreate',
          service: desired.name,
          config: desired,
          reason: `image changed: ${actual.image} → ${desired.image}`,
        };
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

    for (const [serviceName, requirement] of Object.entries(this.normalizedServices)) {
      if (!requirement._preset) continue;

      const preset = this.presetRegistry!.get(requirement._preset);
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
   * Connect to Omnitron's PG and run migrations via Kysely's built-in Migrator.
   * Uses dynamic import to keep pg/kysely optional until actually needed.
   */
  private async runOmnitronMigrations(): Promise<void> {
    const { Kysely, PostgresDialect, Migrator } = await import('kysely');
    const pg = await import('pg');
    const m001 = await import('../database/migrations/001_initial_schema.js');
    const m002 = await import('../database/migrations/002_metrics_raw.js');

    const pool = new pg.default.Pool({
      host: 'localhost',
      port: OMNITRON_PG_PORT,
      database: OMNITRON_PG_DATABASE,
      user: OMNITRON_PG_USER,
      password: OMNITRON_PG_PASSWORD,
    });

    const db = new Kysely<unknown>({
      dialect: new PostgresDialect({ pool }),
    });

    try {
      const migrator = new Migrator({
        db,
        provider: {
          async getMigrations() {
            return {
              '001_initial_schema': { up: m001.up, down: m001.down },
              '002_metrics_raw': { up: m002.up, down: m002.down },
            };
          },
        },
      });

      const { results, error } = await migrator.migrateToLatest();

      const applied = results?.filter((r) => r.status === 'Success') ?? [];
      if (applied.length > 0) {
        this.logger.info(
          { migrations: applied.map((r) => r.migrationName) },
          `Applied ${applied.length} Omnitron migration(s)`
        );
      } else {
        this.logger.debug('Omnitron database schema is up to date');
      }

      if (error) {
        this.logger.error({ error: String(error) }, 'Migration error');
      }
    } finally {
      await db.destroy();
    }
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
        this.logger.warn(
          { service: desired.name, status: actual?.status ?? 'not_found' },
          'Service not running — auto-restarting'
        );
        try {
          await this.reconcileService(desired);
        } catch (err) {
          this.logger.error(
            { service: desired.name, error: (err as Error).message },
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
        // Healthy or starting — clear any accumulated unhealthy ticks
        this.unhealthyTicks.delete(desired.name);
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
