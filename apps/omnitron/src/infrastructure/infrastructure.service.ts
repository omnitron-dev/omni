import { RecoveryMutation, RecoveryBusyError } from '../daemon/recovery-state.js';
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
import { describeError } from '@omnitron-dev/titan/diagnostics';
import { isDeepStrictEqual } from 'node:util';
import type {
  InfrastructureConfig,
  InfrastructureState,
  ContainerState,
  ResolvedContainer,
  ReconcileAction,
} from './types.js';
import { resolveInfrastructure, resolveOmnitronPg, getManagedNetwork } from './service-resolver.js';
import { ownedContainerId } from './owned-container.js';
import { observeUnhealthy, type UnhealthyEvidence } from './health-recovery.js';
import { normalizeInfraConfig } from './config-normalizer.js';
import { createDefaultRegistry } from './presets/index.js';
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
import { summariseProvisioning, describeProvisioning, retainProvisioningObservation } from './provisioning-outcome.js';
import {
  OMNITRON_PG_PORT,
  OMNITRON_PG_USER,
  OMNITRON_PG_PASSWORD,
  OMNITRON_PG_DATABASE,
} from '../database/connection.js';

const RECONCILE_INTERVAL = 30_000; // 30s health sweep
const STARTUP_TIMEOUT = 120_000; // 2min max per service
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
 * from another machine months later, while `sample-dev-postgres` beside it in
 * `docker ps` was correctly on 127.0.0.1.
 *
 * `reconcileName` is the subtlety. The control-plane database is ONE
 * container per host — it owns port 5480 — but each daemon resolves a name
 * carrying its own project prefix, so a daemon on the `sample/dev` stack
 * computes `sample-dev-pg` while the container that exists is `omnitron-pg`.
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

export interface InfrastructureHandoffState {
  /** Native evidence is separate from desired services and their failure history. */
  nativeState?: { protocol: 1; observations?: Array<{ name: string; containerId: string | null }> };
  retiredStacks?: string[];
  config: InfrastructureConfig;
  containers: ResolvedContainer[];
  normalizedServices: Record<string, import('./types.js').IServiceRequirement>;
  serviceOverrides?: Record<string, import('./types.js').IServiceOverride>;
  state: InfrastructureState;
  usingGlobalOmnitronPg: boolean;
  needsControlPlaneDatabase: boolean;
  monitoring: boolean;
  controlPlaneContainer: ResolvedContainer;
  janitorNetworks: string[];
  unhealthyTicks: Array<[string, number]>;
  /** New readers never treat historical poll counts as native failure evidence. */
  unhealthyEvidence?: Array<[string, UnhealthyEvidence]>;
  restartBackoff: Array<[string, { failures: number; nextAttemptAt: number }]>;
}

export class InfrastructureService {
  private readonly retiredStacks = new Set<string>();
  private desiredContainers: ResolvedContainer[] = [];
  /** What the most recent reconcile did to each service. */
  private readonly lastActions = new Map<string, string>();
  private omnitronPgContainer: ResolvedContainer;
  private usingGlobalOmnitronPg = false;
  private healthTimer: NodeJS.Timeout | null = null;
  private readonly state: InfrastructureState = { services: {}, ready: false };
  private normalizedServices: Record<string, import('./types.js').IServiceRequirement>;

  /** Distinct completed probes and elapsed grace, bound to one native incarnation. */
  private unhealthyEvidence = new Map<string, UnhealthyEvidence>();

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
  private handoffMonitoring = false;
  private janitorNetworks: string[] = [];

  constructor(
    private readonly logger: ILogger,
    private config: InfrastructureConfig,
    normalizedServices?: Record<string, import('./types.js').IServiceRequirement>,
    private readonly presetRegistry?: import('./presets/registry.js').PresetRegistry,
    /**
     * Stack overrides. A service marked `disabled` here is not provisioned,
     * and one pointed at an `external` address is not provisioned either —
     * there is nothing to create, and the address reaches the application
     * through its environment instead.
     */
    private serviceOverrides?: Record<string, import('./types.js').IServiceOverride>,
    /**
     * Whether this daemon stores its own state in Postgres.
     *
     * True for a master, which is where projects, nodes, metrics and logs
     * live. False for a node: its daemon keeps that in SQLite and reads a
     * Postgres never.
     */
    private readonly needsControlPlaneDatabase = true,
  ) {
    this.presetRegistry ??= createDefaultRegistry();
    if (!normalizedServices) {
      normalizedServices = normalizeInfraConfig(config, this.presetRegistry);
    }
    this.normalizedServices = normalizedServices;
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
   * declare `postgres` use the same container", so
   * identical declarations are shared. Conflicting specifications refuse
   * the plan before anything is provisioned.
   */
  @RecoveryMutation()
  addAppContainers(containers: ResolvedContainer[]): void {
    if (this.monitoringRelinquished) throw new Error('Infrastructure monitoring ownership has been relinquished');
    if (this.ownershipFrozen) throw new Error('Infrastructure ownership is frozen');
    for (const c of containers) {
      const existing = this.desiredContainers.find((d) => d.name === c.name);
      if (!existing) {
        this.desiredContainers.push(c);
        continue;
      }
      if (containerSpecHash(existing) !== containerSpecHash(c)) {
        throw new Error(`Conflicting infrastructure declarations for ${c.name}; use one shared specification or distinct service names`);
      }
      // else: identical declaration, silent dedupe — this is the common case
    }
  }

  /**
   * Provision all infrastructure services.
   * Ensures Docker is available, pulls images, creates/starts containers,
   * runs post-provisioning setup, and starts the health monitor.
   */
  @RecoveryMutation()
  async provision(definition?: InfrastructureService): Promise<InfrastructureState> {
    if (this.monitoringRelinquished) throw new Error('Infrastructure monitoring ownership has been relinquished');
    if (this.ownershipFrozen) throw new Error('Infrastructure ownership is frozen');
    if (this.provisioning) {
      if (definition) throw new Error('Infrastructure provisioning is already in progress; retry the new declaration after it finishes');
      return this.provisioning;
    }
    const task = this.provisionDefinition(definition);
    this.provisioning = task;
    try { return await task; }
    finally { if (this.provisioning === task) this.provisioning = undefined; }
  }

  /** Resolve a plan without installing another monitor or changing the current definition. */
  resolveDefinition(
    config: InfrastructureConfig,
    services: Record<string, import('./types.js').IServiceRequirement>,
    overrides?: Record<string, import('./types.js').IServiceOverride>,
  ): InfrastructureService {
    return new InfrastructureService(this.logger, config, services, this.presetRegistry, overrides, this.needsControlPlaneDatabase);
  }

  private async provisionDefinition(definition?: InfrastructureService): Promise<InfrastructureState> {
    const monitored = this.healthTimer !== null;
    this.definitionChanging = true;
    try {
      try {
        // An old sweep must finish before fresh declarations can authorize native work.
        const drained = await Promise.allSettled([...this.activeSweeps, ...this.reconcileTasks.values()]);
        if (drained.some(result => result.status === 'rejected')) throw new Error('In-flight infrastructure reconciliation failed; inspect it before retrying provisioning');
        await this.phantomJanitor?.drain();
        if (definition && this.ownershipFrozen) throw new Error('Infrastructure ownership changed before the new declaration was applied');
        if (definition) this.replaceDefinitionFrom(definition);
        this.state.ready = false;
      } finally {
        this.definitionChanging = false;
      }
      return await this.provisionOwned();
    } finally {
      // Failed Docker admission must not silently abandon previously owned services.
      if (monitored && !this.ownershipFrozen && !this.monitoringRelinquished) {
        this.startHealthMonitor();
        this.phantomJanitor?.start();
      }
    }
  }

  private async provisionOwned(): Promise<InfrastructureState> {
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
        const stalePg = await getContainerState(this.omnitronPgContainer.name, { orThrow: true, fullId: true });
        if (stalePg) {
          await removeContainer(ownedContainerId(this.omnitronPgContainer, stalePg));
          this.logger.info({ service: this.omnitronPgContainer.name }, 'Removed stale stack-prefixed PG container');
        }
      }

      // The same reconcile, and so the same drift check, as every app
      // service — under the name the container actually has. Its data lives
      // in the `omnitron-pg-data` volume and outlives the container it is
      // recreated into.
      // Name AND volume, not one of them. `resolveOmnitronPg` derives both
      // from the container prefix, so overriding only the name produced a
      // container called `omnitron-pg` mounting `sample-dev-pg-data` — the
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
    this.janitorNetworks = [getManagedNetwork()];
    this.phantomJanitor = new PhantomEndpointJanitor({
      networks: this.janitorNetworks,
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
  /** Internal immutable plan. Never expose environment or command values through RPC. */
  getDesiredContainers(): import('./types.js').ResolvedContainer[] {
    return structuredClone(this.desiredContainers);
  }

  getDesiredServices(): ReadonlyArray<{ name: string; image?: string | undefined }> {
    return this.desiredContainers.map((c) => ({ name: c.name, image: c.image }));
  }

  /**
   * Transfer monitoring ownership to a freshly resolved declaration. This never
   * provisions containers: retained specs must match; additions must already be
   * running with exact native ownership and spec labels. Freeze and drain all
   * earlier monitor/reconcile work before acknowledging a handoff.
   */
  @RecoveryMutation()
  async refreshOwnershipFrom(candidate: InfrastructureService): Promise<{ released: string[]; adopted: string[] }> {
    if (this.ownershipFrozen || this.provisioning) throw new Error('Infrastructure ownership refresh or provisioning already in progress');
    this.ownershipFrozen = true;
    try {
      const drained = await Promise.allSettled([...this.activeSweeps, ...this.reconcileTasks.values()]);
      if (drained.some(result => result.status === 'rejected')) throw new Error('In-flight infrastructure reconciliation failed; retry ownership refresh');
      const current = new Map(this.desiredContainers.map(c => [c.name, c]));
      const next = new Map(candidate.desiredContainers.map(c => [c.name, c]));
      if (next.size !== candidate.desiredContainers.length) throw new Error('Duplicate desired container identity');
      const adopted: string[] = [];
      for (const [name, desired] of next) {
        const prior = current.get(name);
        if (prior) {
          if (containerSpecHash(prior) !== containerSpecHash(desired) || !sameRecord(prior.labels, desired.labels)) {
            throw new Error(`Ownership refresh cannot change retained service spec: ${name}`);
          }
          continue;
        }
        const actual = await getContainerState(name);
        const labels = desired.labels;
        if (!labels['omnitron.project'] || !labels['omnitron.stack'] || labels['omnitron.managed'] !== 'true' ||
            actual?.status !== 'running' || actual.networkAttached === false || actual.specHash !== containerSpecHash(desired) ||
            Object.entries(labels).some(([key, value]) => actual.labels?.[key] !== value)) {
          throw new Error(`Cannot adopt service without matching running native ownership and spec: ${name}`);
        }
        adopted.push(name);
      }
      const released = [...current.keys()].filter(name => !next.has(name));
      this.replaceDefinitionFrom(candidate);
      return { released, adopted };
    } finally {
      this.ownershipFrozen = false;
    }
  }

  /** Freeze and drain Docker mutations before another backend takes monitoring ownership. */
  async prepareHandoff(): Promise<InfrastructureHandoffState> {
    if (this.ownershipFrozen) throw new Error('Infrastructure ownership is already frozen');
    this.ownershipFrozen = true;
    this.handoffMonitoring = this.healthTimer !== null;
    try {
      const settled = await Promise.allSettled([...this.activeSweeps, ...this.reconcileTasks.values(), ...(this.provisioning ? [this.provisioning] : [])]);
      if (settled.some(result => result.status === 'rejected')) throw new Error('Infrastructure reconciliation failed while draining');
      await this.phantomJanitor?.drain();
      const observations = await InfrastructureService.validateHandoffContainers(this.desiredContainers,
        this.needsControlPlaneDatabase && !this.usingGlobalOmnitronPg ? this.omnitronPgContainer : undefined,
        this.state, { protocol: 1 });
      this.dispose();
      const snapshot = this.ownershipSnapshot(this.handoffMonitoring);
      snapshot.nativeState = { protocol: 1, observations };
      return snapshot;
    } catch (error) { this.resumeAfterHandoff(); throw error; }
  }

  captureRecoveryState(): InfrastructureHandoffState {
    if (this.ownershipFrozen || this.provisioning || this.activeSweeps.size || this.reconcileTasks.size) {
      throw new RecoveryBusyError('Infrastructure ownership is changing; a recovery snapshot is not ready');
    }
    return this.ownershipSnapshot(this.healthTimer !== null);
  }

  private ownershipSnapshot(monitoring: boolean): InfrastructureHandoffState {
    return structuredClone({
      nativeState: { protocol: 1 as const },
      retiredStacks: [...this.retiredStacks],
      config: this.config, containers: this.desiredContainers, normalizedServices: this.normalizedServices,
      ...(this.serviceOverrides && { serviceOverrides: this.serviceOverrides }),
      state: this.state, usingGlobalOmnitronPg: this.usingGlobalOmnitronPg,
      needsControlPlaneDatabase: this.needsControlPlaneDatabase, monitoring,
      controlPlaneContainer: this.omnitronPgContainer, janitorNetworks: this.janitorNetworks,
      // Protocol1 rollback readers retain the old field but restart their
      // confirmation window; poll counts cannot encode native observations.
      unhealthyTicks: [], unhealthyEvidence: [...this.unhealthyEvidence], restartBackoff: [...this.restartBackoff],
    });
  }

  resumeAfterHandoff(): void {
    if (this.monitoringRelinquished) return;
    this.ownershipFrozen = false;
    if (this.handoffMonitoring) this.startHealthMonitor();
    if (!this.phantomJanitor && this.janitorNetworks.length) {
      this.phantomJanitor = new PhantomEndpointJanitor({ networks: this.janitorNetworks, intervalMs: 60_000, logger: this.logger });
      this.phantomJanitor.start();
    }
    this.handoffMonitoring = false;
  }

  /** Read and validate existing containers. Never provision, start or recreate during adoption. */
  static async adoptHandoff(logger: ILogger, snapshot: InfrastructureHandoffState): Promise<InfrastructureService> {
    await InfrastructureService.validateHandoffContainers(snapshot.containers,
      snapshot.needsControlPlaneDatabase && !snapshot.usingGlobalOmnitronPg ? snapshot.controlPlaneContainer : undefined,
      snapshot.state, snapshot.nativeState);
    const service = new InfrastructureService(logger, snapshot.config, snapshot.normalizedServices,
      undefined, snapshot.serviceOverrides, snapshot.needsControlPlaneDatabase);
    service.desiredContainers = structuredClone(snapshot.containers);
    for (const key of snapshot.retiredStacks ?? []) service.retiredStacks.add(key);
    service.omnitronPgContainer = structuredClone(snapshot.controlPlaneContainer);
    service.janitorNetworks = [...snapshot.janitorNetworks];
    service.unhealthyEvidence = new Map(snapshot.unhealthyEvidence ?? []);
    service.restartBackoff = new Map(snapshot.restartBackoff);
    Object.assign(service.state, structuredClone(snapshot.state));
    service.usingGlobalOmnitronPg = snapshot.usingGlobalOmnitronPg;
    service.handoffMonitoring = snapshot.monitoring;
    service.ownershipFrozen = true;
    return service;
  }

  private static async validateHandoffContainers(containers: ResolvedContainer[], controlPlane: ResolvedContainer | undefined,
    state: InfrastructureState, nativeState?: InfrastructureHandoffState['nativeState']): Promise<Array<{ name: string; containerId: string | null }>> {
    if (nativeState && nativeState.protocol !== 1) throw new Error('Unsupported infrastructure native observation protocol');
    const desiredContainers = [...containers, ...(controlPlane ? [controlPlane] : [])];
    const expected = nativeState?.observations && new Map(nativeState.observations.map(entry => [entry.name, entry.containerId]));
    if (expected && (expected.size !== nativeState!.observations!.length || expected.size !== desiredContainers.length ||
        desiredContainers.some(desired => !expected.has(desired.name)))) throw new Error('Incomplete infrastructure native observations');
    const observations: Array<{ name: string; containerId: string | null }> = [];
    for (const desired of desiredContainers) {
      const actual = await getContainerState(desired.name, { orThrow: true, fullId: true });
      const previous = state.services[desired.name];
      // A failed creation owns no native container. Preserve that failure and
      // its desired declaration; it must not make every backend upgrade fail.
      // Missing previously observed or supposedly running resources still fail
      // closed, as do legacy snapshots without the explicit protocol.
      const failedCreation = nativeState?.protocol === 1 && previous?.status === 'exited' &&
        !previous.containerId && typeof previous.error === 'string' && previous.error.length > 0;
      if (!actual) {
        if (!failedCreation || (expected && expected.get(desired.name) !== null))
          throw new Error(`Infrastructure identity or specification changed during handoff: ${desired.name}`);
        observations.push({ name: desired.name, containerId: null });
        continue;
      }
      // Protocol 1 exported Docker's 12-character display ID. Keep its wire
      // shape for rollback, while comparing a full prior state ID when present.
      const matches = (id: string | null | undefined) => id?.length === 12
        ? actual.containerId?.startsWith(id) : id === actual.containerId;
      if (!actual.containerId || actual.specHash !== containerSpecHash(desired) ||
          (expected && !matches(expected.get(desired.name))) ||
          (previous?.containerId && !matches(previous.containerId)) ||
          Object.entries(desired.labels).some(([key, value]) => actual.labels?.[key] !== value)) {
        throw new Error(`Infrastructure identity or specification changed during handoff: ${desired.name}`);
      }
      observations.push({ name: desired.name, containerId: actual.containerId.slice(0, 12) });
    }
    return observations;
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
   * Release process-owned monitoring resources without changing infrastructure.
   */
  dispose(): void {
    this.stopHealthMonitor();
    // T#75: stop the janitor BEFORE removing containers so a final
    // tick can't race the teardown's `docker rm` and produce noisy
    // disconnect-of-already-disconnected errors.
    if (this.phantomJanitor) {
      this.phantomJanitor.stop();
      this.phantomJanitor = null;
    }

  }

  /** Permanently release this entire observer, preserving every native resource. */
  @RecoveryMutation()
  async relinquishMonitoring(): Promise<string[]> {
    if (this.monitoringRelinquished) return [...this.relinquishedNames];
    if (this.ownershipFrozen) throw new Error('Infrastructure ownership is already frozen');
    this.ownershipFrozen = true;
    this.handoffMonitoring = false;
    this.stopHealthMonitor();
    const settled = await Promise.allSettled([
      ...this.activeSweeps, ...this.reconcileTasks.values(), ...(this.provisioning ? [this.provisioning] : []),
    ]);
    // An already admitted provision may have created its janitor while being
    // drained. Take the current reference only after that actor has completed.
    await this.phantomJanitor?.drain();
    // Rejected tasks are also finished. Their diagnostic remains in the state;
    // relinquishing authority neither retries nor reverses their native work.
    const failed = settled.filter(result => result.status === 'rejected').length;
    if (failed) this.logger.warn({ failed }, 'Infrastructure monitoring released after earlier reconciliation failures');
    this.relinquishedNames = [...new Set([...this.desiredContainers, ...this.controlPlaneContainers()].map(item => item.name))];
    this.monitoringRelinquished = true;
    this.dispose();
    this.janitorNetworks = [];
    return [...this.relinquishedNames];
  }

  /** Stop reconciliation for exactly one allocation, retaining every other scope. */
  @RecoveryMutation()
  async retireStack(scope: { project: string; stack: string }): Promise<void> {
    if (this.monitoringRelinquished) throw new Error('Infrastructure monitoring ownership has been relinquished');
    if (this.ownershipFrozen) throw new Error('Infrastructure ownership is frozen');
    const key = `${scope.project}/${scope.stack}`;
    this.retiredStacks.add(key);
    await Promise.allSettled([...this.activeSweeps, ...this.reconcileTasks.values()]);
    this.desiredContainers = this.desiredContainers.filter(container => this.containerScope(container) !== key);
  }

  resumeStack(scope: { project: string; stack: string }): void {
    if (this.monitoringRelinquished) throw new Error('Infrastructure monitoring ownership has been relinquished');
    if (this.ownershipFrozen) throw new Error('Infrastructure ownership is frozen');
    this.retiredStacks.delete(`${scope.project}/${scope.stack}`);
  }

  private containerScope(container: ResolvedContainer): string {
    return `${container.labels?.['omnitron.project']}/${container.labels?.['omnitron.stack']}`;
  }

  /** Exact names this local infrastructure owner would remove, without exposing credentials in container specs. */
  getTeardownNames(): string[] {
    return [...[...this.desiredContainers].reverse(), ...this.controlPlaneContainers()].map(container => container.name);
  }

  /** Explicit infrastructure removal; process disposal alone preserves containers. */
  @RecoveryMutation()
  async teardown(): Promise<void> {
    if (this.monitoringRelinquished) throw new Error('Infrastructure monitoring ownership has been relinquished');
    if (this.ownershipFrozen) throw new Error('Infrastructure ownership is frozen');
    this.ownershipFrozen = true;
    this.stopHealthMonitor();
    await Promise.allSettled([...this.activeSweeps, ...this.reconcileTasks.values(), ...(this.provisioning ? [this.provisioning] : [])]);
    await this.phantomJanitor?.drain();
    this.dispose();
    // Remove all containers in parallel for fast shutdown — the control-plane
    // database only where this service keeps one (`controlPlaneContainers`).
    const allContainers = [...this.desiredContainers, ...this.controlPlaneContainers()];
    // Validate every target before removing the first. Absence is an idempotent success.
    const reviewed = await Promise.all(allContainers.map(async desired => {
      const actual = await getContainerState(desired.name, { orThrow: true, fullId: true });
      return actual ? ownedContainerId(desired, actual) : null;
    }));

    const results = await Promise.allSettled(
      reviewed.map(async (id, index) => {
        if (!id) return;
        await removeContainer(id, { graceful: true });
        this.logger.info({ service: allContainers[index]!.name }, 'Container removed');
      }),
    );

    this.state.ready = false;
    const failures = results.flatMap((result, index) => result.status === 'rejected'
      ? [new Error(`${allContainers[index]!.name}: ${String(result.reason)}`, { cause: result.reason })] : []);
    if (failures.length) {
      throw new AggregateError(failures, `Infrastructure stop incomplete: ${failures.map(error => error.message).join('; ')}`);
    }
  }

  /**
   * Get current infrastructure state.
   */
  getState(): InfrastructureState {
    return this.state;
  }

  /** Called only after older native work has drained and new observations are held. */
  private replaceDefinitionFrom(candidate: InfrastructureService): void {
    if (candidate.needsControlPlaneDatabase !== this.needsControlPlaneDatabase)
      throw new Error('Infrastructure declaration cannot change control-plane database ownership');
    const next = new Map(candidate.desiredContainers.map(container => [container.name, container]));
    if (next.size !== candidate.desiredContainers.length) throw new Error('Duplicate desired container identity');
    for (const container of this.desiredContainers) {
      const replacement = next.get(container.name);
      if (replacement && !sameRecord(container.labels, replacement.labels))
        throw new Error(`Infrastructure declaration cannot change retained ownership: ${container.name}`);
    }
    const previousServices = this.normalizedServices;
    for (const container of this.desiredContainers) {
      const replacement = next.get(container.name);
      if (!replacement || containerSpecHash(container) !== containerSpecHash(replacement)) {
        delete this.state.services[container.name];
        this.unhealthyEvidence.delete(container.name);
        this.restartBackoff.delete(container.name);
        this.lastActions.delete(container.name);
      }
    }
    this.config = candidate.config;
    this.normalizedServices = candidate.normalizedServices;
    this.serviceOverrides = candidate.serviceOverrides;
    this.desiredContainers = [...candidate.desiredContainers];
    this.invalidateChangedSetup(previousServices);
    this.state.ready = summariseProvisioning(this.desiredContainers, this.state.services).ready;
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

  /** The bucket inventory declared to the same MinIO provisioner. */
  getMinioBuckets(): string[] {
    const buckets = this.normalizedServices['minio']?._presetConfig?.['buckets'] ?? this.config.minio?.buckets;
    if (buckets === undefined) return [];
    if (!Array.isArray(buckets) || buckets.some(bucket => typeof bucket !== 'string'))
      throw new Error('Invalid declared MinIO bucket inventory');
    return [...new Set(buckets as string[])];
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
        const name = this.getResolvedContainerName('minio');
        const resolved = this.desiredContainers.find(container => container.name === name);
        if (!resolved && !minio) return null;
        // Use the provisioner's resolved specification for both declaration forms.
        // Reading only legacy `minio` loses credentials when `services.minio` overrides it.
        return {
          endpoint: `http://${LOCAL_INFRA_HOST}:${resolved?.ports.find(port => port.container === 9000)?.host ?? minio?.ports?.api ?? 9000}`,
          accessKey: resolved?.environment['MINIO_ROOT_USER'] ?? minio?.accessKey ?? 'minioadmin',
          secretKey: resolved?.environment['MINIO_ROOT_PASSWORD'] ?? (typeof minio?.secretKey === 'string' ? minio.secretKey : 'minioadmin'),
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
  private readonly reconcileTasks = new Map<string, Promise<void>>();
  private readonly activeSweeps = new Set<Promise<void>>();
  private ownershipFrozen = false;
  private definitionChanging = false;
  private monitoringRelinquished = false;
  private provisioning: Promise<InfrastructureState> | undefined;
  private relinquishedNames: string[] = [];


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
  @RecoveryMutation()
  setConfigRoots(
    roots: Map<string, string>,
    staticRoots: Map<string, string>,
    redis: { host: string; port: number; db: number; password?: string },
    /**
     * The static ROOT per service, when the delivery made a
     * `current-<project>-<stack>` link inside it. Given, the gateway mounts
     * the root and serves through the link — a path that does not change from
     * one release to the next, so the container is not recreated and the
     * second of 000 a deployment cost goes with it. Empty, everything below
     * resolves exactly as before.
     */
    staticLinkRoots?: Map<string, string>,
  ): void {
    if (roots.size === 0) return;
    this.desiredContainers = resolveInfrastructure(
      this.config,
      this.normalizedServices,
      this.serviceOverrides,
      roots,
      { redis, staticRoots, ...(staticLinkRoots && { staticLinkRoots }) },
    );
  }

  private reconcileService(desired: ResolvedContainer): Promise<void> {
    return this.withContainerReconciliation(desired, () => this.reconcileServiceLocked(desired));
  }

  private async withContainerReconciliation(desired: ResolvedContainer, operation: () => Promise<void>): Promise<void> {
    // T#58: per-name lock around the whole inspect→decide→act loop.
    if (this.ownershipFrozen || this.definitionChanging || this.retiredStacks.has(this.containerScope(desired)) || this.reconciling.has(desired.name)) {
      this.logger.debug({ service: desired.name }, 'Reconcile already in flight — skipping');
      return;
    }
    this.reconciling.add(desired.name);
    try {
      const task = operation();
      this.reconcileTasks.set(desired.name, task);
      await task;
    } finally {
      this.reconciling.delete(desired.name);
      this.reconcileTasks.delete(desired.name);
    }
  }

  @RecoveryMutation()
  private async reconcileServiceLocked(desired: ResolvedContainer): Promise<void> {
    const actual = await getContainerState(desired.name, { orThrow: true, fullId: true });
    if (this.ownershipFrozen || this.definitionChanging || this.retiredStacks.has(this.containerScope(desired))) return;

    const id = actual && ownedContainerId(desired, actual);
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
        await startContainer(id!);
        await this.waitHealthy(id!);
        break;

      case 'recreate':
        this.logger.info(
          { service: desired.name, reason: action.reason },
          'Recreating service'
        );
        await removeContainer(id!);
        await this.createAndStart(desired);
        break;

      case 'remove':
        await removeContainer(action.containerId);
        break;
      default:
        break;
    }

    // Update state
    const newState = await getContainerState(desired.name, { orThrow: true, fullId: true });
    if (newState) {
      this.recordContainerObservation(desired, newState);
    }
  }

  @RecoveryMutation()
  private async recoverUnhealthyLocked(desired: ResolvedContainer, actual: ContainerState, previous: UnhealthyEvidence | undefined): Promise<void> {
    // Recheck immediately before destruction: queued polls, recovery and
    // replacement while inspecting must not authorize a stale decision.
    const confirmed = await getContainerState(desired.name, { orThrow: true, fullId: true });
    if (this.ownershipFrozen || this.definitionChanging || this.retiredStacks.has(this.containerScope(desired))) return;
    if (!confirmed || confirmed.containerId !== actual.containerId || confirmed.startedAt !== actual.startedAt ||
        Date.parse(confirmed.healthCheck?.completedAt ?? '') < Date.parse(actual.healthCheck!.completedAt) ||
        !observeUnhealthy(previous, confirmed, Date.now()).restart) {
      this.unhealthyEvidence.delete(desired.name);
      this.logger.info({ service: desired.name }, 'Health recovery decision changed before restart; keeping the container');
    } else {
      this.unhealthyEvidence.delete(desired.name);
      const failures = (this.restartBackoff.get(desired.name)?.failures ?? 0) + 1;
      const backoffMs = restartBackoffMs(failures);
      // Count attempts until an observed healthy container recovers.
      // A successful create alone cannot erase repeated health failure.
      this.restartBackoff.set(desired.name, { failures, nextAttemptAt: Date.now() + backoffMs });
      this.logger.warn({ service: desired.name, nativeCheck: confirmed.healthCheck, failures, backoffMs },
        'Confirmed sustained native health failure — restarting container');
      try {
        await removeContainer(ownedContainerId(desired, confirmed));
        await this.createAndStart(desired);
      } catch (err) {
        this.logger.error({ service: desired.name, error: describeError(err, 0, Object.values(desired.environment)), failures, backoffMs },
          'Health restart failed; recovery backoff retained');
      }
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
      // A container that is not running still carries the spec it was created
      // with, and `start` runs THAT spec. The drift checks above were only
      // asked of a running container, so one created wrong was started wrong
      // for as long as it existed: Nominatim on sample/test, created at 05:37
      // with a mount the master had not rewritten, was «started» by every
      // reconcile after the fix that corrected its desired spec — «exec:
      // /opt/nominatim-tools/cis-entrypoint.sh: no such file» each time
      // (2026-09-25). Same questions, same answers, before it is started.
      if (actual.image !== desired.image && !actual.image.startsWith(desired.image)) {
        return {
          type: 'recreate',
          service: desired.name,
          config: desired,
          reason: `image changed while stopped: ${actual.image} → ${desired.image}`,
        };
      }
      if (actual.specHash) {
        const desiredHash = containerSpecHash(desired);
        if (actual.specHash !== desiredHash) {
          return {
            type: 'recreate',
            service: desired.name,
            config: desired,
            reason: `config drift while ${actual.status} (spec ${actual.specHash} → ${desiredHash})`,
          };
        }
      }
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
      await this.waitHealthy(id);
    }
  }

  private async waitHealthy(name: string): Promise<void> {
    // Poll Docker health via async CLI — avoids blocking event loop
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const inspect = promisify(execFile);
    const startTime = Date.now();
    while (Date.now() - startTime < STARTUP_TIMEOUT) {
      try {
        const { stdout } = await inspect('docker', ['inspect', '--format', '{{json .State}}', '--', name],
          { encoding: 'utf8', timeout: 5000 });
        const state = JSON.parse(stdout) as { Status: string; Health?: { Status: string } };
        if (state.Health?.Status === 'healthy' || (state.Status === 'running' && (!state.Health || state.Health.Status === 'none'))) return;
        if (state.Status === 'exited' || state.Status === 'dead') {
          this.logger.warn({ service: name, status: state.Status }, 'Container not running');
          return;
        }
      } catch {
        // docker CLI failed — retry
      }
      await new Promise((r) => setTimeout(r, 2000));
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
  private requiresPostProvision(desired: ResolvedContainer): boolean {
    const requirement = this.normalizedServices[desired.labels['omnitron.service'] ?? ''];
    if (!requirement?._preset) return false;
    const preset = this.presetRegistry?.get(requirement._preset);
    return !preset || Boolean(preset.postProvision);
  }

  private recordContainerObservation(desired: ResolvedContainer, actual: ContainerState): void {
    this.state.services[desired.name] = retainProvisioningObservation(actual, this.state.services[desired.name], this.requiresPostProvision(desired));
  }

  private invalidateChangedSetup(previous: typeof this.normalizedServices): void {
    for (const container of this.desiredContainers) {
      const name = container.labels['omnitron.service'] ?? '';
      const state = this.state.services[container.name];
      if (state && this.requiresPostProvision(container) && !isDeepStrictEqual(previous[name], this.normalizedServices[name])) {
        state.provisioning = 'pending';
        state.error = 'Declared service setup changed and must be verified';
        this.state.ready = false;
      }
    }
  }

  private async runPresetPostProvisionHooks(only?: ResolvedContainer): Promise<void> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    for (const [serviceName, requirement] of Object.entries(this.normalizedServices)) {
      if (!requirement._preset) continue;
      const preset = this.presetRegistry?.get(requirement._preset);
      if (preset && !preset.postProvision) continue;
      const container = this.desiredContainers.find((c) => c.labels['omnitron.service'] === serviceName);
      if (!container || (only && container.name !== only.name)) continue;

      // Resolve secrets from requirement
      const secrets: Record<string, string> = {};
      if (requirement.secrets) {
        for (const [k, v] of Object.entries(requirement.secrets)) {
          secrets[k] = typeof v === 'string' ? v : '';
        }
      }

      const safeError = (error: unknown): string => describeError(error, 0, Object.values(secrets));

      try {
        const actual = await getContainerState(container.name, { orThrow: true, fullId: true });
        if (!actual) throw new Error('Declared service container is absent');
        const cName = ownedContainerId(container, actual);
        this.state.services[container.name] = { ...actual, provisioning: 'pending', error: 'Declared service setup is in progress' };
        if (!preset) throw new Error(`Preset '${requirement._preset}' is unavailable; declared service setup cannot be verified`);
        if (!await waitForHealthy(cName, 30_000)) throw new Error('Container did not become healthy before declared service setup');
        await preset.postProvision!({
          containerName: container.name,
          userConfig: requirement._presetConfig ?? {},
          secrets,
          execInContainer: async command => {
            try {
              const { stdout } = await execFileAsync('docker', ['exec', cName, ...command], { encoding: 'utf-8', timeout: 10_000 });
              return (stdout ?? '').trim();
            } catch (error) {
              // Raw subprocess causes include credential arguments. Preserve only the sanitized cause.
              // eslint-disable-next-line preserve-caught-error
              throw new Error('Declared service setup command failed', { cause: safeError(error) });
            }
          },
          logger: this.logger,
        });
        const confirmed = await getContainerState(container.name, { orThrow: true, fullId: true });
        if (!confirmed || confirmed.status !== 'running' || confirmed.health === 'unhealthy' ||
            confirmed.containerId !== actual.containerId || confirmed.startedAt !== actual.startedAt)
          throw new Error('Container generation changed during declared service setup');
        this.state.services[container.name] = { ...confirmed, provisioning: 'ready' };
      } catch (err) {
        const error = `Post-provisioning '${serviceName}': ${safeError(err)}`;
        this.state.services[container.name] = {
          ...(this.state.services[container.name] ?? { name: container.name, image: container.image, status: 'not_found' }),
          provisioning: 'failed', error,
        };
        this.logger.error(
          { service: serviceName, preset: requirement._preset, error },
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
    if (this.monitoringRelinquished || this.ownershipFrozen || this.healthTimer) return;
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

  /**
   * The control-plane database container this service keeps, if any: none on
   * a node — it keeps its own state in SQLite (`decideControlPlaneDatabase`) —
   * and none where the global `omnitron-pg` serves.
   *
   * `provision()` asked `needsControlPlaneDatabase`; the health sweep and the
   * teardown asked only `usingGlobalOmnitronPg`. So on a node the sweep found
   * `<prefix>-pg` «not running» every 30 s and created it: sample/test got one on
   * 2026-09-20, and again on 2026-09-25 forty seconds after it was removed —
   * on the default credentials, for a database nothing reads.
   */
  private controlPlaneContainers(): ResolvedContainer[] {
    return this.needsControlPlaneDatabase && !this.usingGlobalOmnitronPg ? [this.omnitronPgContainer] : [];
  }

  private async healthSweep(): Promise<void> {
    if (this.ownershipFrozen || this.provisioning || this.activeSweeps.size) return;
    const task = this.healthSweepOwned();
    this.activeSweeps.add(task);
    try { await task; } finally { this.activeSweeps.delete(task); }
  }

  private async healthSweepOwned(): Promise<void> {
    // The control-plane database alongside the app containers, where this
    // service keeps one.
    const allContainers = [...this.controlPlaneContainers(), ...this.desiredContainers];
    for (const desired of allContainers) {
      const actual = await getContainerState(desired.name, { orThrow: true, fullId: true });
      if (this.ownershipFrozen || this.definitionChanging) return;
      if (this.retiredStacks.has(this.containerScope(desired))) continue;

      // T#58: Docker's own `--restart=always` / `--restart=on-failure`
      // policy puts the container into the 'restarting' state for the
      // brief window between exit and re-entry. If we recreate during
      // that window we race Docker's restart — `removeContainer` mid-
      // restart leaves the daemon confused, and the recreated container
      // may end up duplicated under a renamed transient. Let Docker
      // finish; the next 30s tick will see 'running' and skip.
      if (actual?.status === 'restarting') {
        this.unhealthyEvidence.delete(desired.name);
        this.logger.debug(
          { service: desired.name },
          "Service is restarting via Docker's own policy — yielding to it (T#58)"
        );
        continue;
      }

      if (!actual || actual.status !== 'running') {
        this.unhealthyEvidence.delete(desired.name);

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
        const previous = this.unhealthyEvidence.get(desired.name);
        const observation = observeUnhealthy(previous, actual, Date.now());
        if (observation.evidence) this.unhealthyEvidence.set(desired.name, observation.evidence);
        else this.unhealthyEvidence.delete(desired.name);
        const backoff = this.restartBackoff.get(desired.name);
        if (backoff && Date.now() < backoff.nextAttemptAt) {
          this.logger.debug({ service: desired.name, retryInMs: backoff.nextAttemptAt - Date.now() },
            'Service unhealthy — recovery backoff remains active');
        } else if (!observation.restart) {
          this.logger.warn(
            { service: desired.name, reason: observation.reason, nativeCheck: actual.healthCheck },
            'Service unhealthy — waiting for confirmed native failure'
          );
        } else {
          await this.withContainerReconciliation(desired, () => this.recoverUnhealthyLocked(desired, actual, previous));
        }
      } else {
        // A starting container is not evidence of recovery. Retain backoff
        // until a running container is healthy (or declares no native probe).
        this.unhealthyEvidence.delete(desired.name);
        if ((actual.health === 'healthy' || actual.health === 'none') && this.state.services[desired.name]?.provisioning !== 'failed') this.restartBackoff.delete(desired.name);
      }

      // Update state
      const newState = await getContainerState(desired.name, { orThrow: true, fullId: true });
      if (newState) {
        this.recordContainerObservation(desired, newState);
        const state = this.state.services[desired.name]!;
        if (state.status === 'running' && state.health !== 'unhealthy' &&
            (state.provisioning === 'pending' || state.provisioning === 'failed') &&
            Date.now() >= (this.restartBackoff.get(desired.name)?.nextAttemptAt ?? 0)) {
          await this.runPresetPostProvisionHooks(desired);
          if (this.state.services[desired.name]?.provisioning === 'ready') {
            if (this.state.services[desired.name]?.health === 'healthy' || this.state.services[desired.name]?.health === 'none') this.restartBackoff.delete(desired.name);
          } else {
            const failures = (this.restartBackoff.get(desired.name)?.failures ?? 0) + 1;
            this.restartBackoff.set(desired.name, { failures, nextAttemptAt: Date.now() + restartBackoffMs(failures) });
          }
        }
      }
    }

    this.state.ready = summariseProvisioning(this.desiredContainers, this.state.services).ready;
    this.state.lastReconciled = new Date().toISOString();
  }
}

function sameRecord(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a?.[k] !== b?.[k]) return false;
  return true;
}
