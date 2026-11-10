import { readProjectStacks, resolveProjectStacks } from '../config/project-stacks.js';
import { readSavedDaemonConfig } from '../config/saved.js';
import { observeStackHealth, type HealthAnswers } from '../project/stack-health.js';
import { LocalReleaseSelection } from '../project/local-release-selection.js';
import { resolveAppPath } from '../config/app-path.js';
import { infrastructureOwnership, ownsStackInfrastructure } from '../project/infrastructure-ownership.js';
import { InstalledStackResume, resumeDestinations, type InstalledResumeExecution, type InstalledResumeRequest, type InstalledResumeReceipt, type ResumeDestination } from '../project/installed-stack-resume.js';
import type { InstalledStackResumeResult, StackStopProgress } from '../shared/dto/project.js';
import type { ClusterPermit, StackEffectPlan } from '../cluster/stop-authority.js';
import { isDeepStrictEqual } from 'node:util';
import { diagnoseContainers } from '../project/stack-diagnosis.js';
import { diagnosisStatus, type StackDiagnosis, type StackDiagnosisCheck } from '../shared/dto/stack-diagnosis.js';
import { buildInfraFromRequirements, requirementsFromDefinitions } from '../project/requirements-scanner.js';
import { randomUUID } from 'node:crypto';
import { NodeStackStop, stackDefinitionFingerprint, type NodeStackStopExecution, type NodeStackStopRequest, type NodeStackStopPlan, type NodeStackStopInventory, type NodeStackStopReceipt } from '../project/node-stack-stop.js';
import { stackStopReview, type StopReviewTarget } from '../project/stack-stop-review.js';
import type { StopPermit, StopRecipient } from '../cluster/stop-authority.js';
import type { LeaderElection } from '../cluster/leader-election.js';
import { inspectStackContainers, removeContainer } from '../infrastructure/container-runtime.js';
import { stackExecutionKey, type StackExecutionPlan, type StackExecutionScope } from '../shared/dto/stack-execution.js';
import { publicStack } from '../project/public-stack.js';
import { TopologyStateStore } from '../project/topology-state.js';
import { TopologyControl } from '../project/topology-control.js';
import { artifactVolumeBindings, artifactVolumeEntries, bindArtifactVolumes } from '../release/artifact-volumes.js';
import { mergeInfrastructure, mergeInferredInfrastructure } from '../infrastructure/merge-config.js';
export { mergeInfrastructure } from '../infrastructure/merge-config.js';
import type { TopologyScope, TopologySpec, TopologyPlan, TopologyWorkspace } from '../shared/dto/topology.js';
import { currentActor, describeFailure } from './audit.service.js';
import { publicLaunchFailure } from '../project/launch-failure.js';
import { nodeApplicationNames, resolveNodePlacements, stackNodeKey } from '../project/stack-placement.js';
import { StackTargets, type StackTarget } from '../project/stack-targets.js';
import { configurationInfo, publicStackName, validateConfigurationNames, type ConfigurationImport, type RuntimeStackScope } from '../project/configuration-catalog.js';
import { nodePlacement, observeStack } from '../project/stack-observation.js';
import { getCachedBootstrapDefinition } from '../orchestrator/bootstrap-loader.js';
import { BootstrapMetadataStore, readBootstrapMetadata, metadataSourceChanged, TOPOLOGY_REFRESH_TIMEOUT_MS } from '../project/bootstrap-metadata.js';
import { appDependencies } from '../project/dependency-topology.js';
import { isControlPlaneWorkspace } from '../project/workspace-kind.js';
import { RecoveryMutation, RecoveryBusyError } from '../daemon/recovery-state.js';
/**
 * ProjectService — Manages projects and their stacks
 *
 * Wraps ProjectRegistry with stack lifecycle management.
 * DI-managed singleton — resolves via PROJECT_SERVICE_TOKEN.
 *
 * Architecture:
 * - Projects are monorepos with omnitron.config.ts
 * - Each project has multiple stacks (dev, test, prod)
 * - Stacks run simultaneously — starting one does not affect others
 * - Each stack has its own namespace: project/stack/app
 * - Remote/cluster stacks have slave daemons that collect data locally
 *   and sync to master when connectivity is available
 */

import fs from 'node:fs';
import path from 'node:path';
import { LOGGER_SERVICE_TOKEN, type ILogger, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { AUDIT_SERVICE_TOKEN, DAEMON_STATE_STORE_TOKEN, ORCHESTRATOR_TOKEN, SECRETS_SERVICE_TOKEN } from '../shared/tokens.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { SecretsService } from './secrets.service.js';
import { gatewayStaticLinkName } from './static-carry-forward.js';
import type { AuditService } from './audit.service.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { ProjectRegistry } from '../project/registry.js';
import { describeWorkingTrees, refusalForDirtyTree } from '../project/working-tree.js';
import { reportPhases, type DeployPhases } from '../project/deploy-phases.js';

/** What a remote deployment actually reached, for the row that records it. */
interface NodeReach {
  readonly nodes: number;
  readonly reached: number;
  readonly skipped: readonly string[];
  /** Nodes that took it with infrastructure not up: `host:port: <the node's words>`. */
  readonly notReady: readonly string[];
}
import type { OrchestratorControl as OrchestratorService } from '../orchestrator/execution-contract.js';
import { effectiveAppName } from '../orchestrator/orchestrator.service.js';
import type {
  IEcosystemConfig,
  IEcosystemAppEntry,
  IStackConfig,
  ISeedProject,
  DaemonRole,
  IAppDefinition,
  AppStatus,
  OmnitronAppConfig,
} from '../config/types.js';
import type { InfrastructureConfig, IServiceRequirement, PostgresDatabaseConfig } from '../infrastructure/types.js';
import type {
  IProjectInfo,
  IStackInfo,
  StackRuntime,
  StackStatus,
  IStackNodeStatus,
  IStackAppStatus,
  IStackInfraStatus,
  IProjectRequirements,
  ISyncStatus,
} from '../shared/dto/project.js';
import { summariseSync } from './sync-summary.js';
import { StackInfrastructureManager } from '../infrastructure/stack-infra-manager.js';
import { describeProvisioning, summariseProvisioning, stackServiceObservation } from '../infrastructure/provisioning-outcome.js';
import { waitForPostgres } from './wait-for-postgres.js';
import { resolveStack, resolvedConfigToEnv } from '../project/config-resolver.js';
import { resolveStartupOrder } from '../orchestrator/dependency-resolver.js';
import { SlaveConnector } from '../cluster/slave-connector.js';
import { staleBuild } from './bundle-builder.js';
import { NODE_STACK } from '../project/node-app-config.js';
import { overlayCredentials } from '../infrastructure/node-credentials.js';
import { readDeclaredConfig, withDeclaredConfig } from '../project/declared-config.js';
import { bindService } from '../infrastructure/service-binding.js';
import {
  RemoteDeployer,
  stackNodeToDeployTarget,
  withNodeCredentials,
  withDeploymentProgress,
  type DeployTarget,
  type DeployProgressRecord,
} from './remote-deployer.service.js';
import { withNodeLeases } from './node-deploy-lease.js';
import { readDeploymentProgress } from '../shared/release-reading.js';
import { DEFAULT_MAINTENANCE_TIMING, MaintenanceLock } from './maintenance-lock.js';
import { gatewayRedisDb } from '../infrastructure/gateway-redis-db.js';

/**
 * What a deployment asks through the gateway before it lets the platform go:
 * the portal's page and main's health. Each app already passed its own health
 * check inside the deployment; these prove the path a person's request takes.
 */
const MAINTENANCE_PROBE_PATHS = ['/', '/api/main/health'] as const;
import { migrationOutput } from './migration-output.js';
import { redactDiagnosticText } from '@omnitron-dev/titan/diagnostics';
import { COMPILED_MIGRATION_ENTRY, localMigrationTargets, requestedMigrations, migrationDatabaseEnvironment, validateMigrationDestinations, validateMigrationOwners, orderMigrationPlacements, type MigrationRequiredFiles, type VerifyMigrationEntries } from './migration-target.js';
import { executeLocalMigration } from './migration-process.js';
import { expandServiceDeclarations, normalizeInfraConfig } from '../infrastructure/config-normalizer.js';
import { createDefaultRegistry } from '../infrastructure/presets/index.js';
import type { LoadedRelease } from '../release/load.js';
import { readArchiveInfrastructure } from '../release/infrastructure.js';
import { releaseArtifactOrigins } from '../release/origin.js';
import type { DeclaredConfig } from '../project/declared-config.js';

import type { SyncService } from './sync.service.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { InfrastructureHealthContext } from '../monitoring/infrastructure-health.js';
import { ExecutionService, type SSHTarget } from '../execution/execution.service.js';

type AdmittedRelease = LoadedRelease & { readonly remoteDefinitions?: Map<string, IAppDefinition> };

class LocalReleaseStopRequired extends Error {}

function sameLaunchCode(actual: IEcosystemAppEntry, expected: IEcosystemAppEntry): boolean {
  if (!expected.releaseRoot) return !actual.releaseRoot;
  return actual.bootstrap === expected.bootstrap && actual.script === expected.script && actual.releaseRoot === expected.releaseRoot;
}

/** Whether two paths name one directory — symlinks and `..` resolved. */
function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return fs.realpathSync(path.resolve(p));
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}


// =============================================================================
// Config Registry — holds loaded configs per project
// =============================================================================

interface LoadedProject {
  config: IEcosystemConfig;
  loadedAt: number;
}

// =============================================================================
// Stack Runtime State
// =============================================================================

interface StackRuntimeState {
  project: string;
  stack: string;
  status: StackStatus;
  config: IStackConfig;
  /**
   * When this daemon started the stack — or, for a remote one, deployed it
   * or attached to it. For a remote stack that is NOT when its applications
   * started (`askNodes` reads that from the nodes); `toStackInfo` reports it
   * as `attachedAt`.
   */
  startedAt: number | null;
  /** InfrastructureService instance for this stack (local stacks only) */
  infraService: InfrastructureService | null;
  appStartErrors?: Record<string, string>;
  infrastructureStartFailed?: boolean;
}

/**
 * Who asked for this stack to start.
 *
 * Three callers reach `startStack`, and only one of them is a person: the
 * RPC surface an operator (or the CLI, or an MCP tool) goes through, the
 * boot resume, and the reconciler that retries an enabled stack after the
 * daemon restarts. The audit row carries this so «last deployment» stops
 * meaning «last deployment a human typed».
 */
export type StackStartSource = 'operator' | 'boot' | 'auto-resume' | 'unknown';

/**
 * What a stack start has learned about itself so far — what its audit row
 * can say if it ends in a throw. Filled in by `runStackStart` as it goes and
 * read by `startStackOnce`, which is the one place every ending passes.
 */
interface StackStartKnown {
  /** A restart re-attaching a remote stack: it deploys nothing and writes no row. */
  attach: boolean;
  type?: IStackConfig['type'];
  release?: string;
  /** The project tree's commit once it was read; `null` when it could not be. */
  commit?: string | null;
}

// =============================================================================
// ProjectService
// =============================================================================

/**
 * The stack's frontend could not be put on a node, twice.
 *
 * Its own class because it ends the deployment where every other failure to
 * bring up a node's infrastructure is logged and deployed past: nothing on
 * the node has changed yet, and a deployment that continued would recreate
 * the gateway without a web root — see `shipStackStatics`.
 */
export class FrontendNotDeliveredError extends Error {
  constructor(host: string, cause: string) {
    super(
      `The frontend could not be delivered to ${host} (two attempts): ${cause.slice(0, 400)}. ` +
        'Nothing on the node was changed — its gateway keeps serving the frontend it had.',
    );
    this.name = 'FrontendNotDeliveredError';
  }
}

/**
 * Where an on-node attestation's probes got the accounts they sign in with.
 *
 *   provisioned      the stack allows it and the release's producer can: the
 *                    run created them and removed them (`--provision`);
 *   not-declared     the stack does not declare `release.attest.provision`;
 *   producer-cannot  it does, and the release was built before its producer
 *                    knew the flag.
 *
 * In the latter two the probes that need a signed-in person say NOT RUN,
 * which is their floor — and the answer says why, so a reader does not look
 * for the cause in the release.
 */
export type AttestAccounts = 'provisioned' | 'not-declared' | 'producer-cannot';

/** What `ProjectService` takes beyond its three required collaborators. */
export interface ProjectServiceOptions {
  /** Master-owned artifact store. Thin nodes only consume the installed release selected by their controller. */
  readonly receiveRelease?: (id: string, root: string) => Promise<void>;
  /** Slave→master replication, handed to the lazily built mesh connector. */
  readonly syncService?: SyncService;
  /**
   * The vault, for the secrets a stack's service overrides name. Without it
   * the references travel unresolved and say so.
   */
  readonly secrets?: import('./secrets.service.js').SecretsService;
  /**
   * The audit trail, for the one fact an operator asks this service about
   * afterwards: what was deployed and when.
   *
   * Taken HERE rather than left to the RPC layer because the RPC layer is not
   * the only caller. Measured on 2026-09-21: `omnitron audit` knew about one
   * deployment of `sample/test` in twenty-four hours; the daemon log knew about
   * eight. The seven it missed were the boot resume and the reconciler, both
   * of which call `startStack` directly — so the trail recorded the
   * deployments a human typed and none of the ones the daemon decided on,
   * which is the wrong half to have.
   */
  readonly audit?: import('./audit.service.js').AuditService;
}

/** The services whose credentials a node generates, and a deployment reads back from it. */
const CREDENTIALED_SERVICES = ['postgres', 'redis', 'minio'] as const;

export class ProjectService extends EventEmitter {
  recoveryRegistryDigest(): string { return this.registry.recoveryDigest(); }
  /** Read-only bookkeeping; no timers are stopped and no Docker call runs. */
  captureRecoveryState(): Awaited<ReturnType<ProjectService['prepareHandoff']>> {
    if (this.rereading?.size || this.ownershipFrozen || this.resumingInstalled || this.startsInFlight.size || this.stopsInFlight.size || this.nodeStackStop.busy || this.reconcilingStacks ||
        [...this.stackStates.values()].some(state => state.status === 'starting' || state.status === 'stopping')) {
      throw new RecoveryBusyError('Project ownership is changing; a recovery snapshot is not ready');
    }
    return this.projectSnapshot(this.infraManager.captureRecoveryState(), this.resumeTimer !== null);
  }

  private projectSnapshot(
    infrastructure: Awaited<ReturnType<StackInfrastructureManager['prepareHandoff']>>, reconciling: boolean,
  ): Awaited<ReturnType<ProjectService['prepareHandoff']>> {
    return structuredClone({
      projects: [...this.configRegistry], infrastructure,
      bootstrapTopology: [...this.bootstrapTopology],
      resumeBackoff: [...this.resumeBackoff], reconciling,
      stacks: [...this.stackStates].map(([key, { infraService: _infra, ...state }]) => [key, state] as [string, Omit<StackRuntimeState, 'infraService'>]),
    });
  }

  /** Capture controllers' bookkeeping, retaining native application ownership in the execution host. */
  async prepareHandoff(): Promise<{
    bootstrapTopology?: Array<[string, Pick<IAppDefinition, 'requires' | 'omnitronConfig'>]>;
    projects: Array<[string, LoadedProject]>;
    stacks: Array<[string, Omit<StackRuntimeState, 'infraService'>]>;
    infrastructure: Awaited<ReturnType<StackInfrastructureManager['prepareHandoff']>>;
    resumeBackoff: Array<[string, { nextAt: number; delayMs: number }]>;
    reconciling: boolean;
  }> {
    if (this.rereading?.size || this.ownershipFrozen || this.resumingInstalled || this.startsInFlight.size || this.stopsInFlight.size || this.nodeStackStop.busy || this.reconcilingStacks || [...this.stackStates.values()].some(state => state.status === 'starting' || state.status === 'stopping')) {
      throw new Error('A stack lifecycle operation is active; finish it before transferring the backend');
    }
    this.handoffReconciling = this.resumeTimer !== null;
    this.ownershipFrozen = true;
    if (this.resumeTimer) clearInterval(this.resumeTimer);
    this.resumeTimer = null;
    try {
      const infrastructure = await this.infraManager.prepareHandoff();
      return this.projectSnapshot(infrastructure, this.handoffReconciling);
    } catch (error) { this.resumeAfterHandoff(); throw error; }
  }

  resumeAfterHandoff(): void {
    this.ownershipFrozen = false;
    this.infraManager.resumeAfterHandoff();
    if (this.handoffReconciling) this.startEnabledStacksReconciler();
    this.handoffReconciling = false;
  }

  async adoptHandoff(snapshot: Awaited<ReturnType<ProjectService['prepareHandoff']>>): Promise<void> {
    if (this.stackStates.size) throw new Error('Project runtime is not empty before adoption');
    for (const [name, project] of snapshot.projects) {
      const registered = this.registry.get(name);
      if (!registered) throw new Error(`Project disappeared during backend transfer: ${name}`);
      this.configRegistry.set(name, project);
    }
    for (const [key, definition] of snapshot.bootstrapTopology ?? []) this.bootstrapTopology.set(key, definition);
    await this.infraManager.adoptHandoff(snapshot.infrastructure);
    for (const [key, value] of snapshot.resumeBackoff) this.resumeBackoff.set(key, value);
    this.handoffReconciling = snapshot.reconciling;
    this.ownershipFrozen = true;
    for (const [key, state] of snapshot.stacks) {
      this.stackStates.set(key, { ...state, infraService: this.infraManager.getInstance(state.project, state.stack) });
    }
  }

  private readonly registry: ProjectRegistry;
  private readonly topologyControl: TopologyControl;
  private readonly bootstrapTopology = new Map<string, Pick<IAppDefinition, 'requires' | 'omnitronConfig'>>();
  private readonly bootstrapMetadata: BootstrapMetadataStore;
  private readonly configRegistry = new Map<string, LoadedProject>();
  private readonly stackStates = new Map<string, StackRuntimeState>();
  private readonly infraManager: StackInfrastructureManager;
  private readonly nodeStackStop: NodeStackStop;
  private clusterStop?: { recipient: StopRecipient; election: LeaderElection | undefined };
  private installedResume?: InstalledStackResume;
  private coordinatingResume = false;

  private get resumingInstalled(): boolean { return this.coordinatingResume || this.installedResume?.busy === true; }
  private hostedInfrastructure: () => InfrastructureService | undefined = () => undefined;
  private drainHostedProvisioning: (scope: StackExecutionScope) => Promise<void> = async () => {};
  private readonly stopsInFlight = new Map<string, { keepInfrastructure: boolean; promise: Promise<IStackInfo> }>();
  private slaveConnector: SlaveConnector | null = null;
  private readonly deployer: RemoteDeployer;
  // Enabled-stacks reconciler state (see startEnabledStacksReconciler)
  private resumeTimer: NodeJS.Timeout | null = null;
  private readonly resumeBackoff = new Map<string, { nextAt: number; delayMs: number }>();
  private reconcilingStacks = false;
  private handoffReconciling = false;
  private ownershipFrozen = false;

  private readonly syncService: SyncService | undefined;
  private readonly secrets: import('./secrets.service.js').SecretsService | undefined;
  private readonly audit: import('./audit.service.js').AuditService | undefined;

  constructor(
    private readonly logger: ILogger,
    private readonly orchestrator: OrchestratorService,
    private readonly daemonStateStore: import('../daemon/daemon-state-store.service.js').DaemonStateStore,
    /**
     * Optional local collaborators — by NAME. Both daemon roles have a vault. These were four more
     * positional parameters, and the daemon's factory passed them through an
     * `any`: `new ProjectService(logger, orchestrator, dStore, fleet,
     * undefined, secrets, audit)`. A slot removed or reordered there moves
     * every later argument into its neighbour's place and still compiles. The
     * fourth had been read by nothing since the connector stopped writing the
     * fleet table (f785d7f0); it went, and the rest became names.
     */
    options: ProjectServiceOptions = {},
  ) {
    super();
    this.syncService = options.syncService;
    this.secrets = options.secrets;
    this.receiveRelease = options.receiveRelease;
    this.audit = options.audit;
    // T-7 — registry persistence routed through DaemonStateStore
    // (SQLite, transactional, co-located with daemon-state-kv,
    // pid-lock, etc.). The registry itself is unchanged in API;
    // only its backing storage moved.
    this.registry = new ProjectRegistry(daemonStateStore);
    this.bootstrapMetadata = new BootstrapMetadataStore(daemonStateStore);
    this.topologyControl = new TopologyControl(new TopologyStateStore(daemonStateStore), {
      configuration: async (scope) => {
        const config = await this.loadProjectConfig(scope.project);
        const stack = this.resolveStacks(config, scope.project)[scope.stack];
        if (!stack) throw new Error(`Stack '${scope.stack}' not found`);
        return { config, stack, apps: this.resolveStackApps(stack, config), userStacks: this.loadUserStacks(scope.project) };
      },
      observation: scope => this.withRemoteAppStatuses(scope.project, this.getStack(scope.project, scope.stack)),
      dependencies: scope => this.getTopology(scope),
      nodes: () => daemonStateStore.selectNodesSync().map(node => ({
        id: node.id, name: node.name, host: node.host, port: node.port,
      })),
    });
    this.infraManager = new StackInfrastructureManager(logger);
    this.nodeStackStop = new NodeStackStop(daemonStateStore, {
      execution: orchestrator,
      definition: (scope, cached) => this.stopDefinition(scope, cached),
      containers: scope => inspectStackContainers(scope),
      disableResume: scope => this.registry.setStackEnabled(scope.project, scope.stack, false),
      retireInfrastructure: async scope => {
        await this.drainHostedProvisioning(scope);
        await this.hostedInfrastructure()?.retireStack(scope);
        await this.infraManager.getInstance(scope.project, scope.stack)?.retireStack(scope);
      },
      removeContainer: id => removeContainer(id, { graceful: true }),
    });
    // The deployer reaches nodes through the same SSH implementation as the
    // health checks, which is the only one that can present a password or a
    // key passphrase — see the note at the top of `remote-deployer.service.ts`.
    this.deployer = new RemoteDeployer(logger, new ExecutionService(logger));
    this.deployer.onProgress(event => {
      if (event.project && event.stack) this.emit('stack:deploy_progress', event.project, event.stack, event);
    });
  }

  setHostedInfrastructure(get: () => InfrastructureService | undefined, drain: (scope: StackExecutionScope) => Promise<void>): void {
    this.hostedInfrastructure = get;
    this.drainHostedProvisioning = drain;
  }

  /** Authority needed by an explicit start, including infrastructure provisioning. */
  private assertStartAuthority(scope: StackExecutionScope, stack: IStackConfig): void {
    if (this.clusterStop && (stack.type !== 'local' || stack.managedOrigin)) {
      throw new Error('Deploying this allocation requires a recipient-fenced deployment adapter. To recover retained applications after a confirmed stop, use stack resume.');
    }
    this.assertStackMutable(stack.managedOrigin ?? scope);
  }

  assertStackMutable(scope: StackExecutionScope): void {
    this.assertInfrastructureMutable(scope);
  }

  assertInfrastructureMutable(scope?: StackExecutionScope): void {
    if (this.clusterStop) throw new Error('Direct cluster lifecycle changes require recipient-fenced authority. Use a reviewed stack stop or resume the installed applications.');
    this.nodeStackStop.assertMutable(scope);
  }

  setClusterStop(recipient: StopRecipient, election?: LeaderElection): void {
    this.nodeStackStop.setRecipient(recipient);
    this.clusterStop = { recipient, election };
    this.installedResume = new InstalledStackResume(recipient, this.nodeStackStop, this.daemonStateStore,
      this.orchestrator, async scope => {
        const { runtime, fingerprint } = await this.stopDefinition({ ...scope, applications: true }, true);
        if (!runtime) throw new Error('No installed application allocation is bound to this stack');
        const config = this.getLoadedConfig(runtime.project)!;
        const stack = this.resolveStacks(config, runtime.project)[runtime.stack]!;
        if (ownsStackInfrastructure(stack)) throw new Error('Installed recovery requires application-only infrastructure ownership');
        const order = resolveStartupOrder(this.resolveStackApps(stack, config)).flat().map(app => app.name);
        return { runtime, fingerprint, order };
      }, (runtime, receipt) => {
        const state = this.stackStates.get(stackExecutionKey(runtime));
        if (state) {
          state.status = receipt.outcome === 'running' ? 'running' : 'error';
          state.startedAt = receipt.outcome === 'running' ? Date.parse(receipt.observedAt) : null;
        }
      });
  }

  private resumeRecipient(): InstalledStackResume {
    if (!this.installedResume) throw new Error('This node is not enrolled for signed application recovery');
    if (this.ownershipFrozen || this.reconcilingStacks || this.startsInFlight.size || this.stopsInFlight.size || this.nodeStackStop.busy) {
      throw new Error('A stack operation or backend transfer is in progress');
    }
    return this.installedResume;
  }

  prepareNodeInstalledResume(request: InstalledResumeRequest) { return this.resumeRecipient().prepare(request); }

  @RecoveryMutation()
  executeNodeInstalledResume(request: InstalledResumeExecution) { return this.resumeRecipient().execute(request); }

  getNodeInstalledResumeReceipt(request: InstalledResumeRequest) {
    if (!this.installedResume) throw new Error('This node is not enrolled for signed application recovery');
    return this.installedResume.receipt(request);
  }

  @RecoveryMutation()
  async resumeInstalledStack(project: string, stack: string): Promise<InstalledStackResumeResult> {
    const scope = { project, stack }, key = stackExecutionKey(scope);
    const cluster = this.clusterStop;
    if (!cluster?.election?.isLeader) throw new Error('Installed stack recovery requires the elected controller');
    const election = cluster.election;
    this.resumeRecipient();
    if (this.resumingInstalled) throw new Error('Another installed allocation is resuming');
    this.coordinatingResume = true;
    try {
      const stop = this.daemonStateStore.kvGetSync<StackStopProgress>(`stack:${key}:last-stop`, { strict: true });
      if (stop?.phase !== 'stopped' || stop.supersededAt || !stop.intentCommitted || !stop.nodes.length) {
        throw new Error('Review and complete a signed stop on every recipient before installed recovery');
      }
      const config = await this.loadProjectConfig(project);
      const declaration = this.resolveStacks(config, project)[stack];
      if (!declaration) throw new Error('Registered stack configuration is unavailable');
      const apps = this.resolveStackApps(declaration, config);
      const source = declaration.managedOrigin ?? scope;
      const operationId = randomUUID();
      const placements = declaration.type === 'local'
        ? [{ node: undefined, apps }]
        : resolveNodePlacements(declaration, apps);
      if (declaration.type === 'local' && !declaration.managedOrigin) throw new Error('Local recovery requires an explicitly bound allocation');
      const targets: ResumeDestination[] = placements.map(placement => {
        const { node } = placement;
        const nodeId = node ? node.nodeId : cluster.recipient.audience.nodeId;
        const label = node ? stackNodeKey(node.host, node.port) : 'local';
        const stopped = stop.nodes.find(item => item.authority?.nodeId === nodeId &&
          // Older stop journals used unbracketed IPv6 endpoint strings.
          (item.node === label || (node && item.node === `${node.host}:${node.port ?? 9700}`)));
        if (!nodeId || !placement.apps.length || !stopped?.observedAt || !stopped.operationId || stopped.outcome !== 'stopped' ||
            stopped.authority?.clusterId !== cluster.recipient.audience.clusterId) {
          throw new Error(`Target '${label}' lacks a matching signed stop for the application placement`);
        }
        const request: InstalledResumeRequest = { ...source, audience: { clusterId: stopped.authority.clusterId, nodeId },
          operationId, stopOperationId: stopped.operationId, stopObservedAt: stopped.observedAt, apps: placement.apps.map(app => app.name) };
        if (!node) return { node: label, request, prepare: () => this.prepareNodeInstalledResume(request),
          execute: (plan, permit) => this.executeNodeInstalledResume({ ...request, plan, permit }),
          receipt: async () => this.getNodeInstalledResumeReceipt(request) };
        const connector = this.slaveConnector;
        if (!connector) throw new Error('Cluster node RPC is unavailable');
        const rpc = (method: string, input: unknown, read = false) =>
          connector.invokeOnSlave(node.host, node.port ?? 9700, 'OmnitronProject', method, [input], { retryOnDisconnect: read });
        return { node: label, request,
          prepare: () => rpc('prepareNodeInstalledResume', request, true) as Promise<StackEffectPlan>,
          execute: (plan: StackEffectPlan, permit: ClusterPermit) => rpc('executeNodeInstalledResume', { ...request, plan, permit }) as Promise<InstalledResumeReceipt>,
          receipt: () => rpc('getNodeInstalledResumeReceipt', request, true) as Promise<InstalledResumeReceipt | null> };
      });
      if (targets.length !== stop.nodes.length || new Set(targets.map(t => t.request.audience.nodeId)).size !== targets.length) {
        throw new Error('Placement differs from the last confirmed stop');
      }
      const report: InstalledStackResumeResult = { ...scope, operationId, stopOperationId: stop.id, outcome: 'unconfirmed', nodes: [] };
      const journal = `stack:${key}:last-resume`;
      const previous = this.daemonStateStore.kvGetSync<InstalledStackResumeResult>(journal, { strict: true });
      if (previous?.stopOperationId === stop.id) throw new Error('Recovery was already attempted. Inspect its receipts and obtain a fresh signed stop before retrying.');
      let targetsRemembered = false;
      const result = await resumeDestinations(report, targets, plan => election.authorizeEffect(plan), progress => {
        if (!targetsRemembered && declaration.type !== 'local') {
          this.rememberStackTargets(project, stack, declaration, config);
          targetsRemembered = true;
        }
        this.daemonStateStore.kvUpdateSync<InstalledStackResumeResult>(journal, current => {
          if (current?.stopOperationId === stop.id && current.operationId !== operationId) throw new Error('A different controller already attempted this stop');
          return progress;
        });
      });
      this.stackStates.set(key, { project, stack, config: declaration, status: result.outcome === 'running' ? 'running' : 'error',
        startedAt: result.outcome === 'running' ? Date.now() : null, infraService: null });
      if (result.outcome === 'running') this.markPriorStopSuperseded(project, stack, stop.id);
      return result;
    } finally { this.coordinatingResume = false; }
  }

  private async stopDefinition(scope: NodeStackStopRequest, cached = false) {
    let allocation: { runtime: StackExecutionScope; fingerprint: string } | undefined;
    let unbound = false;
    // Only registrations owned by this project can claim one of its allocations.
    const registrations = this.registry.get(scope.project) ? this.registry.registrations(scope.project) : [];
    for (const registration of registrations) {
      const config = cached ? this.getLoadedConfig(registration.name) : await this.loadProjectConfig(registration.name);
      if (!config) throw new Error(`Configuration '${registration.name}' is unavailable for inspection; refresh its declarations`);
      for (const [name, stack] of Object.entries(this.resolveStacks(config, registration.name))) {
        if (stack.type !== 'local') continue;
        if (!stack.managedOrigin) { unbound = true; continue; }
        if (stack.managedOrigin.project !== scope.project || stack.managedOrigin.stack !== scope.stack) continue;
        if (allocation) throw new Error('Ambiguous node allocation ownership');
        if (!scope.applications) throw new Error('Node owns an application allocation outside the requested placement; reconcile the topology');
        const runtime = { project: registration.name, stack: name };
        allocation = { runtime, fingerprint: stackDefinitionFingerprint([runtime.project, name, stack, config.apps]) };
      }
    }
    if (!allocation && (scope.applications || unbound)) throw new Error(`Node allocation '${scope.project}/${scope.stack}' has no verified source-stack binding; bind its managedOrigin before remote stop`);
    return allocation ?? { runtime: null, fingerprint: stackDefinitionFingerprint([scope.project, scope.stack, false]) };
  }

  inspectNodeStackStop(scope: NodeStackStopRequest): Promise<NodeStackStopInventory> {
    return this.nodeStackStop.inspect(scope);
  }

  @RecoveryMutation()
  async prepareNodeStackStop(scope: NodeStackStopRequest): Promise<NodeStackStopPlan> {
    if (this.resumingInstalled) throw new Error('An installed allocation is resuming');
    if (this.ownershipFrozen) throw new Error('Project ownership is frozen for backend transfer');
    if (this.startsInFlight.size || this.stopsInFlight.size) throw new Error('A stack lifecycle operation is active; retry when it finishes');
    return this.nodeStackStop.prepare(scope);
  }

  @RecoveryMutation()
  async executeNodeStackStop(scope: NodeStackStopExecution): Promise<NodeStackStopReceipt> {
    if (this.resumingInstalled) throw new Error('An installed allocation is resuming');
    if (this.ownershipFrozen) throw new Error('Project ownership is frozen for backend transfer');
    const receipt = await this.nodeStackStop.execute(scope);
    if (receipt.applications) {
      const state = this.stackStates.get(stackExecutionKey(receipt.applications));
      if (state) { state.status = 'stopped'; state.startedAt = null; }
    }
    return receipt;
  }

  /**
   * Adopt the daemon's mesh connector.
   *
   * There must be ONE of these per master. It holds a live connection — and,
   * for a node whose daemon port is firewalled, an SSH tunnel — per node, so
   * a second instance means a second connection to every node and two
   * independent pulls of the same buffer, racing over which one acks an
   * entry the other has not ingested yet.
   *
   * The daemon builds it, because the daemon is what knows how to reach a
   * node: the SSH credentials live in the node registry's vault, not here.
   * Absent one, the lazy fallback below keeps the behaviour this class had
   * on its own, which is what the tests construct.
   */
  setSlaveConnector(connector: SlaveConnector): void {
    this.slaveConnector = connector;
  }

  /**
   * How to reach a host the node registry knows about.
   *
   * A stack says which host; the registry says how to reach it — the user,
   * the port, and the credential, which is in the daemon's vault because a
   * config file in a repository is not where those go. Wired by the daemon,
   * which is the side that has both.
   */
  setNodeCredentialResolver(resolve: (host: string, port: number, nodeId?: string) => Promise<SSHTarget | null>): void {
    this.resolveNodeCredentials = resolve;
  }

  private resolveNodeCredentials: ((host: string, port: number, nodeId?: string) => Promise<SSHTarget | null>) | null = null;

  /** A deploy target for a stack node, with the registry filling the gaps. */
  private async targetForStackNode(node: import('../config/types.js').IStackNode): Promise<DeployTarget> {
    const declared = stackNodeToDeployTarget(node);
    if (!this.resolveNodeCredentials) return declared;
    const registered = await this.resolveNodeCredentials(node.host, node.port ?? 9700, node.nodeId);
    return withNodeCredentials(declared, registered);
  }

  /**
   * Get or create the SlaveConnector.
   *
   * Created lazily here only when the daemon has not handed one over —
   * historically this was the sole owner, and it created one when the first
   * remote or cluster stack started. That is also why a node with no stack
   * on it was never connected to at all: nothing else ever asked.
   */
  private getSlaveConnector(): SlaveConnector {
    if (!this.slaveConnector) {
      this.slaveConnector = new SlaveConnector(this.logger, this.syncService ?? null);
    }
    return this.slaveConnector;
  }

  // ===========================================================================
  // Projects
  // ===========================================================================

  /**
   * Auto-detect project from CWD using the internal registry.
   * Keeps in-memory state consistent (unlike creating a separate ProjectRegistry).
   */
  autoDetectProject(cwd?: string): IProjectInfo | null {
    const detected = this.registry.autoDetect(cwd);
    return detected ? this.toProjectInfo(detected) : null;
  }

  /**
   * What each app on each node is doing, for a console that polls.
   *
   * A stack deployment publishes progress as it goes — transferring,
   * installing, the message naming the step that failed — and the console
   * polls. Without somewhere for an event to wait, those two never met: a
   * deployment that takes a quarter of an hour showed one row reading
   * `deploying` from the first second to the last, and every event that said
   * WHERE it was reached a handler that re-emitted it to nobody.
   */
  getDeployProgress(scope?: { project: string; stack?: string }): DeployProgressRecord[] {
    const records = this.deployer.getProgress();
    if (!scope) return records;
    const configurations = this.registry.registrations(scope.project).map(configurationInfo);
    return readDeploymentProgress(records, { name: scope.project, configurations }, scope.stack).transfers;
  }

  listProjects(): IProjectInfo[] {
    const revision = this.registry.catalogRevision();
    return this.registry.list().filter(project => !isControlPlaneWorkspace(project.path)).map(project => {
      const records = this.registry.registrations(project.name);
      const infos = records.map(record => this.toProjectInfo(record));
      return {
        ...this.toProjectInfo(project),
        enabledStacks: records.flatMap(record => (record.enabledStacks ?? []).map(stack => publicStackName(record, stack))),
        runningStacks: infos.reduce((count, info) => count + info.runningStacks, 0),
        totalStacks: infos.reduce((count, info) => count + info.totalStacks, 0),
        configurations: records.map(configurationInfo),
        catalogRevision: revision,
      };
    });
  }

  /** Source inventory for execution, backup and recovery; not the public project catalogue. */
  listProjectRegistrations(): IProjectInfo[] {
    return this.registry.listRegistrations().filter(project => !isControlPlaneWorkspace(project.path)).map(project => this.toProjectInfo(project));
  }

  projectConfigurations(project: string): ISeedProject[] {
    return this.registry.registrations(project);
  }

  async resolveProjectStack<T extends RuntimeStackScope>(scope: T, options: { readOnly?: boolean } = {}): Promise<T> {
    const resolved = this.registry.resolveStack(scope);
    if (resolved.project !== scope.project) {
      const config = options.readOnly ? this.getLoadedConfig(scope.project) : await this.ensureConfig(scope.project);
      if (!config) throw new Error('Project configuration is not loaded; reload it before resolving imported stack diagnostics');
      if (Object.hasOwn(this.resolveStacks(config, scope.project), scope.stack))
        throw new Error(`Ambiguous stack '${scope.stack}': both default and imported configurations declare it`);
    }
    return { ...scope, ...resolved };
  }

  publicStackInfo(project: string, source: ISeedProject, info: IStackInfo): IStackInfo {
    return {
      ...publicStack(info),
      name: project === source.name ? info.name : publicStackName(source, info.name),
      runtimeScope: { project: source.name, stack: info.name },
    };
  }

  @RecoveryMutation()
  async importProjectConfiguration(input: ConfigurationImport): Promise<IProjectInfo> {
    validateConfigurationNames(input?.name, input?.stacks);
    if (typeof input.project !== 'string' || typeof input.path !== 'string' || typeof input.expectedRevision !== 'string')
      throw new Error('Project, configuration path and catalogue revision are required');
    const candidate = this.registry.prepareConfiguration(input);
    const { loadEcosystemConfig } = await import('../config/loader.js');
    const source = await loadEcosystemConfig(candidate.path);
    const sourceStacks = this.resolveStacks(source, candidate);
    const declared = Object.keys(sourceStacks);
    if (declared.length !== Object.keys(input.stacks).length || declared.some(name => !Object.hasOwn(input.stacks, name)))
      throw new Error('Map every configured source stack explicitly; none may disappear during import');
    const owner = await this.ensureConfig(input.project);
    const occupied = new Set(Object.keys(this.resolveStacks(owner, input.project)));
    for (const name of Object.values(input.stacks))
      if (occupied.has(name)) throw new Error(`Stack '${name}' already exists in the project default configuration`);
    const existing = this.registry.get(candidate.name);
    if (existing) {
      for (const name of existing.enabledStacks ?? [])
        if (!input.stacks[name]) throw new Error(`Auto-start source stack '${name}' is missing from the mapping`);
      for (const name of this.getRunningStacks(existing.name, true))
        if (!input.stacks[name]) throw new Error(`Running source stack '${name}' is missing from the mapping`);
      for (const name of Object.keys(this.loadUserStacks(existing.name)))
        if (!input.stacks[name]) throw new Error(`User-defined source stack '${name}' is missing from the mapping`);
    }
    const record = this.registry.importConfiguration(input);
    this.configRegistry.set(record.name, { config: source, loadedAt: Date.now() });
    await this.audit?.record({ action: 'project.configuration.import', resourceType: 'project', resourceId: input.project,
      details: { configuration: input.name, runtimeProject: record.name, stacks: input.stacks } });
    this.emit('project:updated', input.project, {});
    return this.getProject(input.project);
  }

  @RecoveryMutation()
  async detachProjectConfiguration(data: { project: string; name: string; expectedRevision: string }): Promise<void> {
    this.registry.detachConfiguration(data.project, data.name, data.expectedRevision);
    await this.audit?.record({ action: 'project.configuration.detach', resourceType: 'project', resourceId: data.project,
      details: { configuration: data.name } });
    this.emit('project:updated', data.project, {});
  }

  getProject(name: string): IProjectInfo {
    const project = this.registry.get(name);
    if (!project) throw new Error(`Project '${name}' not found`);
    return this.listProjects().find(record => record.name === (project.configuration?.project ?? name))!;
  }

  @RecoveryMutation()
  async addProject(name: string, projectPath: string): Promise<IProjectInfo & { reread?: { redefined: number } }> {
    // Already registered AT THIS PATH: read it again rather than refuse.
    //
    // A deployment registers a node's project after writing its config, on
    // every deployment. The node answered «Project 'sample' already registered»
    // to every one after the first (four in two days, measured), the
    // deployer's SSH step failed on the exit code, and the node never read
    // the config it had just been given — a redeployment that changed an
    // app's environment restarted the app on the old one (payments on
    // sample/test, pointed at the chain's previous address, 2026-09-23). A
    // different path under the same name is still refused: that is another
    // project, not the same one again.
    const existing = this.registry.get(name);
    if (existing && samePath(existing.path, projectPath)) {
      const redefined = await this.rereadProject(name);
      return { ...this.toProjectInfo(existing), reread: { redefined } };
    }
    const project = this.registry.add(name, projectPath);
    this.logger.info({ project: name, path: projectPath }, 'Project registered');
    this.emit('project:added', name, projectPath);
    return this.toProjectInfo(project);
  }

  /**
   * Read a registered project's config again, and give every app its running
   * local stacks supervise the definition that config now describes.
   *
   * The processes are not restarted here: each takes its new definition on
   * its next start (`AppHandle.redefine`) — which a deployment asks for per
   * app, only where something changed (`decideRedeploy`). Returns how many
   * running apps were redefined.
   */
  @RecoveryMutation()
  async rereadProject(name: string): Promise<number> {
    if (this.ownershipFrozen || this.rereading?.has(name) || [...this.startsInFlight.keys()].some(key => key.startsWith(name + '/')))
      throw new Error('Project launch definitions are changing; retry after the current operation');
    (this.rereading ??= new Set()).add(name);
    try { return await this.rereadProjectOnce(name); }
    finally { this.rereading.delete(name); }
  }

  private async rereadProjectOnce(name: string): Promise<number> {
    this.configRegistry.delete(name);
    const config = await this.loadProjectConfig(name);
    const stacks = this.resolveStacks(config, name);

    let redefined = 0;
    for (const [key, state] of this.stackStates) {
      if (!key.startsWith(`${name}/`) || state.status === 'stopped' || (state.status === 'error' && state.startedAt === null)) continue;
      const stackConfig = stacks[state.stack];
      // A remote stack's apps run on its nodes; they are redefined there.
      if (!stackConfig || stackConfig.type !== 'local') continue;
      const entries = await this.launchEntries(name, state.stack, stackConfig, config);
      if (entries.some(entry => entry.releaseRoot) && !stackConfig.managedOrigin)
        await this.checkLocalOwner(name, state.stack, entries, false);
      const definitions = await this.loadAppDefinitions(name, stackConfig, config, entries);
      const stackEnv = await this.stackEnvFor(name, state.stack, stackConfig, entries.map((e) => e.name));
      const build = this.stackEntryBuilder(name, state.stack, stackConfig, config, definitions, stackEnv);
      for (const entry of entries) {
        const built = build(entry);
        if (await this.orchestrator.redefineApp(built.name, built)) redefined += 1;
      }
    }

    this.logger.info(
      { project: name, redefined },
      'Project read again — running apps take the new definition on their next start',
    );
    this.emit('project:updated', name, {});
    return redefined;
  }

  /** Refresh only local container monitoring from the current validated project config. */
  @RecoveryMutation()
  async refreshInfrastructureOwnership(projectName: string, stackName: string): Promise<{ released: string[]; adopted: string[] }> {
    if (this.ownershipFrozen || this.resumingInstalled || this.startsInFlight.size || this.stopsInFlight.size || this.reconcilingStacks)
      throw new Error('Project lifecycle ownership is changing; retry the infrastructure refresh after it settles');
    this.ownershipFrozen = true;
    try { return await this.refreshInfrastructureOwnershipOnce(projectName, stackName); }
    finally { this.ownershipFrozen = false; }
  }

  private async refreshInfrastructureOwnershipOnce(projectName: string, stackName: string): Promise<{ released: string[]; adopted: string[] }> {
    const project = this.registry.get(projectName);
    if (!project) throw new Error(`Project '${projectName}' not found`);
    this.configRegistry.delete(projectName);
    const config = await this.loadProjectConfig(projectName);
    const stack = this.resolveStacks(config, projectName)[stackName];
    if (!stack || stack.type !== 'local') throw new Error('Ownership refresh requires a declared local stack');
    if (!ownsStackInfrastructure(stack)) {
      const released = await this.infraManager.refreshOwnership(projectName, stackName, stack, {}, undefined, project.path);
      const state = this.stackStates.get(`${projectName}/${stackName}`);
      if (state) { state.config = stack; state.infraService = null; }
      return released;
    }
    const entries = await this.launchEntries(projectName, stackName, stack, config);
    const definitions = await this.loadAppDefinitions(projectName, stack, config, entries);
    // The same requirements merge used at stack start. A failed fresh scan must
    // refuse a handoff rather than silently releasing auto-detected services.
    const auto = buildInfraFromRequirements(requirementsFromDefinitions(definitions));
    const effective = mergeInferredInfrastructure(auto, mergeInfrastructure(config, stack));
    return this.infraManager.refreshOwnership(projectName, stackName, stack, effective as InfrastructureConfig, definitions, project.path);
  }

  @RecoveryMutation()
  updateProject(name: string, data: { path?: string }): IProjectInfo {
    const project = this.registry.get(name);
    if (!project) throw new Error(`Project '${name}' not found`);

    if (data.path) {
      const nextPath = path.resolve(data.path);
      if (nextPath !== path.resolve(project.path)) {
        const running = this.getRunningStacks(name, true);
        if (running.length > 0) {
          throw new Error(`Project '${name}' has running stacks: ${running.join(', ')}. Stop them before changing its path.`);
        }
      }
      // Validate and persist first. A rejected path must not invalidate a live config.
      const updated = this.registry.updatePath(name, nextPath);
      this.configRegistry.delete(name);
      this.logger.info({ project: name, path: nextPath }, 'Project path updated');
      this.emit('project:updated', name, data);
      return this.toProjectInfo(updated);
    }

    return this.toProjectInfo(project);
  }

  @RecoveryMutation()
  removeProject(name: string): void {
    // Stop all running stacks for this project first
    const runningStacks = this.getRunningStacks(name, true);
    if (runningStacks.length > 0) {
      throw new Error(
        `Project '${name}' has running stacks: ${runningStacks.join(', ')}. Stop them first.`
      );
    }

    this.registry.remove(name);
    this.configRegistry.delete(name);
    this.logger.info({ project: name }, 'Project removed');
    this.emit('project:removed', name);
  }

  async scanRequirements(projectName: string): Promise<IProjectRequirements> {
    const project = this.registry.get(projectName);
    if (!project) throw new Error(`Project '${projectName}' not found`);

    const { scanRequirements } = await import('../project/requirements-scanner.js');
    const config = await this.loadProjectConfig(projectName);
    const rawReqs = await scanRequirements(config.apps, project.path);

    // Map to DTO
    const apps: IProjectRequirements['apps'] = {};
    for (const [appName, reqs] of rawReqs.byApp) {
      apps[appName] = {
        postgres: !!reqs.database,
        redis: !!reqs.redis,
        s3: !!reqs.s3,
        discovery: !!reqs.services?.discovery,
        notifications: !!reqs.services?.notifications,
        custom: [],
      };
    }

    return {
      apps,
      needsPostgres: Object.values(apps).some((a) => a.postgres),
      needsRedis: Object.values(apps).some((a) => a.redis),
      needsS3: Object.values(apps).some((a) => a.s3),
    };
  }

  // ===========================================================================
  // User Stacks — persisted in omnitron.stacks.json in project root
  // ===========================================================================

  @RecoveryMutation()
  async createStack(project: string, input: {
    name: string;
    type: 'local' | 'remote' | 'cluster';
    apps: string[] | 'all';
    nodeIds?: string[];
  }): Promise<IStackInfo> {
    // Validate stack name
    if (!/^[a-z][a-z0-9-]*$/.test(input.name)) {
      throw new Error('Stack name must start with a letter and contain only lowercase alphanumeric characters and hyphens');
    }

    // Validate type
    const validTypes = ['local', 'remote', 'cluster'] as const;
    if (!validTypes.includes(input.type)) {
      throw new Error(`Invalid stack type '${input.type}'. Must be one of: ${validTypes.join(', ')}`);
    }

    // Validate nodeIds for remote/cluster
    if (input.type === 'remote') {
      if (!input.nodeIds || input.nodeIds.length !== 1) {
        throw new Error("Remote stacks require exactly 1 nodeId");
      }
    } else if (input.type === 'cluster') {
      if (!input.nodeIds || input.nodeIds.length < 2) {
        throw new Error("Cluster stacks require at least 2 nodeIds");
      }
    }

    // Check for duplicates in both config stacks and user stacks
    const config = await this.loadProjectConfig(project);
    const allStacks = this.resolveStacks(config, project);

    if (allStacks[input.name] || this.registry.registrations(project).some(source =>
      Object.values(source.configuration?.stacks ?? {}).includes(input.name))) {
      throw new Error(`Stack '${input.name}' already exists`);
    }

    // Build stack config
    const stackConfig: IStackConfig = {
      type: input.type,
      apps: input.apps,
      ...(input.nodeIds && input.type !== 'local' && {
        nodes: input.nodeIds.map((id) => {
          const node = this.daemonStateStore.selectNodesSync().find(candidate => candidate.id === id);
          if (!node) throw new Error(`Fleet node '${id}' not found; register it before creating a stack`);
          return { nodeId: node.id, host: node.host, port: node.port, label: node.name, role: 'app' as const };
        }),
      }),
    };

    // For local stacks, auto-generate optimal infrastructure from app requirements
    if (input.type === 'local') {
      const proj = this.registry.get(project);
      this.logger.info({ project, projFound: !!proj, projPath: proj?.path }, 'Generating infrastructure for local stack');
      if (proj) {
        try {
          const infrastructure = await this.generateDefaultInfrastructure(config, proj.path, input.apps);
          // Only set if apps actually need infrastructure
          if (infrastructure.postgres || infrastructure.redis || infrastructure.minio) {
            stackConfig.infrastructure = infrastructure;
            this.logger.info(
              {
                project,
                stack: input.name,
                postgres: !!infrastructure.postgres,
                redis: !!infrastructure.redis,
                minio: !!infrastructure.minio,
              },
              'Auto-generated infrastructure config from app requirements'
            );
          }
        } catch (err) {
          this.logger.warn(
            { project, stack: input.name, error: (err as Error).message },
            'Failed to auto-generate infrastructure config — stack created without infrastructure'
          );
        }
      }
    }

    // Persist to user stacks file
    this.saveUserStack(project, input.name, stackConfig);

    // For local stacks with infrastructure, verify Docker availability
    if (input.type === 'local' && stackConfig.infrastructure) {
      try {
        const { isDockerAvailable, ensureImage } = await import('../infrastructure/container-runtime.js');
        const dockerReady = await isDockerAvailable();
        if (dockerReady) {
          // Pull images in background (don't block stack creation).
          //
          // Asked of the presets, not spelled again here. These three were
          // written out a second time, and the copies had already drifted:
          // this one named `minio/minio:latest`, which Docker Hub answers
          // `pull access denied` for, while the preset named the image the
          // resolver actually uses. A prefetch that pulls something else is
          // worse than none — it reports success and warms nothing.
          const presets = createDefaultRegistry();
          const images = new Set<string>();
          for (const name of ['postgres', 'redis', 'minio'] as const) {
            if (!stackConfig.infrastructure[name]) continue;
            const declared = (stackConfig.infrastructure[name] as { image?: string }).image;
            const image = declared ?? presets.get(name)?.defaultImage;
            if (image) images.add(image);
          }
          for (const img of images) {
            ensureImage(img).catch((err: Error) =>
              this.logger.warn({ image: img, error: err.message }, 'Failed to pull image')
            );
          }
          this.logger.info({ project, stack: input.name, images: [...images] }, 'Docker available — pulling images');
        } else {
          this.logger.warn({ project, stack: input.name }, 'Docker not available — containers will be created when Docker is running');
        }
      } catch {
        // Non-critical — Docker check is best-effort
      }
    }

    this.logger.info({ project, stack: input.name, type: input.type }, 'Stack created');
    this.emit('stack:created', project, input.name, input.type);

    return this.toStackInfo(project, input.name, stackConfig);
  }

  @RecoveryMutation()
  async deleteStack(project: string, stackName: string): Promise<void> {
    // Cannot delete config-defined stacks
    const config = await this.loadProjectConfig(project);
    const configStacks = config.stacks ?? {};
    if (configStacks[stackName]) {
      throw new Error(`Stack '${stackName}' is defined in omnitron.config.ts and cannot be deleted via API`);
    }

    // Must exist in user stacks
    const userStacks = this.loadUserStacks(project);
    if (!userStacks[stackName]) {
      throw new Error(`Stack '${stackName}' not found`);
    }

    // Cannot delete running stacks
    const stateKey = `${project}/${stackName}`;
    const state = this.stackStates.get(stateKey);
    if (state && state.status !== 'stopped') {
      throw new Error(`Stack '${stackName}' is currently ${state.status}. Stop it first.`);
    }

    if (userStacks[stackName]!.type === 'local') {
      const selection = this.localSelection(project, stackName).read();
      if (selection.release) throw new Error('Clear the selected release before deleting this stack');
    }
    this.deleteUserStack(project, stackName);
    this.stackStates.delete(stateKey);

    this.logger.info({ project, stack: stackName }, 'Stack deleted');
    this.emit('stack:deleted', project, stackName);
  }

  private getUserStacksPath(project: string): string {
    const proj = this.registry.get(project);
    if (!proj) throw new Error(`Project '${project}' not found`);
    return path.join(proj.path, 'omnitron.stacks.json');
  }

  private loadUserStacks(project: string, filePath = this.getUserStacksPath(project)): Record<string, IStackConfig> {
    return readProjectStacks(filePath, project);
  }

  private saveUserStack(project: string, name: string, config: IStackConfig): void {
    const filePath = this.getUserStacksPath(project);
    const stacks = this.loadUserStacks(project);
    stacks[name] = config;
    fs.writeFileSync(filePath, JSON.stringify(stacks, null, 2), 'utf-8');
  }

  private deleteUserStack(project: string, name: string): void {
    const filePath = this.getUserStacksPath(project);
    const stacks = this.loadUserStacks(project);
    delete stacks[name];
    fs.writeFileSync(filePath, JSON.stringify(stacks, null, 2), 'utf-8');
  }

  // ===========================================================================
  // Stacks
  // ===========================================================================

  /** Remote deployments across projects; local process/container inventory has its own authoritative source. */
  async getTopologyInventory(): Promise<import('../shared/dto/topology.js').TopologyInventory> {
    const result: import('../shared/dto/topology.js').TopologyInventory = {
      generatedAt: new Date().toISOString(), deployments: [], errors: [],
    };
    for (const project of this.listProjectRegistrations()) {
      const source = this.registry.get(project.name)!;
      const owner = source.configuration?.project ?? project.name;
      try {
        await this.ensureConfig(project.name);
        const stacks = this.listStacks(project.name).filter(stack => stack.type !== 'local');
        for (let offset = 0; offset < stacks.length; offset += 4) {
          const observations = await Promise.allSettled(
            stacks.slice(offset, offset + 4).map(stack => this.withRemoteAppStatuses(project.name, stack)),
          );
          observations.forEach((observation, index) => {
            if (observation.status === 'fulfilled') {
              result.deployments.push({ project: owner, stack: this.publicStackInfo(owner, source, observation.value) });
            } else {
              result.errors.push({
                project: owner, stack: publicStackName(source, stacks[offset + index]!.name), reason: 'Node inventory could not be read',
              });
            }
          });
        }
      } catch {
        result.errors.push({ project: owner, reason: `Configuration '${source.configuration?.name ?? 'default'}' could not be read` });
      }
    }
    return result;
  }

  async getTopologyWorkspace(scope: TopologyScope): Promise<TopologyWorkspace> {
    return this.topologyControl.workspace(scope);
  }

  @RecoveryMutation()
  async saveTopologyDraft(data: TopologyScope & { baseRevision: string; expectedDraft: number | null; spec: TopologySpec }) {
    return this.topologyControl.saveDraft(data);
  }

  @RecoveryMutation()
  async planTopology(data: TopologyScope & { draftRevision: number }): Promise<TopologyPlan> {
    return this.topologyControl.plan(data);
  }

  @RecoveryMutation()
  async applyTopologyPlan(data: TopologyScope & { plan: string }): Promise<TopologyPlan> {
    const result = await this.topologyControl.apply(data, currentActor());
    if (result.changed) {
      // The local FULL commit already contains intent and its receipt; this is a searchable audit copy.
      await this.audit?.record({
        action: 'topology.apply', resourceType: 'stack', resourceId: `${data.project}/${data.stack}`,
        details: {
          plan: result.plan.id, revision: result.plan.baseRevision,
          effect: result.plan.effect, changes: result.plan.changes,
        },
      });
      this.emit('project:updated', data.project, {});
    }
    return result.plan;
  }

  /** Reads persisted launch evidence and static JSON only; never imports application code. */
  private readAppDeclaration(project: string, stack: string, app: string, bootstrap: string) {
    const state = this.bootstrapMetadata?.readState(bootstrap);
    const saved = state?.metadata;
    const launched = this.orchestrator?.getHandle(ProjectService.handleKey(project, stack, app))?.bootstrapMetadata;
    const observed = launched?.bootstrap === bootstrap ? launched : null;
    const record = observed && (!saved || observed.capturedAt > saved.capturedAt) ? observed : saved;
    const metadata = record?.definition ?? getCachedBootstrapDefinition(bootstrap) ?? this.bootstrapTopology.get(bootstrap);
    const declared = readDeclaredConfig(bootstrap);
    return { state, record, metadata, declared, observed };
  }

  /** Inspect prerequisites without provisioning, migration, application start or bootstrap imports. */
  private readonly diagnosesInFlight = new Map<string, Promise<StackDiagnosis>>();

  async diagnoseStack(projectName: string, stackName: string): Promise<StackDiagnosis> {
    const key = JSON.stringify([projectName, stackName]);
    const pending = this.diagnosesInFlight.get(key);
    if (pending) return pending;
    const request = this.inspectStackReadiness(projectName, stackName);
    this.diagnosesInFlight.set(key, request);
    try { return await request; } finally { this.diagnosesInFlight.delete(key); }
  }

  private async inspectStackReadiness(projectName: string, stackName: string): Promise<StackDiagnosis> {
    const started = Date.now();
    const checks: StackDiagnosisCheck[] = [];
    const deferred = ['Application startup and application health', 'Database authentication, schema and migrations', 'Registry downloads and available storage capacity', 'Configuration changes made after this observation'];
    const done = (): StackDiagnosis => ({ project: projectName, stack: stackName, checkedAt: new Date().toISOString(), durationMs: Date.now() - started, status: diagnosisStatus(checks), checks, deferred });
    const add = (code: string, resource: string, state: StackDiagnosisCheck['state'], message: string, action?: string) => checks.push({ code, resource, state, message, ...(action && { action }) });
    const project = this.registry.get(projectName);
    if (!project) throw new Error('Project is not registered');
    const loaded = this.configRegistry.get(projectName);
    if (!loaded) {
      add('configuration.unloaded', 'Project configuration', 'unknown', 'Project configuration has not been loaded.', 'Reload the trusted project configuration, then retry.');
      return done();
    }
    const config = loaded.config;
    const stack = this.resolveStacks(config, projectName)[stackName];
    if (!stack) throw new Error('Stack is not declared');
    try {
      this.assertStartAuthority({ project: projectName, stack: stackName }, stack);
    } catch (err) {
      add('start.authority', 'Start authority', 'blocked', (err as Error).message, 'Inspect the allocation owner and its stop operation before planning a start.');
    }
    add('configuration.loaded', 'Project configuration', 'pass', `Using daemon configuration loaded at ${new Date(loaded.loadedAt).toISOString()}.`, 'Reload project configuration after editing it.');
    // This is observed history, not a fresh execution of user code. Reuse the
    // status reader so a recovered app or an intentionally stopped stack does
    // not keep an obsolete launch failure in its readiness report.
    if (stack.type === 'local' && this.stackStates.get(`${projectName}/${stackName}`)?.appStartErrors) {
      const previous = this.toStackInfo(projectName, stackName, stack);
      for (const issue of previous.notUp ?? []) add('application.previous-start', 'Previous start', 'unknown',
        `${previous.startedAt ? previous.startedAt + ' · ' : ''}${issue}`,
        'This records the previous start attempt; current startup remains unverified. Correct the cause and retry the stack start.');
    }
    let entries: IEcosystemAppEntry[];
    let infrastructure = mergeInfrastructure(config, stack);
    try {
      const selected = stack.type === 'local' && !stack.managedOrigin ? this.localSelection(projectName, stackName).read().release : null;
      if (selected && artifactVolumeBindings(infrastructure).length) {
        const { loadRelease } = await import('../release/load.js');
        const release = await loadRelease(selected.id, await this.releaseStore());
        if (release.manifestSha256 !== selected.manifestSha256) throw Error('Selected release manifest changed on disk');
        const installed = await this.installedRelease(projectName, stackName, stack, config, release);
        if (!installed.infrastructure) throw Error('Selected artifact infrastructure is unavailable');
        entries = installed.entries;
        infrastructure = installed.infrastructure;
      } else entries = await this.launchEntries(projectName, stackName, stack, config);
      if (selected) add('release.selected', 'Release', 'pass', 'Next start uses verified release ' + selected.id);
      else if (stack.release?.mode === 'required') add('release.required', 'Release', 'unknown', 'This stack requires an immutable release; no release was selected for this check.', 'Use Deploy release and review its admission checks.');
    } catch (error) {
      add('release.unavailable', 'Selected release', 'blocked', describeFailure(error), 'Restore the pinned installation or select another verified release.');
      return done();
    }
    if (Array.isArray(stack.apps)) {
      const available = new Set(entries.map(entry => entry.name));
      for (const name of stack.apps) if (!available.has(name)) add('application.undeclared', name, 'blocked', 'The selected application is absent or disabled in project configuration.');
    }
    if (!entries.length) add('applications.empty', 'Applications', 'blocked', 'No enabled applications are selected.');
    try { resolveStartupOrder(entries); add('dependencies.valid', 'Application dependencies', 'pass', 'Startup dependency order resolved.'); }
    catch { add('dependencies.invalid', 'Application dependencies', 'blocked', 'Application dependencies cannot be ordered.', 'Check missing dependencies and dependency cycles in the project configuration.'); }
    let migrationEnvironment: Readonly<Record<string, Readonly<Record<string, string>>>> | null = null;
    try { migrationEnvironment = await this.stackEnvFor(projectName, stackName, stack, entries.map(entry => entry.name)); add('environment.valid', 'Environment', 'pass', 'Environment declarations and vault references resolved; values are withheld.'); }
    catch { add('environment.invalid', 'Environment', 'blocked', 'Environment declarations or vault references could not be resolved.', 'Check stack environment variable names and required vault entries.'); }
    const definitions = new Map<string, IAppDefinition>();
    for (const entry of entries) {
      if (entry.releaseFrom) {
        add('release.import-unselected', entry.name, 'blocked', 'This application comes from a pinned producer release; no verified installation is selected.', 'Prepare and select the consumer release before checking its application prerequisites.');
        continue;
      }
      if (!entry.bootstrap) {
        add('application.classic', entry.name, 'unknown', 'Executable prerequisites for this command-based application have not been probed.', 'Check the configured command and working directory before starting.');
        continue;
      }
      const bootstrap = resolveAppPath(project.path, entry, entry.bootstrap);
      if (!fs.existsSync(bootstrap)) add('bootstrap.missing', entry.name, 'blocked', 'The configured bootstrap file is missing.', 'Restore the application sources or correct its bootstrap path.');
      const { metadata, declared, state, record } = this.readAppDeclaration(projectName, stackName, entry.name, bootstrap);
      if (declared.malformed) add('declaration.invalid', entry.name, 'blocked', 'Application configuration is invalid or unreadable.', 'Check config/default.json syntax and permissions.');
      if (!metadata || !record || metadataSourceChanged(record) || state?.failure) add('declaration.unknown', entry.name, 'unknown',
        state?.failure ? `Last declaration read at ${state.failure.at}: ${state.failure.reason}` : 'Current bootstrap declarations have not been verified.',
        'Refresh declarations as an administrator, then run diagnosis again.');
      else add('declaration.current', entry.name, 'pass', `Bootstrap declaration captured at ${record.capturedAt}; source file is unchanged.`);
      if (metadata || declared.omnitron) definitions.set(entry.name, withDeclaredConfig({ name: entry.name, version: '', processes: [], ...metadata }, declared));
    }
    try {
      if (!ownsStackInfrastructure(stack)) {
        const mode = infrastructureOwnership(stack);
        const owner = mode === 'controller' ? `${stack.managedOrigin!.project}/${stack.managedOrigin!.stack}` : 'an external operator';
        add('infrastructure.delegated', 'Infrastructure ownership', 'pass', `Infrastructure provisioning and migrations belong to ${owner}; this stack starts applications only.`);
        add('infrastructure.external-readiness', 'Application connections', 'unknown', 'Explicit application connection settings are retained. Endpoint reachability, credentials and schema have not been verified.', 'Inspect the owning infrastructure and application health; this node will not create substitute services.');
        return done();
      }
    } catch (error) {
      add('infrastructure.ownership-invalid', 'Infrastructure ownership', 'blocked', (error as Error).message, 'Correct the explicit ownership binding; diagnosis changes no infrastructure.');
      return done();
    }
    if (stack.type !== 'local') {
      try { resolveNodePlacements(stack, entries); add('placement.valid', 'Placement', 'pass', 'Configured node placement resolved.'); }
      catch { add('placement.invalid', 'Placement', 'blocked', 'Node placement is incomplete or inconsistent.', 'Check selected applications, node identities and placement assignments.'); }
      add('remote.prerequisites', 'Remote infrastructure', 'unknown', 'Host prerequisites must be inspected on each target node; local Docker is not evidence for a remote stack.', `Use omnitron infra inspect ${projectName}/${stackName} for host-service evidence and Nodes for RPC diagnostics.`);
      return done();
    }
    try {
      const effective = mergeInferredInfrastructure(buildInfraFromRequirements(requirementsFromDefinitions(definitions)), infrastructure);
      const migrations = requestedMigrations(expandServiceDeclarations(effective, createDefaultRegistry()));
      if (migrations.length) {
        try {
          const targets = await localMigrationTargets(migrations, entries, project.path,
            (names, files) => this.launchEntries(projectName, stackName, stack, config, names, files));
          if (migrationEnvironment) {
            const resolveMigration = this.stackEntryBuilder(projectName, stackName, stack, config, definitions, migrationEnvironment);
            validateMigrationDestinations(targets.map(target => {
              const entry = entries.find(app => app.name === target.app)!;
              return { app: target.app, database: migrationDatabaseEnvironment(target.environmentApp,
                resolveMigration(entry).env?.['DATABASE_URL'] ?? '', target.database, target.mode) };
            }));
          }
          add('migrations.entries', 'Database migration programs', 'pass', `Migration owners: ${targets.map(target => `${target.service}/${target.database} → ${target.app} (${target.mode === 'config' ? target.release : 'legacy script'})`).join('; ')}. Programs are available; database access, schema and execution remain unverified.`);
        } catch (error) {
          add('migrations.unavailable', 'Database migration programs', 'blocked', describeFailure(error),
            'Restore the requested migration program or prepare a complete verified release. No database or infrastructure was changed.');
        }
      }
      const declaredServices = { ...effective.services };
      for (const definition of definitions.values()) Object.assign(declaredServices, definition.omnitronConfig?.infrastructure);
      for (const [service, requirement] of Object.entries(declaredServices)) {
        // Presets acquire their provisioning definition in the shared resolver below.
        if ('preset' in requirement) continue;
        const binding = bindService(requirement, stack.serviceOverrides?.[service]);
        if (binding.provisioning === 'none') add('service.unconfigured', service, 'blocked', 'This service has no provisioning definition or external endpoint.');
        if (binding.provisioning === 'bareMetal' || binding.provisioning === 'external') add('service.host', service, 'unknown', 'This service uses a host or external endpoint; Docker readiness does not verify it.', 'Check the service endpoint, authentication and host configuration separately.');
      }
      const mounts = artifactVolumeBindings(effective);
      if (mounts.length) {
        add('release.mounts-unselected', 'Artifact volumes', 'blocked',
          'These mounts require an installed release: ' + mounts.map(([, mount]) => mount.app + ' → ' + mount.service + ':' + mount.target).join(', '),
          'Prepare and select the consumer release, then run diagnosis again.');
      } else {
        const containers = await this.infraManager.planStack(projectName, stackName, stack, effective, definitions, project.path);
        checks.push(...await diagnoseContainers(containers));
      }
    } catch {
      add('infrastructure.invalid', 'Infrastructure plan', 'blocked', 'The infrastructure declaration could not be resolved.', 'Review service presets, port mappings and service overrides. No infrastructure was changed.');
    }
    return done();
  }

  /** Configuration evidence from the launch builder; it never starts, probes or modifies applications. */
  async getTopology(scope: { project?: string; stack?: string }): Promise<import('../shared/dto/project.js').ProjectTopology> {
    const result: import('../shared/dto/project.js').ProjectTopology = { version: 1, generatedAt: new Date().toISOString(), dependencies: [], warnings: [], coverage: [] };
    const projects = scope.project ? [scope.project] : this.listProjectRegistrations().map(project => project.name);
    for (const project of projects) {
      let config: IEcosystemConfig;
      try { config = await this.ensureConfig(project); }
      catch { result.warnings.push({ project, reason: 'Project configuration could not be read' }); continue; }
      for (const [stack, stackConfig] of Object.entries(this.resolveStacks(config, project))) {
        if (scope.stack && stack !== scope.stack) continue;
        try {
          const entries = this.resolveStackApps(stackConfig, config);
          const pinned = stackConfig.type === 'local' && !stackConfig.managedOrigin && this.localSelection(project, stack).read().release;
          const definitions = new Map<string, IAppDefinition>();
          const directory = this.registry.get(project)?.path;
          for (const entry of entries) {
            const handle = pinned ? this.orchestrator.getHandle(ProjectService.handleKey(project, stack, entry.name)) : undefined;
            if (!entry.bootstrap && (!entry.releaseFrom || (handle?.entry?.script && !handle.entry.bootstrap))) {
              result.coverage!.push({ project, stack, app: entry.name, source: 'entry' });
              continue;
            }
            if (!directory) continue;
            const bootstrap = pinned ? handle?.bootstrapMetadata?.bootstrap
              : entry.bootstrap ? resolveAppPath(directory, entry, entry.bootstrap) : undefined;
            if (!bootstrap) {
              result.coverage!.push({ project, stack, app: entry.name, source: 'missing' });
              result.warnings.push({ project, stack, app: entry.name, reason: pinned ? 'Owner has not reported a launch declaration for the selected release' : 'Imported application has no selected release; prepare and select it before reading topology declarations' });
              continue;
            }
            const { state, record, metadata, declared, observed } = this.readAppDeclaration(project, stack, entry.name, bootstrap);
            result.coverage!.push({ project, stack, app: entry.name,
              source: record ? record === observed ? 'launch' : 'snapshot' : metadata ? 'memory' : 'missing',
              ...(record && { capturedAt: record.capturedAt }) });
            if (!metadata) result.warnings.push({ project, stack, app: entry.name, reason: 'Bootstrap metadata not loaded; refresh declarations before relying on complete dependency coverage' });
            if (state?.failure) result.warnings.push({ project, stack, app: entry.name, reason: state.failure.reason });
            if (record && metadataSourceChanged(record)) result.warnings.push({ project, stack, app: entry.name, reason: 'Bootstrap file changed after declaration capture; refresh metadata to inspect the current configuration' });
            if (declared.malformed) result.warnings.push({ project, stack, app: entry.name, reason: 'Application configuration is malformed; file declarations are unavailable' });
            if (metadata || declared.omnitron) definitions.set(entry.name, withDeclaredConfig({ name: entry.name, version: '', processes: [], ...metadata }, declared));
          }
          const env = await this.stackEnvFor(project, stack, stackConfig, entries.map(entry => entry.name));
          const build = this.stackEntryBuilder(project, stack, stackConfig, config, definitions, env);
          for (const entry of entries) {
            if (entry.enabled === false) continue;
            const definition = definitions.get(entry.name);
            result.dependencies.push(...appDependencies(project, stack, build(entry), definition));
          }
        } catch { result.warnings.push({ project, stack, reason: 'Launch configuration could not be resolved; dependencies are incomplete' }); }
      }
    }
    return result;
  }

  /** Explicit administrative discovery. Imports trusted declarations in bounded child processes, never starts a stack. */
  @RecoveryMutation()
  async refreshTopologyMetadata(scope: { project: string; stack?: string }, deadline = Date.now() + TOPOLOGY_REFRESH_TIMEOUT_MS): Promise<import('../shared/dto/project.js').TopologyMetadataRefresh> {
    const config = await this.ensureConfig(scope.project);
    const directory = this.registry.get(scope.project)?.path;
    if (!directory) throw new Error('Project is not registered');
    const bootstraps = new Map<string, string>();
    const stacks = this.resolveStacks(config, scope.project);
    if (scope.stack && !stacks[scope.stack]) throw new Error('Stack is not configured');
    for (const [name, stack] of Object.entries(stacks)) {
      if (scope.stack && scope.stack !== name) continue;
      for (const app of await this.launchEntries(scope.project, name, stack, config))
        if (app.bootstrap) bootstraps.set(resolveAppPath(directory, app, app.bootstrap), app.name);
    }
    const result: import('../shared/dto/project.js').TopologyMetadataRefresh = { refreshed: 0, failures: [] };
    for (const [bootstrap, app] of bootstraps) {
      try {
        const remaining = Math.min(30_000, deadline - Date.now());
        if (remaining <= 0) throw new Error('Declaration refresh deadline exceeded; this application was not read');
        const { metadata: record } = await readBootstrapMetadata(bootstrap, false, remaining);
        this.bootstrapMetadata.save(record);
        this.bootstrapTopology.set(bootstrap, record.definition);
        result.refreshed += 1;
      } catch (error) {
        this.bootstrapMetadata.fail(bootstrap, error);
        this.logger.error({ project: scope.project, app, error }, 'Bootstrap metadata refresh failed; previous declaration retained');
        result.failures.push({ project: scope.project, app, reason: `Declaration read failed: ${publicLaunchFailure(error)}. Previous metadata was retained.` });
      }
    }
    await this.audit?.record({ action: 'topology.metadata.refresh', resourceType: 'project', resourceId: scope.project,
      details: { stack: scope.stack, refreshed: result.refreshed, failures: result.failures.length } });
    return result;
  }

  listStacks(projectName: string): IStackInfo[] {
    const config = this.getLoadedConfig(projectName);
    if (!config) return [];

    const stacks = this.resolveStacks(config, projectName);
    return Object.entries(stacks).map(([name, stackConfig]) =>
      this.toStackInfo(projectName, name, stackConfig)
    );
  }

  getStack(projectName: string, stackName: string): IStackInfo {
    const config = this.getLoadedConfig(projectName);
    if (!config) throw new Error(`Project '${projectName}' config not loaded`);

    const stacks = this.resolveStacks(config, projectName);
    const stackConfig = stacks[stackName];
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found in project '${projectName}'`);

    return this.toStackInfo(projectName, stackName, stackConfig);
  }

  /**
   * Stack starts in flight, by `project/stack`.
   *
   * `stackStates` records `starting`, and it is written AFTER the config is
   * loaded and the short-circuits above have run — so two callers that arrive
   * together both see no state and both proceed. Measured on the test stack:
   * the daemon's own `startProjectStacks` on boot and an operator's
   * `omnitron stack start sample test` landed within twenty seconds of each
   * other, and ran the whole remote deployment TWICE, concurrently.
   *
   * That is not merely wasteful. The artifact build rebuilds shared packages
   * whose `build` script is `rm -rf dist && tsc`, so one pass emptied
   * `@omnitron-dev/titan-database/dist` while the other compiled `@sample/main`
   * against it:
   *
   *     src/modules/rbac/rls-schema.ts(53,41): error TS2307: Cannot find
   *     module '@omnitron-dev/titan-database/rls'
   *
   * — an error about a subpath that exists, reported against a build that is
   * correct, which sends the reader to the wrong package entirely. Building
   * the same app by hand a minute later exits zero.
   *
   * A second caller gets the FIRST call's promise rather than a refusal:
   * asking for a stack that is already being started should end when it has
   * been started, which is what the caller meant.
   */
  private rereading?: Set<string>;
  private readonly startsInFlight = new Map<string, { selection: string; promise: Promise<IStackInfo> }>();

  @RecoveryMutation()
  async startStack(
    projectName: string,
    stackName: string,
    opts?: { source?: StackStartSource; allowDirty?: boolean; release?: string; workingTree?: boolean; reinstall?: boolean },
  ): Promise<IStackInfo> {
    if (this.resumingInstalled) throw new Error('An installed allocation is resuming');
    if (this.ownershipFrozen) throw new Error('Project ownership is frozen for backend transfer');
    const inFlightKey = `${projectName}/${stackName}`;
    if (this.stopsInFlight.has(inFlightKey)) throw new Error('This stack is stopping; wait for its acknowledgement');
    if (this.rereading?.has(projectName)) throw new Error('Project definitions are being updated; retry the start');
    if (opts?.workingTree && opts.release) throw new Error('Select either a release or the working tree');
    const selection = JSON.stringify([opts?.release, opts?.workingTree === true, opts?.reinstall === true]);
    const running = this.startsInFlight.get(inFlightKey);
    if (running) {
      this.logger.info(
        { project: projectName, stack: stackName },
        'This stack is already being started — joining the run in progress',
      );
      if (running.selection !== selection) throw new Error('Another stack start selected different launch code; retry after it completes');
      return running.promise;
    }

    const started = this.startStackOnce(
      projectName,
      stackName,
      opts?.source ?? 'unknown',
      opts?.allowDirty === true,
      opts?.release,
      opts?.reinstall === true,
      opts?.workingTree === true,
    ).finally(() => {
      this.startsInFlight.delete(inFlightKey);
    });
    this.startsInFlight.set(inFlightKey, { selection, promise: started });
    return started;
  }

  /**
   * One start of a stack, recorded however it ends.
   *
   * The row was written on the success path only — inside the `try` at the
   * end of `runStackStart` — so a start that was refused or failed left
   * nothing in the trail. Measured on the master 2026-09-23: 178 rows since
   * the trail began (2026-09-20 15:37Z), not one of them a failure, against
   * the log's eight operator starts that threw — five dirty-tree refusals
   * (09-22 04:37:24 … 08:27:49), a release refused for a failed gate
   * (15:12:41), «sample/test takes releases only» (15:32:43), and the
   * deployment of 21:19:02 that failed on 6 of 6 apps, followed at 21:20:37
   * by the redeploy the trail DID record, alone, as if it had been the only
   * attempt.
   *
   * Written as `stack.start.failed`, not as `stack.start` with a flag. Two
   * readers take every `stack.start` row as a deployment that happened —
   * `ReleaseRpcService.deployments` (the console's «last deployed») and
   * `lastDeployedAt` (the attestation freshness refusal) — and a refused
   * deployment is not one; filed under the same action it would become the
   * stack's «last deployment». Same shape as `node.upgrade.failed`.
   *
   * A remote stack that a restart re-attaches is left out both ways: it
   * deploys nothing, and the reconciler re-asks a node that does not answer
   * every few minutes — rows about looking, not about changing anything.
   */
  private async startStackOnce(
    projectName: string,
    stackName: string,
    source: StackStartSource,
    allowDirty: boolean,
    releaseId?: string,
    reinstall = false,
    workingTree = false,
  ): Promise<IStackInfo> {
    const known: StackStartKnown = { attach: false };
    try {
      return await this.runStackStart(projectName, stackName, source, allowDirty, releaseId, known, reinstall, workingTree);
    } catch (err) {
      if (!known.attach) {
        await this.audit?.record({
          action: 'stack.start.failed',
          resourceType: 'stack',
          resourceId: `${projectName}/${stackName}`,
          outcome: 'failed',
          error: err,
          details: {
            source,
            ...(known.type ? { type: known.type } : {}),
            ...((releaseId ?? known.release) ? { release: releaseId ?? known.release } : {}),
            ...(known.commit !== undefined ? { commit: known.commit } : {}),
          },
        });
      }
      throw err;
    }
  }

  private async runStackStart(
    projectName: string,
    stackName: string,
    source: StackStartSource,
    allowDirty: boolean,
    releaseId: string | undefined,
    known: StackStartKnown,
    reinstall = false,
    workingTree = false,
  ): Promise<IStackInfo> {
    const config = await this.loadProjectConfig(projectName);
    const stacks = this.resolveStacks(config, projectName);
    const stackConfig = stacks[stackName];
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found in project '${projectName}'`);
    known.type = stackConfig.type;
    ownsStackInfrastructure(stackConfig); // Reject ambiguous ownership before attachment, build, migration or provisioning.

    // A restart of this daemon re-attaches a remote stack; it never deploys
    // one. See `attachRemoteStack`.
    if (stackConfig.type !== 'local' && (source === 'boot' || source === 'auto-resume')) {
      known.attach = true;
      return this.attachRemoteStack(projectName, stackName, stackConfig, source);
    }
    this.assertStartAuthority({ project: projectName, stack: stackName }, stackConfig);

    // A release, when one is named — and a stack that takes nothing else.
    const local = stackConfig.type === 'local' && !stackConfig.managedOrigin;
    if ((workingTree || (releaseId && stackConfig.type === 'local')) && !local)
      throw new Error('Only an independently managed local stack can change its local release selection');
    const selector = local ? this.localSelection(projectName, stackName) : null;
    const prior = selector?.read();
    const requested = releaseId ?? (workingTree ? undefined : prior?.release?.id);
    let release: AdmittedRelease | null = null;
    if (requested) {
      known.release = requested;
      if (this.receiveRelease && releaseId && source === 'operator') await this.fetchMissingRelease(releaseId);
      release = await this.admitRelease(projectName, stackName, stackConfig, config, requested);
      if (prior?.release?.id === requested && prior.release.manifestSha256 !== release.manifestSha256)
        throw new Error('The selected release manifest changed on disk; restore its original bytes');
    } else if (stackConfig.release?.mode === 'required') {
      throw new Error(
        `${projectName}/${stackName} takes releases only: \`omnitron release build ${projectName} --for ${stackName}\`, ` +
          `then \`omnitron stack start ${projectName} ${stackName} --release <id>\`.`,
      );
    }

    // A remote deployment ships what is on DISK, so before anything is built
    // the disk has to be a commit.
    //
    // Measured over one night with three sessions in one checkout: an
    // automatic resume compiled somebody's half-finished edit, `main` failed
    // to build, and five artifacts of six went out under `Stack started`.
    // The hazard is not the operator typing the command — it is that every
    // master restart runs this path, and a restart happens for reasons
    // nobody chose: a crash, a laptop asleep, launchd. Four of them did so
    // that day.
    //
    // Local stacks are exempt on purpose. Compiling the working tree is what
    // a development stand is FOR — hot reload is that feature — and a rule
    // that refused there would be turned off within the hour.
    const projectForTree = this.registry.get(projectName);
    // Not only the project's own repository. The static bundle INLINES the
    // sources of the packages it links — the portal's vite alias resolves
    // prism and netron-browser to their `src` in another checkout — so an
    // uncommitted change there rides to the node inside `dist` while this
    // tree is spotless. The backends differ: their vendored
    // `@omnitron-dev/*` are replaced on the node by symlinks to the node
    // daemon's copy, so what was packed for them never runs.
    //
    // The list is derived from the mechanism, not written down:
    // `linkedSourceDirs` is the same function the staleness check uses to
    // decide what the bundle is built from.
    const treeInputs: string[] = [];
    if (projectForTree) {
      treeInputs.push(projectForTree.path);
      const staticAbs = this.staticDirOf(stackConfig.infrastructure, projectForTree.path);
      if (staticAbs) {
        const { linkedSourceDirs } = await import('./bundle-builder.js');
        const pkgDir = staticAbs.replace(/\/[^/]+\/?$/, '');
        treeInputs.push(...linkedSourceDirs(pkgDir));
      }
    }
    const trees = projectForTree
      ? await describeWorkingTrees(treeInputs)
      : [
          {
            root: projectName,
            tree: { checked: false as const, why: `project '${projectName}' is not in the registry`, dirty: [] },
          },
        ];
    const tree = trees[0]?.tree ?? { checked: false as const, why: 'no tree to read', dirty: [] };
    known.commit = tree.checked ? (tree.head ?? null) : null;

    // With a release the disk has already been held to the release's commit
    // (`admitRelease`) — stricter than HEAD, and the artifacts are not built
    // from it at all.
    if (stackConfig.type !== 'local' && !release) {
      if (!allowDirty) {
        for (const { root, tree: t } of trees) {
          const refusal = refusalForDirtyTree(t, `${projectName}/${stackName}`);
          if (refusal) throw new Error(trees.length > 1 ? `${refusal}\n(in ${root})` : refusal);
        }
      } else if (tree.checked && tree.dirty.length > 0) {
        this.logger.warn(
          { project: projectName, stack: stackName, dirty: tree.dirty.length, head: tree.head },
          'Deploying a working tree that is not its commit — asked for with --allow-dirty',
        );
      }
      if (!tree.checked) {
        // Not a pass. The deployment goes on, because refusing every project
        // that is not a git checkout would be a rule about git rather than
        // about deployments — but the log says the check did not run.
        this.logger.warn(
          { project: projectName, stack: stackName, why: tree.why },
          'Could not tell whether the working tree matches its commit — shipping what is on disk',
        );
      }
    }

    const selected = release ? { id: release.id, manifestSha256: release.manifestSha256 } : null;
    const changing = !!selector && !isDeepStrictEqual(prior?.release, selected);
    const mounted = artifactVolumeBindings(mergeInfrastructure(config, stackConfig));
    if (mounted.length && (!local || !release || !ownsStackInfrastructure(stackConfig)))
      throw Error('Artifact volumes require a selected release on an independently owned local stack');
    const installation = mounted.length && release
      ? await this.installedRelease(projectName, stackName, stackConfig, config, release, true) : undefined;
    const entries = installation?.entries ?? (local && release ? await this.installedEntries(projectName, stackName, stackConfig, config, release, true) : undefined);
    let localMembershipChanged = false;
    if (local) {
      const target = entries ?? this.resolveStackApps(stackConfig, config);
      const plan = await this.checkLocalOwner(projectName, stackName, target, changing, source === 'boot' || source === 'auto-resume');
      // A changed immutable mount may not reach Docker before the ordinary owner stop fence.
      if (mounted.length && changing && plan.phase !== 'stopped')
        throw new LocalReleaseStopRequired('Stop this local stack before changing its immutable artifact volumes');
      const names = new Set(target.map(entry => ProjectService.handleKey(projectName, stackName, entry.name)));
      localMembershipChanged = plan.apps.some(app => !names.has(app.name));
      if ((source === 'boot' || source === 'auto-resume') && plan.phase !== 'running')
        throw new Error('The selected local stack is fenced; an explicit start must recover or roll back the selection');
    }
    const stateKey = `${projectName}/${stackName}`;
    const existing = this.stackStates.get(stateKey);
    // Not for a release: putting a release onto a running stack is the point.
    const completedLocalStart = stackConfig.type === 'local' && existing?.startedAt != null &&
      (existing.status === 'degraded' || existing.status === 'error');
    if ((existing?.status === 'running' || completedLocalStart) && !changing && !localMembershipChanged && (!release || local)) {
      // `running` is a claim about the past, and nothing revises it when the
      // apps underneath fall over — so this short-circuit used to hand the
      // operator a stack it had not touched. `toStackInfo` reads live
      // orchestrator statuses, which means the very response we returned
      // already said how many apps were up; nothing compared the two halves.
      // Observed on the dev stand with all six apps dead: `stack start`
      // printed "Stack acme/dev started — 0/6 apps online", exited 0, and
      // started nothing. Ask what is actually online before believing it.
      //
      // And ask the machine that runs them. `toStackInfo` reads THIS
      // daemon's orchestrator, which lists none of a remote stack's
      // applications because they run on the node — so `down` was all six,
      // every time, and this short-circuit could never fire for a remote
      // stack. Measured 2026-09-22: six occurrences, every one of them
      // `down: [main, storage, quotes, payments, messaging, geo]` against
      // a node where all six were online with pids and uptimes to show for
      // it. Each fell through to a full deployment of a stack that needed
      // nothing — which is most of the «four master restarts, four full
      // redeploys, twenty-four application restarts» that `decideRedeploy`
      // was written to stop. Same reader, same mistake, third caller: see
      // `getStackStatus` and `withRemoteAppStatuses`, which is what this
      // now goes through. For a local stack it changes nothing — the
      // wrapper returns the info untouched.
      const current = await this.withRemoteAppStatuses(
        projectName,
        this.toStackInfo(projectName, stackName, stackConfig),
      );
      const down = current.apps.filter((a) => a.status !== 'online');
      if (down.length === 0 && !current.notUp?.length) {
        if (existing) existing.status = 'running';
        this.logger.warn({ project: projectName, stack: stackName }, 'Stack already running');
        return current;
      }
      this.logger.warn(
        { project: projectName, stack: stackName, down: down.map((a) => a.name) },
        'Stack is marked running but some of its apps are not — starting them',
      );
      // Fall through. Starting is idempotent for the apps still up:
      // `startAppInternal` returns the existing handle for an online app.
      this.stackStates.delete(stateKey);
    }
    // Reset stale "starting" state (daemon may have restarted mid-launch)
    if (existing?.status === 'starting') {
      this.logger.warn({ project: projectName, stack: stackName }, 'Resetting stale "starting" state');
      this.stackStates.delete(stateKey);
    }

    this.logger.info({ project: projectName, stack: stackName, type: stackConfig.type }, 'Starting stack');

    const state: StackRuntimeState = {
      project: projectName,
      stack: stackName,
      status: 'starting',
      config: stackConfig,
      startedAt: null,
      infraService: null,
    };
    this.stackStates.set(stateKey, state);

    this.emit('stack:starting', projectName, stackName, stackConfig.type);

    let reach: NodeReach | null = null;
    try {
      this.assertStackMutable(stackConfig.managedOrigin ?? { project: projectName, stack: stackName });
      if (stackConfig.type === 'local') {
        const scope = { project: projectName, stack: stackName };
        const enable = () => this.orchestrator.enableStackExecution(scope, { automatic: source === 'boot' || source === 'auto-resume' });
        if (selector && prior) {
          const target = entries ?? this.resolveStackApps(stackConfig, config);
          await this.startLocalStack(projectName, stackName, stackConfig, config, target, async build => {
            await this.prepareLocalOwner(projectName, stackName, target, changing, build, () => {
              if (changing) selector.select(prior.revision, selected);
              else if (selector.read().revision !== prior.revision) throw new Error('Local release selection changed during admission');
            });
            await enable();
          }, release ? (names, files) => this.installedEntries(projectName, stackName, stackConfig, config, release, false, names, files) : undefined,
          installation ? async () => {
            const plan = await this.checkLocalOwner(projectName, stackName, target, changing);
            if (changing && plan.phase !== 'stopped') throw new LocalReleaseStopRequired('Artifact volume selection requires the owner stop fence');
            return (await this.installedRelease(projectName, stackName, stackConfig, config, release!, false)).infrastructure;
          } : undefined);
        } else {
          await this.startLocalStack(projectName, stackName, stackConfig, config, undefined, async () => { await enable(); });
        }
      } else {
        this.rememberStackTargets(projectName, stackName, stackConfig, config);
        reach = await this.startRemoteStack(projectName, stackName, stackConfig, config, release, reinstall);
      }

      state.status = 'running';
      state.startedAt = Date.now();

      // Update registry with enabled stack
      this.updateEnabledStacks(projectName, stackName, true);
      this.markPriorStopSuperseded(projectName, stackName);

      const info = this.toStackInfo(projectName, stackName, stackConfig);
      // What did not come up, said in the row. A boot at 12:14 UTC on
      // 2026-09-23 started sample/dev with payments and messaging errored and
      // recorded `outcome: ok, apps: 6`: the stack «started», two of its six
      // apps never did. For a local stack the apps are this daemon's; for a
      // remote one, what did not happen is a node that was skipped.
      const notUp =
        stackConfig.type === 'local'
          ? info.notUp ?? info.apps.filter((a) => a.status !== 'online').map((a) => `${a.name} (${a.status})`)
          : [
              ...(reach?.skipped ?? []).map((n) => `node ${typeof n === 'string' ? n : JSON.stringify(n)}`),
              ...(reach?.notReady ?? []).map((n) => `infrastructure on ${n}`),
            ];
      if (stackConfig.type === 'local') state.status = info.status;
      const outcome = notUp.length === 0 ? 'ok' : state.status === 'error' ? 'failed' : 'partial';
      if (outcome === 'ok') {
        this.emit('stack:started', projectName, stackName, stackConfig.type, info.apps.length, info.nodes?.length ?? 0);
        this.logger.info({ project: projectName, stack: stackName, source }, 'Stack started');
      } else {
        this.emit('stack:error', projectName, stackName, notUp.join(', '));
        this.logger.warn({ project: projectName, stack: stackName, source, outcome, notUp }, 'Stack start incomplete');
      }
      // Recorded for every caller, and saying WHICH one. `source: 'unknown'`
      // is deliberate rather than a default of `'operator'`: a caller that
      // has not been taught to identify itself should be visible in the
      // trail, not quietly attributed to a person.
      //
      // The online count the RPC layer used to attach is gone on purpose —
      // it was measured AFTER this returned, by re-asking the node, so it
      // described a later moment than the row it sat in.
      await this.audit?.record({
        action: 'stack.start',
        resourceType: 'stack',
        resourceId: `${projectName}/${stackName}`,
        // Said, now that the other ending is recorded too (`startStackOnce`).
        outcome,
        // The commit, so the trail answers what went out and not only when.
        // A node's artifacts carry no revision (every app is version `0.0.1`
        // forever, and `BUNDLE.json` is excluded from the checksum and read
        // by nobody), so this row is the only place the two can be joined.
        details: {
          type: stackConfig.type,
          // How many the stack DECLARES. What a remote deployment reached is
          // a different number and now sits beside it: a row saying `apps: 6`
          // described a deployment whose only node could not be provisioned,
          // and nothing in it said so.
          apps: info.apps.length,
          ...(notUp.length > 0 ? { notUp: notUp.join(', ') } : {}),
          source,
          ...(reach ? { nodes: reach.nodes, reached: reach.reached } : {}),
          ...(reach && reach.skipped.length > 0 ? { skipped: reach.skipped } : {}),
          ...(reach && (reach.notReady?.length ?? 0) > 0 ? { notReady: reach.notReady } : {}),
          ...(tree.checked ? { commit: tree.head, dirty: tree.dirty.length } : { commit: null }),
          // Every tree the artifacts were built from, not only the project's:
          // the omni checkout's packages are vendored into them, and the
          // project's commit alone could not say which omni went out.
          // The release, when that is what went out: its id and the two
          // commits its artifacts were built from in clean clones. Flat,
          // because `scrubDetails` keeps facts and replaces a nested object
          // with `[object]` — measured on the first release deployed, whose
          // row said exactly that. Not the same as `trees` below, which
          // describes THIS master's disk: the artifacts came from the
          // release's omni, and the master's may have moved since.
          ...(release
            ? {
                release: release.id,
                releaseManifestSha256: release.manifestSha256,
                releaseProjectCommit: release.manifest.project.commit.slice(0, 8),
                releaseOmniCommit: release.manifest.omni.commit.slice(0, 8),
              }
            : {}),
          trees: trees.map(({ root, tree: t }) => ({
            repo: path.basename(root),
            ...(t.checked ? { commit: t.head ?? null, dirty: t.dirty.length } : { commit: null, why: t.why ?? null }),
          })),
        },
      });
      // For a remote stack, what did not come up is not in its app list — a
      // node skipped, infrastructure not up — so the answer says it too.
      return stackConfig.type !== 'local' && notUp.length > 0 ? { ...info, notUp } : info;
    } catch (err) {
      state.status = 'error';
      this.emit('stack:error', projectName, stackName, (err as Error).message);
      throw err;
    }
  }

  private declaredStopTargets(stack: IStackConfig, config: IEcosystemConfig): StackTarget[] {
    if (stack.type === 'local') return [];
    const apps = this.resolveStackApps(stack, config).map(app => app.name);
    return (stack.nodes ?? []).map(node => ({ host: node.host, port: node.port ?? 9700,
      applications: nodeApplicationNames(stack, node, apps).length > 0, ...(node.nodeId && { nodeId: node.nodeId }) }));
  }

  private stopRequest(scope: StackExecutionScope, node: StackTarget, keepInfrastructure = false): NodeStackStopRequest {
    if (this.clusterStop && !node.nodeId) throw new Error('A pinned recipient nodeId is required for clustered stack stop');
    return { ...scope, applications: node.applications, ...(keepInfrastructure && { keepInfrastructure: true }),
      ...(this.clusterStop && { audience: { clusterId: this.clusterStop.recipient.audience.clusterId, nodeId: node.nodeId! } }) };
  }

  private validateStopInventory(request: NodeStackStopRequest, result: NodeStackStopInventory): void {
    if (result?.protocol !== 1 || result.project !== request.project || result.stack !== request.stack ||
        result.applications !== request.applications || !result.definition || !Array.isArray(result.containers) ||
        (request.applications ? !result.execution || !Array.isArray(result.execution.apps) : result.execution !== null)) {
      throw new Error('Invalid node stop inventory; update the recipient before stopping');
    }
    if (result.audience?.clusterId !== request.audience?.clusterId || result.audience?.nodeId !== request.audience?.nodeId) {
      throw new Error('Recipient did not confirm the required cluster and node identity');
    }
    if ((result.keepInfrastructure === true) !== (request.keepInfrastructure === true) ||
        (result.keepInfrastructure !== undefined && typeof result.keepInfrastructure !== 'boolean')) {
      throw new Error('Recipient did not confirm the requested infrastructure retention mode; update it before stopping');
    }
  }

  private async localStopInventory(scope: StackExecutionScope, stack: IStackConfig, execution: StackExecutionPlan, keepInfrastructure = false): Promise<NodeStackStopInventory> {
    const containers = await this.infraManager.inspectStopContainers(scope.project, scope.stack);
    return { ...scope, protocol: 1, applications: true, execution, definition: stackDefinitionFingerprint(stack),
      containers, ...(keepInfrastructure && { keepInfrastructure: true }) };
  }

  async reviewStackStop(project: string, stack: string, keepInfrastructure = false) {
    if (typeof keepInfrastructure !== 'boolean') throw new Error('Invalid infrastructure retention mode');
    const scope = { project, stack };
    const key = stackExecutionKey(scope);
    const targets: StopReviewTarget[] = [];
    try {
      if (this.ownershipFrozen || this.resumingInstalled || this.startsInFlight.has(key) || this.stopsInFlight.has(key)) throw new Error('A lifecycle operation is active; wait and check again');
      if (this.clusterStop) {
        if (!this.clusterStop.election) throw new Error('Review this stop on the elected controller');
        await this.clusterStop.election.confirmStopAuthority();
      }
      const config = this.getLoadedConfig(project);
      if (!config) throw new Error('Project declarations are unavailable; refresh them before reviewing this stop');
      const declaration = this.stackStates.get(key)?.config ?? this.resolveStacks(config, project)[stack];
      if (!declaration) throw new Error(`Stack '${key}' not found`);
      const journal = new StackTargets(this.daemonStateStore);
      const { nodes } = journal.inspect(scope, this.declaredStopTargets(declaration, config));
      if (declaration.type === 'local') {
        try {
          if (this.clusterStop && !declaration.managedOrigin) throw new Error('Cluster stack stop requires an explicitly bound allocation');
          const inventory = declaration.managedOrigin
            ? await this.nodeStackStop.inspect({ ...declaration.managedOrigin, applications: true,
              ...(keepInfrastructure && { keepInfrastructure: true }),
              ...(this.clusterStop && { audience: this.clusterStop.recipient.audience }) })
            : await this.localStopInventory(scope, declaration, await this.orchestrator.inspectStackExecution(scope), keepInfrastructure);
          targets.push({ node: 'local', inventory });
        } catch (error) { targets.push({ node: 'local', reason: describeFailure(error) }); }
      } else if (!nodes.length) throw new Error('No remote allocation inventory is available');
      for (const node of nodes) {
        const endpoint = stackNodeKey(node.host, node.port);
        try {
          if (!this.slaveConnector) throw new Error('Node RPC is unavailable');
          const request = this.stopRequest(scope, node, keepInfrastructure);
          const inventory = await this.slaveConnector.invokeOnSlave(node.host, node.port, 'OmnitronProject', 'inspectNodeStackStop', [request]) as NodeStackStopInventory;
          this.validateStopInventory(request, inventory);
          targets.push({ node: endpoint, inventory });
        } catch (error) { targets.push({ node: endpoint, reason: describeFailure(error) }); }
      }
    } catch (error) { targets.push({ node: 'controller', reason: describeFailure(error) }); }
    return stackStopReview(scope, targets, keepInfrastructure);
  }

  @RecoveryMutation()
  async stopStack(projectName: string, stackName: string, review?: string, keepInfrastructure = false): Promise<IStackInfo> {
    if (typeof keepInfrastructure !== 'boolean') throw new Error('Invalid infrastructure retention mode');
    const key = stackExecutionKey({ project: projectName, stack: stackName });
    if (this.resumingInstalled) throw new Error('An installed allocation is resuming');
    if (this.ownershipFrozen) throw new Error('Project ownership is frozen for backend transfer');
    if (this.startsInFlight.has(key)) throw new Error('This stack is starting; finish or reconcile the start before stopping');
    const pending = this.stopsInFlight.get(key);
    if (pending && (review !== undefined || pending.keepInfrastructure !== keepInfrastructure)) throw new Error('A stop is already running; inspect its progress');
    if (pending) return pending.promise;
    if (review !== undefined && (typeof review !== 'string' || !/^[a-f0-9]{64}$/.test(review))) throw new Error('Invalid stack stop review');
    const operation = this.stopStackOnce(projectName, stackName, review, keepInfrastructure).finally(() => this.stopsInFlight.delete(key));
    this.stopsInFlight.set(key, { keepInfrastructure, promise: operation });
    return operation;
  }

  private async stopStackOnce(projectName: string, stackName: string, review: string | undefined, keepInfrastructure: boolean): Promise<IStackInfo> {
    const key = `${projectName}/${stackName}`;
    const config = await this.loadProjectConfig(projectName);
    const stackConfig = this.stackStates.get(key)?.config ?? this.resolveStacks(config, projectName)[stackName];
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found`);
    const state = this.stackStates.get(key) ?? {
      project: projectName, stack: stackName, status: 'stopped' as StackStatus,
      config: stackConfig, startedAt: null, infraService: null,
    };
    this.stackStates.set(key, state);
    const progress: import('../shared/dto/project.js').StackStopProgress = {
      id: randomUUID(), phase: 'preparing', startedAt: new Date().toISOString(), nodes: [],
      ...(keepInfrastructure && { keepInfrastructure: true }),
    };
    const persist = () => this.daemonStateStore.kvUpdateSync(`stack:${key}:last-stop`, () => progress);
    persist();
    try {
      // Complete every read-only admission check before sending any stop.
      const prepared: Array<{ host: string; port: number; plan: NodeStackStopPlan; permit: StopPermit | undefined }> = [];
      const cluster = this.clusterStop;
      if (cluster && !cluster.election?.isLeader) throw new Error('Stack stop requires the elected controller of this cluster');
      let managedPlan: NodeStackStopPlan | null = null;
      let managedPermit: StopPermit | undefined;
      let targetsRevision: number | undefined;
      let localPlan: Awaited<ReturnType<OrchestratorService['inspectStackExecution']>> | null = null;
      if (stackConfig.type === 'local' && stackConfig.managedOrigin) {
        managedPlan = await this.nodeStackStop.prepare({ ...stackConfig.managedOrigin, applications: true,
          ...(keepInfrastructure && { keepInfrastructure: true }),
          ...(cluster && { audience: cluster.recipient.audience }) });
        managedPermit = cluster?.election?.authorizeStop(managedPlan);
      } else if (stackConfig.type === 'local') {
        if (cluster) throw new Error('Cluster stack stop requires an explicitly bound allocation');
        localPlan = await this.orchestrator.inspectStackExecution({ project: projectName, stack: stackName });
      }
      const scope = { project: projectName, stack: stackName };
      const localInventory = localPlan ? await this.localStopInventory(scope, stackConfig, localPlan, keepInfrastructure) : null;
      const declared = this.declaredStopTargets(stackConfig, config);
      const targetJournal = new StackTargets(this.daemonStateStore);
      if (declared.length) targetJournal.remember({ project: projectName, stack: stackName }, declared);
      const targets = targetJournal.inspect({ project: projectName, stack: stackName });
      if (stackConfig.type !== 'local' && targets.nodes.length === 0) throw new Error('No remote allocation inventory is available; stop cannot be confirmed');
      if (targets.nodes.length) {
        if (!this.slaveConnector) throw new Error('Node RPC is unavailable; no remote stop has been sent');
        targetsRevision = targets.revision;
        progress.nodes = targets.nodes.map(node => ({ node: `${node.host}:${node.port}`, outcome: 'checking' }));
        persist();
        for (const [index, node] of targets.nodes.entries()) {
          let plan: NodeStackStopPlan;
          try {
            const request = this.stopRequest(scope, node, keepInfrastructure);
            plan = await this.slaveConnector.invokeOnSlave(node.host, node.port, 'OmnitronProject', 'prepareNodeStackStop', [request]) as NodeStackStopPlan;
            this.validateStopInventory(request, plan);
            if (!plan.operationId) throw new Error('Invalid node stop plan');
            const permit = cluster?.election?.authorizeStop(plan);
            prepared.push({ host: node.host, port: node.port, plan, permit });
            if (permit && request.audience) progress.nodes[index]!.authority = { ...request.audience, epoch: permit.epoch };
          } catch (error) {
            progress.nodes[index]!.outcome = 'unknown';
            progress.nodes[index]!.reason = describeFailure(error);
            throw new Error(`Cannot prepare ${node.host}:${node.port}: ${describeFailure(error)}`, { cause: error });
          }
          progress.nodes[index]!.outcome = 'prepared'; persist();
        }
      }
      if (review !== undefined) {
        const actual: StopReviewTarget[] = [];
        if (managedPlan) actual.push({ node: 'local', inventory: managedPlan });
        if (localInventory) actual.push({ node: 'local', inventory: localInventory });
        for (const target of prepared) actual.push({ node: stackNodeKey(target.host, target.port), inventory: target.plan });
        if (stackStopReview(scope, actual, keepInfrastructure).digest !== review) throw new Error('Stack changed since review; inspect the current footprint before stopping');
      }
      // Losing this durable write refuses the operation before any effect.
      if (cluster) await cluster.election!.confirmStopAuthority();
      this.updateEnabledStacks(projectName, stackName, false);
      progress.phase = 'stopping'; progress.intentCommitted = true;
      persist();
      state.status = 'stopping';
      this.emit('stack:stopping', projectName, stackName);
      if (managedPlan) {
        const receipt = await this.nodeStackStop.execute({ ...stackConfig.managedOrigin!, operationId: managedPlan.operationId,
          ...(keepInfrastructure && { keepInfrastructure: true }), ...(managedPermit && { permit: managedPermit }) });
        if (receipt.authority) {
          progress.nodes.push({ node: 'local', outcome: 'stopped', operationId: receipt.operationId, observedAt: receipt.observedAt, authority: receipt.authority });
          persist();
        }
      } else if (localPlan && localInventory) {
        await this.orchestrator.stopStackExecution({ operationId: progress.id, plan: localPlan });
        if (keepInfrastructure) {
          const retained = await this.infraManager.inspectStopContainers(projectName, stackName);
          if (!isDeepStrictEqual([...retained].sort((a, b) => a.id.localeCompare(b.id)),
            [...localInventory.containers].sort((a, b) => a.id.localeCompare(b.id)))) {
            throw new Error('Retained stack infrastructure changed; inspect before confirming this application stop');
          }
        } else await this.infraManager.teardownStack(projectName, stackName, localInventory.containers);
      }
      if (prepared.length) {
        const failures: string[] = [];
        for (const [index, target] of prepared.entries()) {
          const item = progress.nodes[index]!;
          item.outcome = 'stopping'; persist();
          try {
            const receipt = await this.slaveConnector!.invokeOnSlave(target.host, target.port, 'OmnitronProject',
              'executeNodeStackStop', [{ project: projectName, stack: stackName, operationId: target.plan.operationId,
                ...(keepInfrastructure && { keepInfrastructure: true }),
                ...(target.permit && { permit: target.permit }) }],
              { retryOnDisconnect: true }) as NodeStackStopReceipt;
            if (receipt?.protocol !== 1 || receipt.operationId !== target.plan.operationId || receipt.project !== projectName ||
                receipt.stack !== stackName || receipt.outcome !== 'stopped' ||
                (receipt.keepInfrastructure === true) !== keepInfrastructure ||
                (keepInfrastructure && (!Array.isArray(receipt.keptContainers) || receipt.removedContainers?.length !== 0 ||
                  !isDeepStrictEqual([...receipt.keptContainers].sort(), target.plan.containers.map(c => c.id).sort()))) || (target.permit &&
                  (receipt.authority?.epoch !== target.permit.epoch || receipt.authority.nodeId !== target.plan.audience!.nodeId ||
                   receipt.authority.clusterId !== target.plan.audience!.clusterId))) throw new Error('Invalid node stop acknowledgement');
            item.outcome = 'stopped'; item.operationId = receipt.operationId; item.observedAt = receipt.observedAt;
          } catch (error) {
            item.outcome = 'unknown'; item.reason = describeFailure(error);
            failures.push(`${item.node}: ${item.reason}`);
          }
          persist();
        }
        if (failures.length) throw new Error(`Stack stop is unconfirmed on ${failures.join('; ')}`);
      }
      // Retained infrastructure is still owned here, including former placements.
      // A later full stop must retain the obligation to contact those nodes.
      if (!keepInfrastructure && targetsRevision !== undefined) new StackTargets(this.daemonStateStore)
        .confirmStopped({ project: projectName, stack: stackName }, targetsRevision);
      progress.phase = 'stopped'; progress.completedAt = new Date().toISOString(); persist();
      state.status = 'stopped'; state.startedAt = null;
      this.emit('stack:stopped', projectName, stackName, 'manual');
      return this.toStackInfo(projectName, stackName, stackConfig);
    } catch (error) {
      progress.phase = 'failed'; progress.error = describeFailure(error); persist();
      if (progress.intentCommitted) state.status = 'error';
      this.emit('stack:error', projectName, stackName, String(error));
      throw error;
    }
  }

  private rememberStackTargets(project: string, stack: string, definition: IStackConfig, config: IEcosystemConfig): void {
    const targets = resolveNodePlacements(definition, this.resolveStackApps(definition, config))
      .map(({ node, apps }) => ({ host: node.host, port: node.port ?? 9700, applications: apps.length > 0,
        ...(node.nodeId && { nodeId: node.nodeId }) }));
    new StackTargets(this.daemonStateStore).remember({ project, stack }, targets);
  }

  /**
   * What is running in this stack, asked of whoever is running it.
   *
   * For a remote stack that is the node. This counted `this.orchestrator
   * .list()` — the MASTER's process table — which lists none of a remote
   * stack's applications, so `stack runtime sample test` answered
   * `totalApps: 0, onlineApps: 0, connectedNodes: 0` while `stack status`
   * listed six apps online from the same node, three times in three seconds
   * (measured 2026-09-22). The JSON surface is the one a script and a
   * dashboard read.
   *
   * The sibling readers were taught this already — `listStacks`, `getStack`
   * and `startStack` all pass through `withRemoteAppStatuses`, and the
   * comment beside one of them names the same symptom: «only 0/6 apps came
   * online» about six that were running. The fix reached three callers of
   * four.
   */
  async getStackStatus(projectName: string, stackName: string): Promise<StackRuntime> {
    const stateKey = `${projectName}/${stackName}`;
    const state = this.stackStates.get(stateKey);

    const config = this.getLoadedConfig(projectName);
    const stacks = config ? this.resolveStacks(config, projectName) : {};
    const stackConfig = stacks[stackName] ?? state?.config;
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found`);

    const observed = stackConfig.type === 'local'
      ? { info: await this.withRemoteAppStatuses(projectName, this.toStackInfo(projectName, stackName, stackConfig)), answered: 1 }
      : await this.askNodes(projectName, this.getStack(projectName, stackName));
    const { info, answered } = observed;
    return {
      name: stackName,
      type: stackConfig.type,
      status: info.status,
      ...(info.health && { health: info.health }),
      ...(info.notUp?.length && { notUp: info.notUp }),
      totalApps: info.apps.length,
      onlineApps: info.apps.filter(app => app.status === 'online').length,
      totalNodes: stackConfig.type === 'local' ? 1 : stackConfig.nodes?.length ?? 0,
      connectedNodes: answered,
      totalCpu: info.apps.reduce((sum, app) => sum + (app.cpu ?? 0), 0),
      totalMemory: info.apps.reduce((sum, app) => sum + (app.memory ?? 0), 0),
      syncSummary: stackConfig.type === 'local' ? null : summariseSync(this.nodesWithSync(stackConfig)),
    };
  }

  /**
   * Each configured node paired with what it last said about its own
   * replication — the input the summary is counted from.
   *
   * Matching is by `host` and effective `port`, the same rule the node list
   * below uses; a node with no connection contributes `null`, which the
   * summary reads as «not heard from» rather than «nothing pending».
   */
  private nodesWithSync(stackConfig: IStackConfig): Array<{
    role: string;
    syncStatus: ISyncStatus | null;
  }> {
    const connections = this.slaveConnector?.getConnections() ?? [];
    return (stackConfig.nodes ?? []).map((node) => {
      const port = node.port ?? 9700;
      const conn = connections.find((c) => c.host === node.host && c.port === port);
      return { role: node.role, syncStatus: conn?.syncStatus ?? null };
    });
  }

  /** Where releases are kept on this master — `~/.omnitron/releases`. */
  private async releaseStore(): Promise<string> {
    const { releasesRoot } = await import('../release/load.js');
    return releasesRoot();
  }

  private readonly receiveRelease: ProjectServiceOptions['receiveRelease'];
  private readonly incomingReleases = new Map<string, Promise<void>>();

  /** A failed or unfinished local build owns its directory; a pull must never replace it. */
  private async fetchMissingRelease(id: string): Promise<void> {
    if (!this.receiveRelease) return;
    const { assertReleaseId } = await import('../release/load.js');
    assertReleaseId(id);
    const root = await this.releaseStore();
    try { await fs.promises.lstat(path.join(root, id)); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let operation = this.incomingReleases.get(id);
    if (!operation) {
      operation = this.receiveRelease(id, root).finally(() => this.incomingReleases.delete(id));
      this.incomingReleases.set(id, operation);
    }
    await operation;
  }

  /** Explicit disk inspection: never performed by polling and never alters launch evidence. */
  async inspectInstalledArtifacts(project: string, stack: string, catalogProject: string) {
    const { inspectInstalledArtifacts } = await import('../release/installed-artifacts.js');
    const { installedReleaseCatalog, installedReleaseReport, boundedInstalledNodeRead, installedNodeFailure, installedReadDeadline } = await import('../release/installed-release.js');
    await this.ensureConfig(project);
    const configured = this.getStack(project, stack);
    const catalog = await installedReleaseCatalog(await this.releaseStore(), catalogProject);
    let info = configured;
    if (configured.type !== 'local') {
      this.getSlaveConnector();
      try { info = await installedReadDeadline(() => this.withRemoteAppStatuses(project, configured), 10_000); }
      catch { return installedReleaseReport(catalogProject, stack, catalog, [{ node: stack, error: 'Stack node inventory is unavailable or timed out; installed files were not inspected' }]); }
    }
    const nodes: Array<{ node: string; observations?: import('../shared/dto/installed-release.js').InstalledArtifactObservation[]; error?: string }> = [];
    if (info.type === 'local') {
      const names = info.apps.map(app => app.handleKey);
      try { nodes.push({ node: 'local', observations: names.length ? await inspectInstalledArtifacts(this.orchestrator, names) : [] }); }
      catch { nodes.push({ node: 'local', error: 'Installed-file inspection failed or the process owner is unavailable' }); }
    } else {
      const placements = info.placements ?? [];
      if (placements.length > 16) throw new Error('Installed-file inspection supports up to 16 nodes per stack');
      const deadline = Date.now() + 60_000;
      for (let offset = 0; offset < placements.length; offset += 4) {
        await Promise.all(placements.slice(offset, offset + 4).map(async placement => {
          const node = placement.label ?? placement.nodeKey;
          if (deadline - Date.now() < 55_000) { nodes.push({ node, error: 'Stack inspection time budget exhausted before this node; inspect again' }); return; }
          const names = placement.apps.flatMap(app => app.process ? [app.process.name] : []);
          if (!placement.appsObserved) { nodes.push({ node, error: 'Node inventory is unavailable' }); return; }
          if (!names.length) { nodes.push({ node, error: 'No installed application handles were reported by this node' }); return; }
          try {
            const observations = await boundedInstalledNodeRead(() => this.getSlaveConnector().invokeOnSlave(placement.host, placement.port, 'OmnitronDaemon', 'inspectInstalledArtifacts', [{ names }]));
            nodes.push({ node, observations });
          } catch (error) { nodes.push({ node, error: installedNodeFailure(error) }); }
        }));
      }
    }
    return installedReleaseReport(catalogProject, stack, catalog, nodes);
  }

  /**
   * Take a release for a stack, or say why not.
   *
   * Three things are checked, each refusing by name. The stack's own
   * requirements (`decideStackRelease`): every gate the release recorded
   * passed, the floor it names is among them, every app the stack runs is
   * carried. The disk: the stack definition is still evaluated HERE — the
   * project's config keeps machine-local state beside itself (a generated
   * dev signing key, an admin's saved coverage), so it cannot be run from a
   * snapshot — and therefore this directory must be exactly the release's
   * project commit, or the definition deployed is not the release's. And
   * the statics: a stack whose gateway serves a bundle takes it from the
   * release, built for this stack, or not at all.
   */
  /**
   * Would this release be taken by this stack? Asked without deploying it.
   *
   * The console shows this before an operator presses Deploy, and it is the
   * DEPLOYMENT'S OWN decision — the same `admitRelease` a start runs, with
   * nothing skipped and nothing re-implemented. A second copy of these rules
   * in the browser would drift from these ones within a week, and the only
   * thing worse than a refusal at deploy time is a console that promised the
   * opposite.
   */
  async checkRelease(
    projectName: string,
    stackName: string,
    releaseId: string,
    prepare = false,
  ): Promise<import('../shared/dto/project.js').ReleaseAdmission> {
    let preparedArtifactVolumes: import('../shared/dto/project.js').PreparedArtifactVolume[] | undefined;
    try {
      const config = await this.loadProjectConfig(projectName);
      const stacks = this.resolveStacks(config, projectName);
      const stackConfig = stacks[stackName];
      if (!stackConfig) throw new Error(`Stack '${stackName}' not found in project '${projectName}'`);
      this.assertStartAuthority({ project: projectName, stack: stackName }, stackConfig);
      if (prepare && this.receiveRelease) await this.fetchMissingRelease(releaseId);
      const release = await this.admitRelease(projectName, stackName, stackConfig, config, releaseId, 'check');
      let retiring: string[] = [];
      if (stackConfig.type === 'local') {
        const inspected = artifactVolumeBindings(mergeInfrastructure(config, stackConfig)).length
          ? await this.installedRelease(projectName, stackName, stackConfig, config, release, prepare) : undefined;
        const entries = inspected?.entries ?? await this.installedEntries(projectName, stackName, stackConfig, config, release, prepare);
        if (prepare && inspected) preparedArtifactVolumes = inspected.preparedArtifactVolumes;
        const prior = this.localSelection(projectName, stackName).read().release;
        if (prior?.id === release.id && prior.manifestSha256 !== release.manifestSha256) throw new Error('Selected manifest changed on disk');
        const plan = await this.checkLocalOwner(projectName, stackName, entries, prior?.id !== release.id);
        if (artifactVolumeBindings(mergeInfrastructure(config, stackConfig)).length && prior?.id !== release.id && plan.phase !== 'stopped')
          throw new LocalReleaseStopRequired('Stop this local stack before changing its immutable artifact volumes');
        const target = new Set(entries.map(entry => ProjectService.handleKey(projectName, stackName, entry.name)));
        retiring = plan.apps.filter(app => !target.has(app.name)).map(app => app.name);
      }
      const gates = release.manifest.gates;
      const passed = gates.filter((g) => g.status === 'passed').length;
      return {
        ok: true,
        ...(preparedArtifactVolumes?.length && { preparedArtifactVolumes }),
        because:
          `${projectName}/${stackName} would take ${release.id}: ${passed} of ${gates.length} gates passed, ` +
          `${release.files.length} artifact(s) match the manifest` +
          `${release.staticsDir ? `, static bundle built for ${release.manifest.statics?.stack}` : ''}.` +
          (retiring.length ? ` After a confirmed whole-stack stop, reconciliation will retire these application registrations: ${retiring.join(', ')}. Logs, artifacts and infrastructure are preserved.` : ''),
      };
    } catch (err) {
      const { LocalReleaseNotPreparedError } = await import('../release/local-installation.js');
      const { MissingReleaseError } = await import('../release/load.js');
      if (!prepare && this.receiveRelease && err instanceof MissingReleaseError) {
        return {
          ok: false, state: 'missing', because: `Release ${releaseId} is absent from this controller. Fetch it from the configured release store and check target admission.`,
        };
      }
      return { ok: false, because: (err as Error).message,
        ...(err instanceof LocalReleaseNotPreparedError && { state: 'unprepared' as const }),
        ...(err instanceof LocalReleaseStopRequired && { state: 'requires-stop' as const,
          ...(preparedArtifactVolumes?.length && { preparedArtifactVolumes }) }) };
    }
  }

  /**
   * Run a release's probes on the node of the stack that carries it, and
   * hand back what the producer printed and how it exited.
   *
   * Deciding whether to KEEP the result is not done here: that is
   * `release/attest.ts`, reached through the release service, which also
   * holds the audit trail the freshness refusal needs. This method is the
   * transport — the release's own scripts and the stack definition at its
   * commit, uploaded and run on the node under its deploy lease, so an
   * attestation never interleaves with a deployment.
   *
   * One node only, and refused by name otherwise. The probes reach
   * `localhost` and the stack's containers; on a stack of several nodes one
   * run measures one machine, and an attestation is stored per STACK — kept
   * as it is, it would claim for all of them what was measured on one.
   */
  async attestOnNode(
    projectName: string,
    stackName: string,
    releaseId: string,
  ): Promise<{
    stdout: string;
    stderr: string;
    code: number;
    node: string;
    scriptsFrom: 'release' | 'history';
    sourceFiles: number;
    accounts: AttestAccounts;
  }> {
    const config = await this.loadProjectConfig(projectName);
    const stacks = this.resolveStacks(config, projectName);
    const stackConfig = stacks[stackName];
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found in project '${projectName}'`);
    if (stackConfig.type === 'local') {
      throw new Error(
        `${projectName}/${stackName} is local: its probes run on this machine with \`node scripts/attest.mjs --stack=${stackName}\`, and need no transport`,
      );
    }
    // The probes write to the system they measure — accounts, organisations,
    // payments accounts with their deposit addresses (on sample/test, 2026-09-24:
    // 91 probe organisations in the public catalogue, 10 mainnet addresses on
    // accounts nobody owns). So they run only where a stack said they may,
    // and never on one that takes other stacks' attestations: a stack that
    // declares `verifiedOn` is where people are, and is verified elsewhere.
    const releaseRules = stackConfig.release;
    if (releaseRules?.verifiedOn) {
      throw new Error(
        `${projectName}/${stackName} takes releases verified on '${releaseRules.verifiedOn.stack}' — it is verified there, ` +
          `and the probes, which write accounts and organisations into what they measure, do not run here`,
      );
    }
    if (!releaseRules?.attest) {
      throw new Error(
        `${projectName}/${stackName} does not declare \`release.attest\` — the probes write accounts and organisations ` +
          `into the stack they measure, and run only on a stack that said they may`,
      );
    }
    const nodes = stackConfig.nodes ?? [];
    if (nodes.length === 0) throw new Error(`${projectName}/${stackName} has no nodes to run the probes on`);
    if (nodes.length > 1) {
      throw new Error(
        `${projectName}/${stackName} has ${nodes.length} nodes. The probes reach localhost and the stack's containers, so one run ` +
          `measures one machine, and an attestation is stored per stack — it would claim for ${nodes.length} what was measured ` +
          `on 1. Not supported until attestations are kept per node.`,
      );
    }
    const project = this.registry.get(projectName);
    if (!project) throw new Error(`Project '${projectName}' is not in the registry`);

    const { loadRelease } = await import('../release/load.js');
    const release = await loadRelease(releaseId, await this.releaseStore());
    const { stageAttestation, attestationCommand, producerProvisions } = await import('../release/attest-on-node.js');
    const staged = await stageAttestation({
      releaseRoot: release.root,
      projectPath: fs.realpathSync(project.path),
      projectCommit: release.manifest.project.commit,
    });
    // The stack decides whether its probes may create accounts; the release's
    // producer decides whether it can. Both, or the flag is not passed — a
    // producer handed a flag it does not know measures nothing (exit 2).
    const accounts: AttestAccounts =
      stackConfig.release?.attest?.provision !== true
        ? 'not-declared'
        : producerProvisions(staged.dir)
          ? 'provisioned'
          : 'producer-cannot';
    const target = await this.targetForStackNode(nodes[0]!);
    const machine = `${target.host}:${target.sshPort ?? 22}`;
    const containerPrefix = stackConfig.settings?.containerPrefix ?? `${projectName}-${stackName}`;
    try {
      return await this.deployer.underLease(target, `attestation of ${releaseId} on ${projectName}/${stackName}`, async () => {
        const { remoteDir } = await this.deployer.uploadStaticBundle(target, staged.dir, '/opt/omnitron/attest');
        this.logger.info(
          {
            project: projectName,
            stack: stackName,
            release: releaseId,
            node: machine,
            remoteDir,
            scriptsFrom: staged.scriptsFrom,
            sourceFiles: staged.sourceFiles,
            accounts,
          },
          'Running the release\'s probes on its node',
        );
        try {
          // Through the data channel: the producer's line is evidence to
          // store, and a probe's output that said `password=…` was cut by
          // the transport's masker through its closing quote.
          const run = await this.deployer.readFromNode(
            target,
            attestationCommand({ projectName, remoteDir, stack: stackName, releaseId, containerPrefix, provision: accounts === 'provisioned' }),
          );
          return { ...run, node: machine, scriptsFrom: staged.scriptsFrom, sourceFiles: staged.sourceFiles, accounts };
        } finally {
          // The stage carries the application's source. The run's output is
          // the record, kept on this side; the node keeps its artifacts and
          // not a copy of the code they were built from. With its marker, so
          // the next run uploads again instead of trusting a directory gone.
          //
          // This ended in `.catch(() => undefined)`, which catches a throw —
          // and `runOnNode` answers a failed command with its exit code, over
          // a transport that turns even an unreachable node into `exit 1`. An
          // `rm` the node refused left the source where it was, the
          // attestation finished without a word, and nothing else ever
          // removes `/opt/omnitron/attest/`. So it is said here, and only
          // said: the probes' result stands, since this `rm` measured none of
          // it, and a failure in a `finally` must not replace what it guards.
          const { shellEscape } = await import('../shared/shell-escape.js');
          const removed = await this.deployer
            .runOnNode(target, `rm -rf ${shellEscape(remoteDir)} ${shellEscape(`${remoteDir}.delivered`)}`, 60_000)
            .catch((err: unknown) => ({ stdout: '', stderr: err instanceof Error ? err.message : String(err), code: -1 }));
          if (removed.code !== 0) {
            const words = (removed.stderr || removed.stdout).trim().split('\n').slice(-3).join(' | ');
            this.logger.warn(
              {
                project: projectName,
                stack: stackName,
                release: releaseId,
                node: machine,
                remoteDir,
                code: removed.code,
                reason: words || `exit ${removed.code}`,
              },
              'The release\'s source is still on the node after its probes, and nothing else removes it',
            );
          }
        }
      });
    } finally {
      fs.rmSync(staged.dir, { recursive: true, force: true });
    }
  }

  /**
   * Make a named account with a platform role on a remote stack, and keep
   * its password in this daemon's vault — never in the answer.
   *
   * The project's own tool makes it (`scripts/operator-account.mjs` at the
   * project's HEAD commit), on the stack's node, under its deploy lease
   * (`withOperatorTool`). The password comes back sealed to a key made for
   * this run and is opened only to go into the vault — the SSH layer masks
   * anything that looks like a password on its way back (see
   * `project/operator-account.ts`).
   *
   * Two steps that must both happen or neither: the account on the stand and
   * its password in the vault. The vault is asked first whether the key is
   * free — a key already there is somebody's secret, and a new password would
   * replace it — and if the write still fails, the account just made is taken
   * away again, by its name AND the id the tool printed: an account whose
   * password nobody holds is a privileged row under a name every later run
   * refuses as taken. When the run's outcome is not known at all, the stand is
   * asked what it holds, and the answer says it — with the command that takes
   * the account away if it is there.
   */
  async createOperatorAccount(
    projectName: string,
    stackName: string,
    input: {
      username: string;
      role?: string | undefined;
      displayName?: string | undefined;
      vaultKey?: string | undefined;
    },
  ): Promise<import('../shared/dto/project.js').IStackAccount> {
    const secrets = this.secrets;
    if (!secrets) {
      throw new Error('This daemon has no vault: a password made on the node would have nowhere to go, so nothing was made');
    }
    const username = input.username?.trim();
    if (!username) throw new Error('An account needs a name (--username)');
    const tool = await import('../project/operator-account.js');
    const vaultKey = input.vaultKey?.trim() || tool.accountVaultKey(projectName, stackName, username);
    // Before the node is touched.
    if ((await secrets.get(vaultKey)) !== null) {
      throw new Error(
        `The vault already holds '${vaultKey}' — somebody's secret, which a new password would replace. ` +
          'Name another key with --vault-key; nothing was made',
      );
    }
    const key = await tool.sealingKey();

    return this.withOperatorTool(projectName, stackName, `operator account ${username}`, async (on) => {
      const facts = { project: projectName, stack: stackName, node: on.machine, username };
      const run = await on.run(
        (remoteDir, containerPrefix) =>
          tool.operatorAccountCommand({ projectName,
            remoteDir,
            containerPrefix,
            username,
            role: input.role,
            displayName: input.displayName,
            sealTo: key.spki,
          }),
        180_000,
      );
      const outcome = tool.readAccountRun(run, username, (sealed) => key.open(sealed));
      if (!outcome.made) {
        this.logger.error({ ...facts, code: run.code, uncertain: outcome.uncertain }, 'No operator account was made');
        // Not known whether it exists: ask the stand, so the answer can say
        // what is there and how to take it away.
        let holds = '';
        if (outcome.uncertain) {
          const shown = tool.readShowRun(
            await on.run((remoteDir, containerPrefix) => tool.operatorAccountShowCommand({ projectName, remoteDir, containerPrefix, username }), 60_000),
          );
          holds = !shown.ok
            ? ` What the stand holds could not be read either: ${shown.because}`
            : shown.account
              ? ` The stand holds ${username}: id ${shown.account.id}, role ${shown.account.role}, made ${shown.account.createdAt ?? '(unknown)'}, ` +
                `${shown.account.lastActiveAt ? `last active ${shown.account.lastActiveAt}` : 'never signed in'}. Nobody holds its password; ` +
                `take it away with \`omnitron stack account ${projectName} ${stackName} --remove ${username} --id ${shown.account.id}\``
              : ` The stand holds no ${username} — nothing was made.`;
        }
        throw new Error(`${on.where}: ${outcome.because}.${holds}`);
      }
      const { account } = outcome;
      try {
        await secrets.set(vaultKey, account.password);
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        const undo = tool.readRemoveRun(
          await on.run(
            (remoteDir, containerPrefix) =>
              tool.operatorAccountRemoveCommand({ projectName, remoteDir, containerPrefix, username, id: account.id }),
            120_000,
          ),
          username,
          account.id,
        );
        this.logger.error(
          { ...facts, id: account.id, vaultKey, undone: undo.removed, error: why },
          'The vault refused an operator account\'s password',
        );
        throw new Error(
          undo.removed
            ? `${on.where}: the vault refused the password of ${username} (${why}) — the account was taken away again; nothing is left on the stand`
            : `${on.where}: the vault refused the password of ${username} (${why}), and taking the account away failed too ` +
                `(${undo.because}): ${username} (id ${account.id}) is on the stand with a password nobody holds`,
          { cause: err },
        );
      }
      this.logger.info(
        { ...facts, role: account.role, id: account.id, vaultKey, commit: on.commit },
        'Operator account made — its password is in the vault',
      );
      return { username, role: account.role, id: account.id, node: on.machine, vaultKey, commit: on.commit };
    });
  }

  /**
   * The stack's maintenance lock by hand (`maintenance-lock.ts`): the state
   * as its gateway enforces it, or held for a bounded time, or let go — a lock
   * a failed deployment left (it also expires by itself), or work outside a
   * deployment. Not under the node's deploy lease: letting go of the lock is
   * exactly what an operator does while a stuck deployment holds that lease.
   * Only omnitron's keys; the administrators' mode is main's, in /admin.
   */
  async stackMaintenance(
    projectName: string,
    stackName: string,
    request: { action: 'status' | 'on' | 'off'; minutes?: number | undefined },
  ): Promise<import('../shared/dto/project.js').IStackMaintenance> {
    const config = await this.loadProjectConfig(projectName);
    const stackConfig = this.resolveStacks(config, projectName)[stackName];
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found in project '${projectName}'`);
    if (stackConfig.type === 'local') {
      throw new Error(`${projectName}/${stackName} is local: its gateway is on this machine, and so is anyone using it`);
    }
    const nodes = stackConfig.nodes ?? [];
    if (nodes.length !== 1) {
      throw new Error(
        `${projectName}/${stackName} has ${nodes.length} node(s); which one runs the gateway is not decided here — one is supported`,
      );
    }
    const lockModule = await import('./maintenance-lock.js');
    const target = await this.targetForStackNode(nodes[0]!);
    const prefix = stackConfig.settings?.containerPrefix ?? `${projectName}-${stackName}`;
    // Where the gateway that is RUNNING reads — asked of it, not computed: by
    // hand one acts on the platform as it is.
    const site = await lockModule.runningGatewaySite(this.deployer.leaseRunner(target), prefix, 'by-hand');
    if (!site) throw new Error(`${projectName}/${stackName} has no running gateway (${prefix}-gateway) on ${target.host}`);
    if (request.action === 'on') {
      await lockModule.holdByHand(site, request.minutes ?? 15);
    } else if (request.action === 'off') {
      await lockModule.releaseByHand(site);
    } else if (request.action !== 'status') {
      throw new Error(`'${String(request.action)}' is not a maintenance action — status, on or off`);
    }
    // What the gateway enforces — asked after its 2-second cache has turned.
    if (request.action !== 'status') await new Promise((resolve) => setTimeout(resolve, 2_500));
    const state = await lockModule.readMaintenanceState(site);
    this.logger.info(
      { project: projectName, stack: stackName, action: request.action, active: state.active, reason: state.reason },
      'Maintenance lock by hand',
    );
    return { where: `${projectName}/${stackName} on ${target.host}`, ...state };
  }

  /**
   * What the probes left on a stand — the project's own census of it,
   * `scripts/probe-leftovers.mjs` without a flag: SELECTs and nothing else,
   * the accounts, organisations and orphans it would take and what would hold
   * each back. Its removal is not a door here: that takes the owner's word
   * each time, and this census is what the word is given on.
   */
  async probeLeftovers(
    projectName: string,
    stackName: string,
    request: {
      mode: import('../project/operator-account.js').LeftoversMode;
      /** Accounts no template matches, named after reading the census. */
      also?: readonly string[] | undefined;
    },
  ): Promise<import('../shared/dto/project.js').IStackLeftoversCensus> {
    const tool = await import('../project/operator-account.js');
    const mode = request.mode;
    if (mode !== 'census' && mode !== 'rehearse' && mode !== 'apply') {
      throw new Error(`'${String(mode)}' is not asked for from here — the census, a rehearsal, or the removal`);
    }
    const what =
      mode === 'census'
        ? 'census of what the probes left'
        : mode === 'rehearse'
          ? 'rehearsal of removing what the probes left'
          : 'removal of what the probes left';
    return this.withOperatorTool(
      projectName,
      stackName,
      what,
      async (on) => {
        const read = tool.readLeftoversRun(
          await on.run(
            (remoteDir, containerPrefix) => tool.probeLeftoversCommand({ projectName, remoteDir, containerPrefix, mode, also: request.also }),
            // A rehearsal or a removal runs every database's removal and its
            // invariants — longer than counting.
            mode === 'census' ? 300_000 : 900_000,
          ),
          mode,
        );
        if (!read.ok) throw new Error(`${on.where}: could not take the ${what}: ${read.because}`);
        return { node: on.machine, commit: on.commit, mode, report: read.census.report, lines: read.census.lines };
      },
      tool.PROBE_LEFTOVERS_TOOL,
    );
  }

  /**
   * The stand's accounts counted — by role, by status, by the form their MFA
   * data is in, and whether the seeded admin still opens with its published
   * password. Counts only. For decisions that depend on what a stand holds
   * without reading it: a new MFA root cannot open what the old one sealed,
   * so how many rows are sealed is asked first.
   */
  async censusOperatorAccounts(
    projectName: string,
    stackName: string,
  ): Promise<import('../shared/dto/project.js').IStackAccountCensus> {
    const tool = await import('../project/operator-account.js');
    return this.withOperatorTool(projectName, stackName, 'census of accounts', async (on) => {
      // Three minutes, not one: the census checks privileged accounts against
      // every password the repository publishes with bcrypt at the stand's
      // cost — 18 s for 17 accounts on the dev stand.
      const read = tool.readCensusRun(
        await on.run((remoteDir, containerPrefix) => tool.operatorCensusCommand({ projectName, remoteDir, containerPrefix }), 180_000),
      );
      if (!read.ok) throw new Error(`${on.where}: could not take the census: ${read.because}`);
      return { node: on.machine, commit: on.commit, census: read.census };
    });
  }

  /** What a remote stack's stand holds under a name — never a secret. */
  async showOperatorAccount(
    projectName: string,
    stackName: string,
    username: string,
  ): Promise<import('../shared/dto/project.js').IStackAccountLookup> {
    const name = username?.trim();
    if (!name) throw new Error('Which account? (--show <name>)');
    const tool = await import('../project/operator-account.js');
    return this.withOperatorTool(projectName, stackName, `reading operator account ${name}`, async (on) => {
      const shown = tool.readShowRun(
        await on.run((remoteDir, containerPrefix) => tool.operatorAccountShowCommand({ projectName, remoteDir, containerPrefix, username: name }), 60_000),
      );
      if (!shown.ok) throw new Error(`${on.where}: could not read ${name}: ${shown.because}`);
      return { node: on.machine, commit: on.commit, account: shown.account };
    });
  }

  /**
   * Take an account away from a remote stack's stand — the row with this
   * name AND this id, or nothing — and the password this daemon keeps for it,
   * if it keeps one: a password for an account that is gone is not a secret
   * worth keeping, and a vault that still lists it says the account exists.
   */
  async removeOperatorAccount(
    projectName: string,
    stackName: string,
    input: { username: string; id: string; vaultKey?: string | undefined },
  ): Promise<import('../shared/dto/project.js').IStackAccountRemoved> {
    const username = input.username?.trim();
    const id = input.id?.trim();
    if (!username || !id) throw new Error('Taking an account away needs its name and its id (--remove <name> --id <uuid>)');
    const tool = await import('../project/operator-account.js');
    const vaultKey = input.vaultKey?.trim() || tool.accountVaultKey(projectName, stackName, username);
    const removed = await this.withOperatorTool(projectName, stackName, `removing operator account ${username}`, async (on) => {
      const outcome = tool.readRemoveRun(
        await on.run((remoteDir, containerPrefix) => tool.operatorAccountRemoveCommand({ projectName, remoteDir, containerPrefix, username, id }), 120_000),
        username,
        id,
      );
      if (!outcome.removed) throw new Error(`${on.where}: ${username} (id ${id}) was not removed: ${outcome.because}`);
      return { node: on.machine, commit: on.commit };
    });
    // After the stand, never before: a key removed for an account that stayed
    // would be a password lost.
    const dropped = (await this.secrets?.delete(vaultKey)) === true;
    this.logger.info(
      { project: projectName, stack: stackName, node: removed.node, username, id, vaultKey: dropped ? vaultKey : null },
      'Operator account removed',
    );
    return { username, id, node: removed.node, commit: removed.commit, vaultKeyRemoved: dropped ? vaultKey : null };
  }

  /**
   * The release this stack last started with, as the audit trail recorded it
   * (`stack.start`, `details.release`) — or null: no trail, no start, or a
   * start that was not a release.
   */
  private async releaseRunningOn(projectName: string, stackName: string): Promise<string | null> {
    if (!this.audit) return null;
    try {
      const rows = await this.audit.latestPerResource('stack.start');
      const row = rows.find((r) => r.resourceId === `${projectName}/${stackName}`);
      const release = row?.details?.['release'];
      return typeof release === 'string' && release !== '[object]' ? release : null;
    } catch (err) {
      this.logger.warn(
        { project: projectName, stack: stackName, error: (err as Error).message },
        'The audit trail could not be read — which release runs on this stack is unknown',
      );
      return null;
    }
  }

  /**
   * What every operator-account action shares: a remote stack of one node,
   * the project's tool staged from its HEAD commit, the node's deploy lease,
   * and the stage taken away again on both sides, whatever `work` did.
   *
   * One node, like the attestation: the tool reaches the node's containers,
   * and which of several nodes holds the stack's database is not decided
   * here.
   */
  private async withOperatorTool<T>(
    projectName: string,
    stackName: string,
    purpose: string,
    work: (on: {
      run: (
        command: (remoteDir: string, containerPrefix: string) => string,
        timeoutMs: number,
      ) => Promise<{ stdout: string; stderr: string; code: number }>;
      machine: string;
      where: string;
      commit: string;
    }) => Promise<T>,
    /** The project's tool the work runs — its commit must have it. */
    toolPath?: string,
  ): Promise<T> {
    const config = await this.loadProjectConfig(projectName);
    const stackConfig = this.resolveStacks(config, projectName)[stackName];
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found in project '${projectName}'`);
    const tool = await import('../project/operator-account.js');
    if (stackConfig.type === 'local') {
      throw new Error(
        `${projectName}/${stackName} is local: its containers are on this machine — run ` +
          `\`node ${tool.OPERATOR_ACCOUNT_TOOL}\` in the project`,
      );
    }
    const nodes = stackConfig.nodes ?? [];
    if (nodes.length === 0) throw new Error(`${projectName}/${stackName} has no node to reach its stand on`);
    if (nodes.length > 1) {
      throw new Error(
        `${projectName}/${stackName} has ${nodes.length} nodes. The tool reaches one node's containers, and which of them ` +
          'holds the stack\'s database is not decided here — not supported until it is',
      );
    }
    const project = this.registry.get(projectName);
    if (!project) throw new Error(`Project '${projectName}' is not in the registry`);

    const staged = await tool.stageOperatorTool(fs.realpathSync(project.path), toolPath ?? tool.OPERATOR_ACCOUNT_TOOL);
    const target = await this.targetForStackNode(nodes[0]!);
    const machine = `${target.host}:${target.sshPort ?? 22}`;
    const containerPrefix = stackConfig.settings?.containerPrefix ?? `${projectName}-${stackName}`;
    const { shellEscape } = await import('../shared/shell-escape.js');
    try {
      return await this.deployer.underLease(target, `${purpose} on ${projectName}/${stackName}`, async () => {
        const { remoteDir } = await this.deployer.uploadStaticBundle(target, staged.dir, '/opt/omnitron/operator');
        try {
          return await work({
            // The tool's answer line is data; the sealed password needs no
            // help past the masker, and the rest of the line gets it here.
            run: (command, timeoutMs) => this.deployer.readFromNode(target, command(remoteDir, containerPrefix), timeoutMs),
            machine,
            where: `${projectName}/${stackName} on ${machine}`,
            commit: staged.commit,
          });
        } finally {
          // The tool leaves the node with its run, as the attestation's stage
          // does, and a removal the node refused is said rather than swallowed.
          const removed = await this.deployer
            .runOnNode(target, `rm -rf ${shellEscape(remoteDir)} ${shellEscape(`${remoteDir}.delivered`)}`, 60_000)
            .catch((err: unknown) => ({ stdout: '', stderr: err instanceof Error ? err.message : String(err), code: -1 }));
          if (removed.code !== 0) {
            this.logger.warn(
              {
                project: projectName,
                stack: stackName,
                node: machine,
                remoteDir,
                code: removed.code,
                reason: removed.stderr.trim().split('\n').slice(-3).join(' | ') || `exit ${removed.code}`,
              },
              'The operator tool is still on the node after its run, and nothing else removes it',
            );
          }
        }
      });
    } finally {
      fs.rmSync(staged.dir, { recursive: true, force: true });
    }
  }

  /**
   * The paths of the working tree a deployment of this stack reads, relative
   * to its root — what admission requires to be the release's commit.
   *
   * The definition (`release/definition-inputs.ts`), and the directories the
   * deployment ships to its nodes (`shippedDirsOf`): the gateway's nginx tree,
   * a service's scripts. Those were read from the working tree and compared
   * with nothing, so an uncommitted edit to the gateway's template reached the
   * test node past every gate a release has.
   */
  private async deploymentReads(
    projectName: string,
    stackConfig: IStackConfig,
    config: IEcosystemConfig,
    root: string,
    definitions?: Map<string, IAppDefinition>,
  ): Promise<string[]> {
    const { definitionInputs } = await import('../release/definition-inputs.js');
    const { shippedDirsOf } = await import('../infrastructure/shipped-config.js');
    const shipped = shippedDirsOf(
      mergeInfrastructure(config, stackConfig),
      await this.collectDeclaredServices(projectName, stackConfig, config, { definitions }),
    );
    return definitionInputs(
      root,
      this.resolveStackApps(stackConfig, config).flatMap((a) => (a.bootstrap ? [resolveAppPath(root, a, a.bootstrap)] : [])),
      shipped.map(([, dir]) => dir),
    );
  }

  private async admitRelease(
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    config: IEcosystemConfig,
    releaseId: string,
    purpose: 'deploy' | 'check' = 'deploy',
  ): Promise<AdmittedRelease> {
    if (stackConfig.type === 'local' && stackConfig.managedOrigin)
      throw new Error('A node allocation takes its release from its owning controller');
    const { loadRelease, treeEqualsCommit } = await import('../release/load.js');
    const { decideStackRelease } = await import('../release/manifest.js');
    const release = await loadRelease(releaseId, await this.releaseStore());

    const configuredApps = this.resolveStackApps(stackConfig, config);
    if (stackConfig.type !== 'local' && configuredApps.some(entry => entry.releaseFrom || release.manifest.artifacts.some(artifact => artifact.app === entry.name && artifact.origin)))
      throw Error('Imported applications require verified local release installation. Remote admission needs producer-captured deployment declarations and a compatible execution owner.');
    const mounted = artifactVolumeEntries(mergeInfrastructure(config, stackConfig), config.apps);
    if (mounted.length && (stackConfig.type !== 'local' || stackConfig.managedOrigin || !ownsStackInfrastructure(stackConfig)))
      throw Error('Artifact volumes require an independently owned local stack');
    const apps = [...new Set([...configuredApps, ...mounted].map(a => a.name))];
    // The fourth argument, which was `[]` for as long as nothing wrote one:
    // a stack declaring `verifiedOn` refused every release forever, with a
    // refusal that read «nothing has been verified on 'test'» while there
    // was no way for anything to be. See `release/attest.ts`.
    const { loadAttestations } = await import('../release/attest.js');
    const attestations = loadAttestations(release.id, await this.releaseStore());
    const verdict = decideStackRelease(release.manifest, stackConfig.release, apps, attestations);
    if (verdict.action === 'refuse') {
      throw new Error(`Refusing release ${release.id} for ${projectName}/${stackName}: ${verdict.because}.`);
    }

    // A migration that ran on this stack is history: the release running
    // here says which ran, and a file among them that changed since is
    // refused now — not at the migration step, after the build and the
    // transfer. See `release/migrations.ts`.
    const running = await this.releaseRunningOn(projectName, stackName);
    if (!running) {
      this.logger.info(
        { project: projectName, stack: stackName },
        'No release is recorded as running on this stack — applied migrations are not compared',
      );
    } else if (running !== release.id) {
      let previous: import('../release/manifest.js').ReleaseManifest | undefined;
      try {
        previous = (await loadRelease(running, await this.releaseStore())).manifest;
      } catch (err) {
        this.logger.warn(
          { project: projectName, stack: stackName, running, error: (err as Error).message },
          'The release running on this stack could not be read — its migrations are not compared',
        );
      }
      if (previous) {
        const { changedImportedMigrations } = await import('../release/migrations.js');
        const imported = changedImportedMigrations(previous, release.manifest, apps);
        if (imported.length) throw Error('Refusing release ' + release.id + ': imported migration history changed (' + imported.slice(0, 5).join(', ') + '). Preserve applied migrations in the producer package.');
      } else if (release.manifest.artifacts.some(artifact => apps.includes(artifact.app) && artifact.origin)) {
        throw Error('Cannot verify imported migration history because the previously running release is unavailable: ' + running);
      }
      const ran = previous?.migrations;
      if (ran && release.manifest.migrations) {
        const { changedReleasedMigrations } = await import('../release/migrations.js');
        const changed = changedReleasedMigrations(ran, release.manifest.migrations);
        if (changed.length > 0) {
          throw new Error(
            `Refusing release ${release.id} for ${projectName}/${stackName}: ${changed.length} migration(s) that ran here ` +
              `with ${running} changed or went away (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', …' : ''}). ` +
              `An applied migration is history — put the change in a new migration.`,
          );
        }
      } else {
        this.logger.info(
          { project: projectName, stack: stackName, running },
          'A release without migration digests on one side — applied migrations are not compared this time',
        );
      }
    }

    const project = this.registry.get(projectName);
    if (!project) throw new Error(`Project '${projectName}' is not in the registry`);
    const commit = release.manifest.project.commit;
    if (stackConfig.type === 'local') {
      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A local release requires a full source commit');
      const { promisify } = await import('node:util');
      const { execFile } = await import('node:child_process');
      const { stdout } = await promisify(execFile)('git', ['rev-parse', '--show-prefix'], { cwd: project.path });
      const directory = stdout.trimEnd().replace(/\/$/, '');
      if (directory !== (release.manifest.project.directory ?? ''))
        throw new Error('This local release belongs to another project directory in the repository');
    }
    // Only what the definition reads has to be the release's. A failed input
    // inventory cannot be replaced by a narrower or unverified comparison.
    const root = fs.realpathSync(project.path);
    // Local admission materializes the verified package itself. On remote deployments
    // the old single-project bootstrap still supplies its code declarations; its data
    // file must come from the admitted archive, including when that file is absent.
    let remoteDefinitions: Map<string, IAppDefinition> | undefined;
    if (stackConfig.type !== 'local') {
      const entries = this.resolveStackApps(stackConfig, config);
      const archived = new Map<string, DeclaredConfig>();
      for (const entry of entries) {
        if (entry.bootstrap) archived.set(entry.name, await readArchiveInfrastructure(release, entry.name));
      }
      remoteDefinitions = await this.loadAppDefinitions(projectName, stackConfig, config, entries, archived);
    }
    let inputs: string[] | undefined;
    try {
      // Local launches read executable app declarations from the verified installation. Only
      // project-level configuration and explicitly mounted infrastructure still come from Git.
      if (stackConfig.type === 'local') {
        const { definitionInputs } = await import('../release/definition-inputs.js');
        const { shippedDirsOf } = await import('../infrastructure/shipped-config.js');
        inputs = await definitionInputs(root, [], shippedDirsOf(mergeInfrastructure(config, stackConfig), {}).map(([, dir]) => dir));
        if (!inputs.length) throw new Error('No registered configuration inputs are available');
      } else inputs = await this.deploymentReads(projectName, stackConfig, config, root, remoteDefinitions);
    } catch (err) {
      throw new Error(`Cannot verify deployment inputs for ${projectName}/${stackName}: ${(err as Error).message}`, { cause: err });
    }
    const tree = await treeEqualsCommit(root, commit, inputs);
    if (!tree.equal) {
      throw new Error(
        `Refusing release ${release.id} for ${projectName}/${stackName}: ` +
          `${inputs ? `of the ${inputs.length} path(s) the stack definition and what it ships are read from, ` : ''}` +
          `${tree.files.length} differ from its commit ${commit.slice(0, 8)} ` +
          `(${tree.files.slice(0, 5).join(', ')}${tree.files.length > 5 ? ', …' : ''}). ` +
          `The definition is read from ${project.path}, so those have to be the release's: commit or set them aside, ` +
          `check out ${commit.slice(0, 8)}, or build a release from what is here.`,
      );
    }

    // Admission and installation use the same native resident/runtime proof.
    // A frozen application supplies its own SDK; a controller build is not its runtime.
    const { refuseReleaseOwners } = await import('../release/owner-admission.js');
    const incompatible = stackConfig.type === 'local' ? null : refuseReleaseOwners(release.manifest, stackConfig, configuredApps,
      await this.askReleaseOwners(stackConfig, configuredApps));
    if (incompatible) {
      throw new Error(`Refusing release ${release.id} for ${projectName}/${stackName}: ${incompatible}.`);
    }

    const infra = mergeInfrastructure(config, stackConfig) as
      | { gateway?: { staticDir?: string }; services?: Record<string, { config?: { staticDir?: string } }> }
      | undefined;
    const servesStatics = Boolean(infra?.services?.['gateway']?.config?.staticDir ?? infra?.gateway?.staticDir);
    if (servesStatics && stackConfig.type === 'local')
      throw new Error('This local gateway serves a working-tree static directory; an immutable local gateway binding is required');
    if (servesStatics && (!release.staticsDir || release.manifest.statics?.stack !== stackName)) {
      throw new Error(
        `Refusing release ${release.id} for ${projectName}/${stackName}: the stack's gateway serves a static bundle, and the ` +
          `release carries ${release.manifest.statics ? `one built for '${release.manifest.statics.stack}'` : 'none'} — ` +
          `\`omnitron release build ${projectName} --for ${stackName}\` builds it with this stack's environment.`,
      );
    }

    this.logger.info(
      {
        project: projectName,
        stack: stackName,
        release: release.id,
        because: verdict.because,
        projectCommit: commit.slice(0, 8),
        omniCommit: release.manifest.omni.commit.slice(0, 8),
      },
      purpose === 'check' ? 'Release would be admitted — asked, not deployed' : 'Release admitted',
    );
    return remoteDefinitions ? { ...release, remoteDefinitions } : release;
  }

  /** Inspect exactly the nodes that will execute applications. Delivery repeats
   * this OS/private-Netron proof; version suffixes never substitute for it. */
  private async askReleaseOwners(
    stackConfig: IStackConfig, apps: readonly IEcosystemAppEntry[],
  ): Promise<Array<import('../release/owner-admission.js').ReleaseOwnerAnswer>> {
    return Promise.all(
      resolveNodePlacements(stackConfig, apps).filter(placement => placement.apps.length).map(async ({ node }) => {
        try {
          const bundle = await this.deployer.inspectInstalledBundle(await this.targetForStackNode(node));
          return { host: node.host, port: node.port ?? 9700,
            ...(bundle.applicationRuntime && { runtime: bundle.applicationRuntime }) };
        } catch (err) {
          return { host: node.host, port: node.port ?? 9700, error: describeFailure(err) };
        }
      }),
    );
  }

  /**
   * What a restart of THIS daemon may do to a remote stack: look, not ship.
   *
   * Boot and the enabled-stacks reconciler resumed every enabled stack through
   * a full start, and for a remote stack a full start is a deployment — build,
   * deliver, restart — of whatever this machine's working tree holds, onto
   * machines other people deploy to as well. Measured 2026-09-22: a master
   * restarted on a clean tree shipped its tree to the one test server by
   * itself (`source: 'auto-resume'`, 13:56:56 → 14:00:05, five applications
   * restarted onto new artifacts); the three restarts before it that morning
   * were stopped only because the tree happened to be dirty — a condition
   * that has nothing to do with intent, and a clean tree of an old commit
   * passes it as easily. Every development machine with the stack enabled did
   * the same, on every restart, past every gate.
   *
   * The applications on a node are supervised by the node's own daemon. What
   * this master lost in its restart is its own picture of them, so that is
   * what is rebuilt: the nodes are asked what they run, and the answer becomes
   * the stack's state — `running`, or `degraded` when some application is not
   * online (the node restarts its own; this master does not ship over it). A
   * stack no node answered for is an error the reconciler retries, by asking
   * again. Deploying stays something an operator asks for.
   */
  private async attachRemoteStack(
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    source: StackStartSource,
  ): Promise<IStackInfo> {
    const { info, answered } = await this.askNodes(projectName, this.toStackInfo(projectName, stackName, stackConfig));
    const why = source === 'boot' ? 'a daemon boot' : 'an automatic resume';
    if (answered === 0) {
      throw new Error(
        `Not deploying ${projectName}/${stackName} from ${why}: none of its node(s) answered, so there is nothing ` +
          `to attach to yet. \`omnitron stack start ${projectName} ${stackName}\` deploys it, deliberately.`,
      );
    }
    const down = info.apps.filter((a) => a.status !== 'online');
    this.stackStates.set(`${projectName}/${stackName}`, {
      project: projectName,
      stack: stackName,
      status: down.length === 0 ? 'running' : 'degraded',
      config: stackConfig,
      startedAt: Date.now(),
      infraService: null,
    });
    this.logger.info(
      {
        project: projectName,
        stack: stackName,
        source,
        online: info.apps.length - down.length,
        total: info.apps.length,
        ...(down.length > 0 ? { down: down.map((a) => a.name) } : {}),
      },
      down.length === 0
        ? 'Attached to a remote stack running on its nodes — nothing deployed'
        : 'Attached to a remote stack with applications not online — its nodes supervise them; nothing deployed from a restart',
    );
    return info;
  }

  /**
   * Get the infrastructure manager (for daemon-level access).
   */
  getInfraManager(): StackInfrastructureManager {
    return this.infraManager;
  }

  /** Cached declarations plus persisted intent; this query never starts infrastructure. */
  getInfrastructureHealthContext(): InfrastructureHealthContext {
    const context: InfrastructureHealthContext = { stacks: [], requiredContainers: [], unresolvedStacks: [],
      observedServices: this.infraManager.listInstances().flatMap(({ infra }) => Object.values(infra.getState().services)) };
    const apps = this.orchestrator.list();
    for (const project of this.registry.listRegistrations()) {
      const config = this.getLoadedConfig(project.name);
      if (!config) continue; // Unknown ownership must remain visible to the indicator.
      const running = this.getRunningStacks(project.name);
      for (const [stack, declaration] of Object.entries(this.resolveStacks(config, project.name))) {
        if (declaration.type !== 'local') continue;
        const prefix = `${project.name}/${stack}/`;
        const active = project.enabledStacks?.includes(stack) || running.includes(stack) ||
          apps.some(app => app.name.startsWith(prefix) && ['online', 'starting', 'restarting'].includes(app.status));
        const intent = active ? 'running' : project.enabledStacks ? 'inactive' : 'unknown';
        const scope: InfrastructureHealthContext['stacks'][number] = { project: project.name, stack, intent };
        context.stacks.push(scope);
        if (intent !== 'running') continue;
        const infra = this.infraManager.getInstance(project.name, stack);
        if (infra) {
          scope.containers = infra.getDesiredServices().map(service => service.name);
          context.requiredContainers.push(...scope.containers);
        }
        else if (mergeInfrastructure(config, declaration)) context.unresolvedStacks.push(`${project.name}/${stack}`);
      }
    }
    return context;
  }

  // ===========================================================================
  // Enabled-stacks reconciler — desired-state convergence
  // ===========================================================================

  /**
   * Periodically converge running stacks onto the persisted desired state
   * (`project.enabledStacks`). Boot-time resume in daemon.startApps() is
   * one-shot — on 2026-07-11 it fired seconds after login while Docker
   * (OrbStack) was still coming up, failed with "Docker is not available",
   * and the platform stayed appless for days despite a healthy supervised
   * daemon. The reconciler retries with per-stack exponential backoff until
   * the stack is running, and picks up any later divergence (a stack that
   * crashed into 'error', infra that vanished) the same way.
   *
   * Manual intent is respected by construction: `stack stop` removes the
   * stack from enabledStacks (persisted), so a deliberately stopped stack is
   * never resurrected; 'starting'/'stopping' states are skipped as in-flight.
   */
  startEnabledStacksReconciler(intervalMs = 60_000): void {
    if (this.resumeTimer) return;
    this.resumeTimer = setInterval(() => {
      if (this.ownershipFrozen || this.resumingInstalled || this.reconcilingStacks) return;
      this.reconcilingStacks = true;
      void this.reconcileEnabledStacks().catch((err) => {
        this.logger.warn({ error: (err as Error).message }, 'Enabled-stacks reconciler tick failed');
      }).finally(() => { this.reconcilingStacks = false; });
    }, intervalMs);
    this.resumeTimer.unref();
    this.logger.info({ intervalMs }, 'Enabled-stacks reconciler started');
  }

  @RecoveryMutation()
  private async reconcileEnabledStacks(): Promise<void> {
    // Collect the divergence set first — cheap, no I/O.
    const pending: Array<{ project: string; stack: string }> = [];
    for (const project of this.registry.listRegistrations()) {
      for (const stackName of project.enabledStacks ?? []) {
        const state = this.stackStates.get(`${project.name}/${stackName}`);
        // Only retry a failed lifecycle attempt. App supervision owns later
        // changes to a running stack, including individual operator stops.
        const status = state?.status === 'error' && state.config.type === 'local' && state.startedAt != null
          ? this.toStackInfo(project.name, stackName, state.config).status : state?.status;
        // Converge only from fully-down states (absent/stopped/error).
        // 'degraded' means mostly-up — restarting the whole stack over it
        // would churn healthy apps; per-app recovery owns that case.
        if (status === 'running' || status === 'starting' || status === 'stopping' || status === 'degraded') {
          continue;
        }
        pending.push({ project: project.name, stack: stackName });
      }
    }
    if (pending.length === 0) return;

    // Infrastructure admission belongs to startStack, including ownership and
    // inferred requirements. A global Docker probe would strand remote and
    // externally provisioned stacks behind an unrelated local dependency.
    const now = Date.now();
    for (const { project, stack } of pending) {
      const key = `${project}/${stack}`;
      const backoff = this.resumeBackoff.get(key);
      if (backoff && now < backoff.nextAt) continue;

      this.logger.info({ project, stack, attemptDelayMs: backoff?.delayMs ?? 0 }, 'Reconciler: resuming enabled stack');
      try {
        // Config may not be loaded yet on a fresh daemon (boot resume died
        // before reaching this project) — load lazily, same as boot does.
        if (!this.getLoadedConfig(project)) {
          await this.loadProjectConfig(project);
        }
        const result = await this.startStack(project, stack, { source: 'auto-resume' });
        if (result.type === 'local' && result.status !== 'running') {
          if (result.status === 'degraded') {
            this.logger.warn({ project, stack, notUp: result.notUp }, 'Reconciler: partial start under application supervision');
            continue;
          }
          throw new Error(result.notUp?.join(', ') || `Stack state: ${result.status}`);
        }
        this.resumeBackoff.delete(key);
        this.logger.info({ project, stack }, 'Reconciler: stack resumed');
      } catch (err) {
        const prev = backoff?.delayMs ?? 0;
        const delayMs = Math.min(prev > 0 ? prev * 2 : 60_000, 15 * 60_000);
        this.resumeBackoff.set(key, { nextAt: Date.now() + delayMs, delayMs });
        this.logger.error(
          { project, stack, error: (err as Error).message, retryInMs: delayMs },
          'Reconciler: stack resume failed — will retry',
        );
      }
    }
  }

  /**
   * Dispose of all resources held by this service.
   * Called during daemon shutdown.
   */
  async dispose(): Promise<void> {
    if (this.resumeTimer) {
      clearInterval(this.resumeTimer);
      this.resumeTimer = null;
    }
    this.slaveConnector?.dispose();
    this.infraManager.dispose();
  }

  // ===========================================================================
  // Config Management
  // ===========================================================================

  @RecoveryMutation()
  async loadProjectConfig(projectName: string): Promise<IEcosystemConfig> {
    const project = this.registry.get(projectName);
    if (!project) throw new Error(`Project '${projectName}' not found`);

    const { loadEcosystemConfig } = await import('../config/loader.js');
    const config = await loadEcosystemConfig(project.path);

    this.configRegistry.set(projectName, { config, loadedAt: Date.now() });
    return config;
  }

  getLoadedConfig(projectName: string): IEcosystemConfig | null {
    return this.configRegistry.get(projectName)?.config ?? null;
  }

  /** In-flight loads, so callers arriving together load a project once. */
  private readonly configLoads = new Map<string, Promise<IEcosystemConfig>>();

  /**
   * The project's config, loaded now if the daemon has not got to it yet.
   *
   * A reader that arrived in the first seconds after a daemon start found no
   * config and was answered with an error: measured on the master restarted
   * at 12:07:48 UTC, 20 ERROR lines «Project 'sample' config not loaded» from
   * the console's `getStack` polls, logged as server failures and counted by
   * `doctor` — for a project that loads a moment later, which is what the
   * reconciler already does for itself (`loadProjectConfig` when absent).
   */
  async ensureConfig(projectName: string): Promise<IEcosystemConfig> {
    const loaded = this.getLoadedConfig(projectName);
    if (loaded) return loaded;
    let pending = this.configLoads.get(projectName);
    if (!pending) {
      pending = this.loadProjectConfig(projectName).finally(() => this.configLoads.delete(projectName));
      this.configLoads.set(projectName, pending);
    }
    return pending;
  }

  @RecoveryMutation()
  async reloadConfig(projectName?: string): Promise<void> {
    if (projectName) {
      await this.loadProjectConfig(projectName);
      this.emit('project:config_reloaded', projectName);
    } else {
      for (const project of this.registry.listRegistrations()) {
        await this.loadProjectConfig(project.name);
        this.emit('project:config_reloaded', project.name);
      }
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  getRunningStacks(projectName: string, includeIncomplete = false): string[] {
    const result: string[] = [];
    for (const [, state] of this.stackStates) {
      if (state.project !== projectName) continue;
      if (includeIncomplete && state.status !== 'stopped') { result.push(state.stack); continue; }
      const status = state.config.type === 'local' && state.startedAt != null
        ? this.toStackInfo(projectName, state.stack, state.config).status : state.status;
      if (status === 'running' || status === 'starting') result.push(state.stack);
    }
    return result;
  }

  /** Build the stack handle key for an app */
  static handleKey(project: string, stack: string, app: string): string {
    return `${project}/${stack}/${app}`;
  }

  // ===========================================================================
  // Infrastructure Generation & Validation
  // ===========================================================================

  /**
   * Generate optimal default infrastructure config by scanning app requirements.
   *
   * Reads each app's config/default.json `omnitron` section (same pattern as
   * requirements-scanner) and aggregates needs into a minimal InfrastructureConfig:
   * - Any app with `database` → shared PostgreSQL with per-app databases
   * - Any app with `redis` → shared Redis with auto-allocated DB indices
   * - Any app with `s3` → shared MinIO with per-app buckets
   */
  private async generateDefaultInfrastructure(
    projectConfig: IEcosystemConfig,
    projectPath: string,
    appNames: string[] | 'all',
  ): Promise<InfrastructureConfig> {
    // Resolve which apps to scan
    const apps = appNames === 'all'
      ? projectConfig.apps.filter((a) => a.enabled !== false)
      : projectConfig.apps.filter((a) => a.enabled !== false && appNames.includes(a.name));

    // Read omnitron config from each app's config/default.json
    const appConfigs = new Map<string, OmnitronAppConfig>();
    for (const app of apps) {
      if (!app.bootstrap) continue;

      const bootstrapPath = `${projectPath}/${app.bootstrap}`;
      const srcDir = path.dirname(bootstrapPath);
      const appRoot = path.resolve(srcDir, '..');
      const configPath = path.join(appRoot, 'config', 'default.json');

      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const json = JSON.parse(content);
        if (json.omnitron) {
          appConfigs.set(app.name, json.omnitron as OmnitronAppConfig);
        }
      } catch (err) {
        this.logger.debug({ app: app.name, configPath, error: (err as Error).message }, 'Could not read app config for infrastructure scan');
      }
    }

    if (appConfigs.size === 0) {
      return {};
    }

    // Aggregate needs
    const needsPostgres = [...appConfigs.values()].some((c) => !!c.database);
    const needsRedis = [...appConfigs.values()].some((c) => !!c.redis);
    const needsS3 = [...appConfigs.values()].some((c) => !!c.s3);

    const infrastructure: InfrastructureConfig = {};

    // PostgreSQL: shared instance with per-app databases
    if (needsPostgres) {
      const databases: Record<string, PostgresDatabaseConfig> = {};
      for (const [appName, config] of appConfigs) {
        if (config.database) {
          const dbConfig = typeof config.database === 'object' ? config.database : {};
          databases[appName] = {
            // A discovered dependency is not authority to execute a migration.
            ...(dbConfig.extensions?.length ? { extensions: dbConfig.extensions } : {}),
          };
        }
      }
      infrastructure.postgres = {
        port: 5432,
        databases,
      };
    }

    // Redis: shared instance with auto-allocated DB indices per app
    if (needsRedis) {
      const dbAllocations: Record<string, number> = {};
      let nextDb = 0;

      for (const [appName, config] of appConfigs) {
        if (config.redis) {
          dbAllocations[appName] = nextDb++;
        }
      }

      // Titan service modules get their own DB indices
      for (const [appName, config] of appConfigs) {
        if (config.services?.discovery) {
          dbAllocations[`${appName}:discovery`] = nextDb++;
        }
        if (config.services?.notifications) {
          dbAllocations[`${appName}:notifications`] = nextDb++;
        }
      }

      infrastructure.redis = {
        port: 6379,
        databases: dbAllocations,
      };
    }

    // MinIO: shared instance with per-app buckets
    if (needsS3) {
      const buckets: string[] = [];
      for (const [appName, config] of appConfigs) {
        if (config.s3) {
          const s3Config = typeof config.s3 === 'object' ? config.s3 : {};
          buckets.push(s3Config.bucket ?? appName);
        }
      }
      infrastructure.minio = {
        ports: { api: 9000, console: 9001 },
        buckets,
      };
    }

    return infrastructure;
  }

  /**
   * Validate that a stack's infrastructure config satisfies all app requirements.
   * Returns issues if infrastructure is missing for apps that need it.
   */
  /**
   * What each node of a stack would find and do on its host for the services
   * the stack declares — asked, not done (`host-inspection.ts`).
   *
   * Built from the parts a deployment sends — the applications'
   * declarations and the stack's overrides with their references resolved
   * from this vault — plus the services reached elsewhere, to say whether
   * they answer. The node that runs mainnet chains could otherwise be read
   * only by deploying to it: it takes SSH by password, and that stays in
   * the vault.
   */
  async inspectStackHost(
    data: { project: string; stack: string } & Omit<
      import('../infrastructure/host-inspection.js').HostInspectionRequest,
      'services' | 'overrides'
    >,
  ): Promise<Array<{ node: string; inspection?: import('../infrastructure/host-inspection.js').HostInspection; error?: string }>> {
    const config = await this.loadProjectConfig(data.project);
    const stackConfig = this.resolveStacks(config, data.project)[data.stack];
    if (!stackConfig) throw new Error(`No stack '${data.stack}' in ${data.project}`);
    const nodes = stackConfig.nodes ?? [];
    if (stackConfig.type === 'local' || nodes.length === 0) {
      throw new Error(`${data.project}/${data.stack} runs on no node of its own — its host is this machine`);
    }

    const services = await this.collectDeclaredServices(data.project, stackConfig, config, { external: true });
    const overrides = await this.resolveOverrideSecrets(data.project, stackConfig.serviceOverrides);
    const { project: _project, stack: _stack, ...asked } = data;
    const connector = this.getSlaveConnector();

    const readings: Array<{ node: string; inspection?: import('../infrastructure/host-inspection.js').HostInspection; error?: string }> = [];
    for (const node of nodes) {
      const host = node.host;
      const port = node.port ?? 9700;
      try {
        await connector.addSlave({ host, port, label: node.label });
        if (!(await connector.waitUntilConnected(host, port, 60_000))) {
          throw new Error('it did not join the mesh within a minute');
        }
        const inspection = (await connector.invokeOnSlave(
          host,
          port,
          'OmnitronInfra',
          'inspectHostServices',
          [{ services, overrides, ...asked }],
          { retryOnDisconnect: true },
        )) as import('../infrastructure/host-inspection.js').HostInspection;
        readings.push({ node: `${host}:${port}`, inspection });
      } catch (err) {
        readings.push({ node: `${host}:${port}`, error: (err as Error).message });
      }
    }
    return readings;
  }

  async validateStackInfrastructure(
    projectName: string,
    stackName: string,
  ): Promise<{ valid: boolean; issues: string[] }> {
    const report = await this.diagnoseStack(projectName, stackName);
    const issues = report.checks.filter(check => check.state === 'blocked' || check.state === 'unknown').map(check => `${check.resource}: ${check.message}`);
    return { valid: issues.length === 0, issues };
  }

  // ===========================================================================
  // Private — Stack Launchers
  // ===========================================================================

  private async startLocalStack(
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
    selectedEntries?: IEcosystemAppEntry[],
    enable?: (build: (entry: IEcosystemAppEntry) => IEcosystemAppEntry) => Promise<void>,
    verifyMigrations?: VerifyMigrationEntries,
    verifyArtifactInfrastructure?: () => Promise<InfrastructureConfig | undefined>,
  ): Promise<void> {
    const ownsInfrastructure = ownsStackInfrastructure(stackConfig);
    const stateKey = `${projectName}/${stackName}`;
    const state = this.stackStates.get(stateKey)!;

    // 1. Load bootstrap definitions (needed for both infra provisioning and config resolution)
    const appEntries = selectedEntries ?? this.resolveStackApps(stackConfig, ecosystemConfig);
    // What the stack gives its apps, vault references resolved — now, before
    // anything is provisioned: a key the vault does not hold refuses the
    // start here (project/stack-env.ts).
    const stackEnv = await this.stackEnvFor(projectName, stackName, stackConfig, appEntries.map((e) => e.name));
    const project = this.registry.get(projectName);
    const appDefinitions = await this.loadAppDefinitions(projectName, stackConfig, ecosystemConfig, appEntries);

    // 2. Provision per-stack infrastructure (built-in + app-declared services)
    //    Auto-detect core services (postgres, redis, minio) from app requirements,
    //    then merge with explicit infrastructure config (gateway, custom services).
    // Merge stack-level + ecosystem-level infrastructure (stack overrides ecosystem, but both contribute)
    for (const entry of appEntries) {
      if (entry.bootstrap && !appDefinitions.has(entry.name)) throw new Error(`Bootstrap declarations unavailable for ${entry.name}`);
    }
    const effectiveInfra = ownsInfrastructure ? mergeInferredInfrastructure(
      buildInfraFromRequirements(requirementsFromDefinitions(appDefinitions)),
      verifyArtifactInfrastructure ? await verifyArtifactInfrastructure() : mergeInfrastructure(ecosystemConfig, stackConfig),
    ) : undefined;
    // Refuse missing/tampered migrators before creating or changing infrastructure.
    if (effectiveInfra && project) {
      const migrations = await localMigrationTargets(requestedMigrations(normalizeInfraConfig(effectiveInfra, createDefaultRegistry())),
        appEntries, project.path, verifyMigrations);
      const resolveMigration = this.stackEntryBuilder(projectName, stackName, stackConfig, ecosystemConfig, appDefinitions, stackEnv);
      validateMigrationDestinations(migrations.map(target => {
        const entry = appEntries.find(app => app.name === target.app)!;
        return { app: target.app, database: migrationDatabaseEnvironment(target.environmentApp,
          resolveMigration(entry).env?.['DATABASE_URL'] ?? '', target.database, target.mode) };
      }));
    }
    if (effectiveInfra) {
      try {
        const infraService = await this.infraManager.provisionStack(
          projectName,
          stackName,
          stackConfig,
          effectiveInfra as InfrastructureConfig,
          appDefinitions,
          project?.path,
        );
        state.infraService = infraService;
        const outcome = summariseProvisioning(infraService.getDesiredServices(), infraService.getState().services);
        if (!outcome.ready && !outcome.empty) {
          throw new Error(describeProvisioning(outcome));
        }
      } catch (err) {
        const reason = (err as Error).message;
        this.logger.error(
          { project: projectName, stack: stackName, error: reason },
          'Failed to provision stack infrastructure'
        );

        // Fail-fast by default: apps almost always depend on the
        // stack-provisioned infrastructure (postgres, redis, …) and starting
        // them on top of broken infra produces cascading misleading errors
        // ("Redis client connection timed out", "Container not found", …).
        // Bail out with a clear, structured error so the operator sees the
        // real cause first.
        //
        // Explicit controller/external ownership never enters this provisioning
        // branch. Declarations alone do not imply permission to manage an
        // application's existing services. For deliberate degraded-mode
        // operation of stack-owned infrastructure, settings can opt in via
        // `settings.allowDegradedInfra: true` (the field is namespaced under
        // settings to remain forward-compatible with stack schema).
        const allowDegraded =
          (stackConfig.settings as Record<string, unknown> | undefined)?.['allowDegradedInfra'] === true;
        if (!allowDegraded) {
          const cleanMsg =
            `Stack '${projectName}/${stackName}' infrastructure provisioning failed:\n` +
            `  ${reason}\n\n` +
            `Apps were not started. Fix the underlying infrastructure issue (Docker socket, ` +
            `image pull, port conflict, …) and rerun 'omnitron stack start ${projectName} ${stackName}'.\n` +
            `\nIf you intentionally run apps against external infrastructure, set ` +
            `'settings.allowDegradedInfra: true' in your stack config.`;
          const throwable = new Error(cleanMsg);
          (throwable as any).code = 'INFRA_PROVISIONING_FAILED';
          (throwable as any).cause = err;
          throw throwable;
        }

        state.infrastructureStartFailed = true;
        this.logger.warn(
          { project: projectName, stack: stackName },
          'allowDegradedInfra=true — proceeding with app start despite infra failure'
        );
      }
    }

    // Resolve once for both migrations and application startup. Inferred service
    // requirements are not permission to connect to a database or run migrations.
    const appConfigBuilder = this.stackEntryBuilder(projectName, stackName, stackConfig, ecosystemConfig, appDefinitions, stackEnv);
    if (effectiveInfra && project) {
      await this.runStackMigrations(projectName, stackName, this.infraManager.getNormalizedServices(projectName, stackName) ?? {}, appEntries, project.path, appConfigBuilder, verifyMigrations);
    }
    await enable?.(appConfigBuilder);

    // 4. Start apps in dependency-aware parallel batches.
    //
    // Pre-fix this was a serial `for ... await` loop in declaration
    // order. For the downstream stack that meant geo + pricing (zero
    // deps) waited 30+ seconds for unrelated apps to finish booting
    // before they themselves were even spawned — every app paid
    // the cumulative cold-start cost. The dependency-aware batched
    // start that `OrchestratorService.startAll` uses was bypassed
    // entirely because stack-mode goes through this code path
    // instead of startAll.
    //
    // resolveStartupOrder returns waves: every app in wave N has
    // all its `dependsOn` already in wave 0..N-1. We start each
    // wave with Promise.all so apps without deps run truly in
    // parallel, and a wave can't start until every member of the
    // previous wave is online. Same skip-on-failed-dep semantics
    // as startAll.
    const problems = new Map<string, string>();

    for (const wave of resolveStartupOrder(appEntries)) {
      await Promise.all(
        wave.map(async (entry) => {
          const blockingDep = (entry.dependsOn ?? []).find((d) => problems.has(d));
          if (blockingDep) {
            problems.set(entry.name, `dependency ${blockingDep} did not start`);
            this.logger.warn(
              { app: entry.name, project: projectName, stack: stackName, blockedBy: blockingDep },
              'Skipping app — dependency failed or was blocked',
            );
            return;
          }
          const namespacedEntry = appConfigBuilder(entry);
          const envMap = namespacedEntry.env as Record<string, string | undefined> | undefined;
          this.logger.info(
            {
              app: entry.name,
              wave: 'parallel',
              envKeys: envMap ? Object.keys(envMap) : [],
              hasS3: !!envMap?.['S3_ENDPOINT'],
              hasDb: !!envMap?.['DATABASE_URL'],
            },
            'Infrastructure env vars for app',
          );
          try {
            await this.orchestrator.startApp(namespacedEntry, ecosystemConfig);
          } catch (err) {
            // The raw exception can contain credentials, app output or host paths.
            // Keep bounded process evidence in stack views available to readers.
            problems.set(entry.name, publicLaunchFailure(err));
            this.logger.error(
              { app: entry.name, project: projectName, stack: stackName, error: (err as Error).message },
              'Failed to start app in stack',
            );
          }
        }),
      );
    }
    if (problems.size) state.appStartErrors = Object.fromEntries(problems);
  }

  /**
   * Deploy a stack to its nodes, and say what it is doing while it does it.
   *
   * Measured on 2026-09-22: 829 seconds between this method's first log line
   * and its next one, with the work in flight the whole time. The CLI stops
   * waiting at 600 and says the operation is «probably still running» — true,
   * and silent about which of its seven steps was running. See
   * `deploy-phases.ts`.
   */
  private async startRemoteStack(
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
    release: AdmittedRelease | null = null,
    reinstall = false,
  ): Promise<NodeReach> {
    const phases = reportPhases(this.logger, { project: projectName, stack: stackName });
    try {
      return await withDeploymentProgress(
        { project: projectName, stack: stackName, operationId: randomUUID(), ...(release && { releaseId: release.id }) },
        () => this.deployRemoteStack(projectName, stackName, stackConfig, ecosystemConfig, phases, release, reinstall),
      );
    } finally {
      // Every exit, including the refusals: a reporter that outlives its
      // deployment narrates a step nobody is taking.
      phases.done();
    }
  }

  private async deployRemoteStack(
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
    phases: DeployPhases,
    release: AdmittedRelease | null = null,
    reinstall = false,
  ): Promise<NodeReach> {
    const nodes = stackConfig.nodes ?? [];
    if (nodes.length === 0) {
      throw new Error(`Remote stack '${stackName}' has no nodes configured`);
    }

    this.logger.info(
      { project: projectName, stack: stackName, nodes: nodes.length },
      'Starting remote stack — deploying to slave daemons'
    );

    const connector = this.getSlaveConnector();

    // Which nodes this deployment actually reached.
    //
    // A node that fails to provision is skipped and the loop moves on —
    // right when there are others, and a lie when there are not. Measured
    // 2026-09-22: the only node's SSH stopped completing handshakes, both
    // attempts logged «Failed to provision slave — skipping», and the
    // deployment went on to mark the stack running and write a `stack.start`
    // row saying `apps: 6`. The CLI was honest — «only 0/6 apps came
    // online» — and the audit trail, which is what anyone reads a week
    // later, recorded a deployment that never touched the machine.
    const reached: string[] = [];
    const skipped: string[] = [];
    /** Nodes that took the deployment with infrastructure not up, in the node's words. */
    const notReady: string[] = [];

    // What the applications in this stack declare they need.
    //
    // Collected here and sent to the node, because the node does not have
    // the application definitions when it is asked to provision — and
    // reading them again on that side would be a second implementation of
    // variant selection and override merging, on the side with less
    // information.
    phases.enter('reading what the applications declare');
    if (release && !release.remoteDefinitions) throw Error('Checked remote release has no admitted infrastructure definitions');
    const declaredServices = await this.collectDeclaredServices(projectName, stackConfig, ecosystemConfig, { definitions: release?.remoteDefinitions });

    // Build artifacts for apps in this stack
    const appEntries = this.resolveStackApps(stackConfig, ecosystemConfig);
    const migrationRequests = requestedMigrations({ ...declaredServices,
      ...normalizeInfraConfig(mergeInfrastructure(ecosystemConfig, stackConfig) ?? {}, createDefaultRegistry()) });
    validateMigrationOwners(migrationRequests, appEntries);
    const placements = orderMigrationPlacements(migrationRequests, resolveNodePlacements(stackConfig, appEntries));
    // What the stack gives its apps, vault references resolved — before any
    // node is touched: a key the vault does not hold refuses the deployment
    // here, not after a node was provisioned (project/stack-env.ts). A remote
    // stack's `settings.env` reached no app before this; a local one's did.
    const stackEnv = await this.stackEnvFor(projectName, stackName, stackConfig, appEntries.map((e) => e.name));
    const project = this.registry.get(projectName);
    let artifacts: import('../project/artifact-builder.js').ArtifactInfo[] = [];

    // Why a variable and not a `throw` inside the `try` below: the `catch`
    // is right there, and it swallowed exactly this. Caught by the test for
    // this change on its first run — the refusal fired, the catch logged
    // "deploying without rebuild", and the deployment carried on to the node
    // as if nothing had happened.
    let refusal: string | null = null;

    if (release) {
      // Built in clean clones, gated, and checked against the manifest by
      // `loadRelease` — nothing is compiled here, from this machine's disk.
      const files = new Map(release.files.map((f) => [f.app, f]));
      const sources = new Map(releaseArtifactOrigins(release.manifest, release.manifestSha256).map(source => [source.app, source]));
      artifacts = appEntries.flatMap((entry) => {
        const file = files.get(entry.name);
        return file
          ? [{
              app: file.app,
              version: file.version,
              path: file.path,
              size: file.bytes,
              builtAt: release.manifest.builtAt,
              checksum: file.inputs,
              tarballSha256: file.sha256,
              release: sources.get(file.app)!.origin,
              ...(sources.get(file.app)!.artifact.launch && { launch: sources.get(file.app)!.artifact.launch! }),
            }]
          : [];
      });
      const missing = appEntries.filter((e) => !files.has(e.name)).map((e) => e.name);
      if (missing.length > 0) {
        refusal = `Refusing to deploy ${stackName}: release ${release.id} carries no artifact for ${missing.join(', ')}.`;
      } else {
        this.logger.info(
          { release: release.id, artifacts: artifacts.map((a) => `${a.app}@${a.version}`), stack: stackName },
          'Deploying a release — artifacts from its clean build, nothing compiled here',
        );
      }
    } else if (project) {
      try {
        const { ArtifactBuilder } = await import('../project/artifact-builder.js');
        const builder = new ArtifactBuilder(project.path, undefined, {
          info: (msg) => this.logger.info({ project: project.name }, msg),
        });
        phases.enter('building artifacts');
        const outcome = await builder.buildAll(appEntries);
        artifacts = outcome.built;
        if (outcome.failed.length > 0) {
          // Said at error level and per app: a stack whose artifacts did not
          // build deploys nothing, and the reason is in the builder's hands
          // and nowhere else.
          for (const f of outcome.failed) {
            this.logger.error({ app: f.app, stack: stackName, error: f.error }, 'Artifact build failed');
          }
          // ...and then the deployment STOPS, which it did not.
          //
          // Measured on 2026-09-21: `main` failed to compile at 15:17:27,
          // the five that did compile were deployed, and at 15:19:02 this
          // method's caller logged `Stack started`. `omnitron stack status`
          // then reported `6/6 online` — true and useless, because the node
          // daemon is restarted unconditionally on every deploy and
          // auto-starts whatever its config still lists. `main` kept serving
          // the artifact from the PREVIOUS cycle while the operator was
          // shown a green stack. Earlier the same day three of six failed
          // and the deployment went out with three.
          //
          // A partial deployment is worse than none: the apps that landed
          // are newer than the ones that did not, and nothing on the node or
          // in this log says which is which. The one place that can refuse
          // is here, before a single byte leaves the machine.
          refusal =
            `Refusing to deploy ${stackName}: ${outcome.failed.length} of ${appEntries.length} artifact(s) failed to build — ` +
            outcome.failed.map((f) => f.app).join(', ') +
            '. Nothing was deployed; the per-app errors are above.';
        } else {
          this.logger.info(
            { artifacts: artifacts.map((a) => `${a.app}@${a.version}`), stack: stackName },
            'Artifacts built for deployment'
          );
        }
      } catch (err) {
        // The build system itself did not run — a missing module, a spawn
        // that threw, a timeout. `deploying without rebuild` described what
        // came next and did not object to it: the node was handed whatever
        // it had from the last cycle and told it was current.
        this.logger.error(
          { error: (err as Error).message, stack: stackName },
          'The artifact build did not run — nothing will be deployed'
        );
        refusal = `Refusing to deploy ${stackName}: the artifact build did not run — ${(err as Error).message}`;
      }
    } else {
      // `if (project)` with nothing on the other side meant a name the
      // registry does not know produced NO log line at all: no build, no
      // error, an empty artifact list, and step 3 below skipped by
      // `if (artifacts.length > 0)`. The deployment then opened the mesh,
      // told the node to start what it already had, and reported success —
      // a stack "deployed" without a single byte leaving this machine.
      this.logger.error(
        { project: projectName, stack: stackName, known: this.registry.list().map((p) => p.name) },
        'This project is not in the registry, so nothing was built and nothing will be deployed',
      );
      refusal =
        `Refusing to deploy ${stackName}: project '${projectName}' is not in the registry, so nothing was built. ` +
        `Known projects: ${this.registry.list().map((p) => p.name).join(', ') || '(none)'}.`;
    }

    // Before the mesh is opened and before the node is touched at all.
    if (refusal) throw new Error(refusal);

    // Resolve master address (from the SLAVE's perspective — what it dials)
    const { DEFAULT_DAEMON_CONFIG: _dc } = await import('../config/defaults.js');
    const { resolveMasterHost } = await import('./master-address.js');
    const masterPort = _dc.port;

    // One writer per node. Every development machine is a master deploying
    // to these same nodes, and nothing made them see each other: two
    // `stack start`s interleaved on one node. Each node's lease is taken
    // before anything on it changes, confirmed before every step that changes
    // it, and given back when this deployment is done — `node-deploy-lease.ts`.
    const targets = new Map<string, DeployTarget>();
    for (const node of nodes) {
      targets.set(`${node.host}:${node.port ?? 9700}`, await this.targetForStackNode(node));
    }
    phases.enter(`leasing ${nodes.length} node(s)`);
    const waited = new Set<string>();
    return withNodeLeases(
      [...targets].map(([node, target]) => ({
        node,
        machine: `${target.host}:${target.sshPort ?? 22}`,
        run: this.deployer.leaseRunner(target),
      })),
      `${projectName}/${stackName}`,
      this.logger,
      async (leases) => {
        if (release && leases.unreachable.size) {
          const missing = [...leases.unreachable].map(([node, reason]) => `${node}: ${reason}`).join(', ');
          throw Error('Release deployment requires every selected node to be reachable before activation: ' + missing);
        }
        if (waited.size && release) {
          const current = await this.admitRelease(projectName, stackName, stackConfig, ecosystemConfig, release.id);
          if (current.manifestSha256 !== release.manifestSha256) throw Error('Release changed while waiting for the target');
        }
        for (const node of waited) this.deployer.emitProgress(node, '*', 'pending', 0, 'Node lease acquired');
        // Each node's platform is held at its gateway from before the first
        // step that can stop an app until the apps answer through it again
        // (`maintenance-lock.ts`). A node whose deployment throws or is
        // skipped keeps its lock only until this callback ends.
        const locks = new Map<string, MaintenanceLock>();
        try {
        // Deploy to each node: provision slave → deploy artifacts → connect
        for (const { node, apps: nodeApps } of placements) {
          const selectedNames = new Set(nodeApps.map(app => app.name));
          const nodeArtifacts = artifacts.filter(artifact => selectedNames.has(artifact.app));
          const nodeKey = `${node.host}:${node.port ?? 9700}`;
          if (!leases.has(nodeKey)) {
            skipped.push(nodeKey);
            this.logger.error(
              { node: nodeKey, because: leases.unreachable.get(nodeKey) },
              'Could not reach this node to lease it — skipping',
            );
            continue;
          }

          // 1. Provision slave: install runtime + omnitron + generate slave config + start daemon
          const target = targets.get(nodeKey)!;
          const master = await resolveMasterHost(
            { advertiseHost: _dc.advertiseHost, bindHost: _dc.host },
            target,
          );
          if (master.host) {
            this.logger.info(
              { node: nodeKey, masterHost: master.host, from: master.source },
              'Resolved the master address this slave will dial',
            );
          } else {
            // Not an obstacle: the mesh connects the other way. Said once, at
            // warn level, because a deployment that hands out no master address
            // is worth noticing if somebody expected the push path to exist.
            this.logger.warn(
              { node: nodeKey, because: master.reason },
              'Provisioning this node without a master address — it will be pulled from, not dial in',
            );
          }
          await leases.confirm(nodeKey, `provisioning ${node.host}`);
          const lock = await this.holdForDeployment(target, projectName, stackName, stackConfig, ecosystemConfig, release, phases);
          if (lock) locks.set(nodeKey, lock);
          phases.enter(`provisioning ${node.host}`);
          const provisioned = await this.deployer.provisionSlaveNode(
            target,
            master.host,
            masterPort,
            projectName,
          );

          if (!provisioned) {
            skipped.push(nodeKey);
            this.logger.error({ node: nodeKey }, 'Failed to provision slave — skipping');
            continue;
          }
          reached.push(nodeKey);

          // 2. Bring up the stack's infrastructure, ON the node, before the
          //    applications that need it arrive.
          //
          //    This step did not exist. A remote stack provisioned the daemon,
          //    shipped the artifacts and opened the mesh connection, and the
          //    stack's `infrastructure` block — its Postgres, its Redis, its
          //    MinIO — was read by the master and never left it. The
          //    applications started on the node and had nothing to connect to,
          //    which surfaces as every one of them failing its first query
          //    rather than as a missing deployment step.
          //
          //    Ordered before the artifacts deliberately: an app that starts
          //    against a database that is not there yet spends its startup
          //    budget retrying, and a supervisor's deadline turns that into a
          //    crash loop over a condition that would have resolved.
          // The same infrastructure a local stack would get: the ecosystem's
          // services — gateway, Tor, tiles — plus whatever this stack declares.
          // Sending only the stack's own block is why a remote deployment had
          // databases and no gateway, and no onion address to reach it by.
          const nodeInfra = mergeInfrastructure(ecosystemConfig, stackConfig);
          if (nodeInfra || Object.keys(declaredServices).length > 0) {
            await leases.confirm(nodeKey, `bringing up infrastructure on ${node.host}`);
            phases.enter(`bringing up infrastructure on ${node.host}`);
            const infrastructure = await this.provisionNodeInfrastructure(
              connector,
              node,
              (nodeInfra ?? {}) as import('../infrastructure/types.js').InfrastructureConfig,
              declaredServices,
              // Resolved, as `resolveNodeAppEnv` resolves them: the node renders
              // a host service's config from these, and a reference it cannot
              // resolve — it has no copy of this vault — left the bare-metal
              // templates with nothing but the declaration's own credentials.
              {
                project: projectName,
                stack: stackName,
                overrides: await this.resolveOverrideSecrets(projectName, stackConfig.serviceOverrides),
              },
              project?.path,
              release?.staticsDir ?? undefined,
            );
            if (!infrastructure.ready) {
              if (release) {
                throw new Error(`Release ${release.id} stopped before application installation on ${nodeKey}: ${infrastructure.detail}`);
              }
              // Not fatal: a node whose infrastructure is incomplete can still
              // be looked at, and stopping here would leave the fleet in a state
              // no command describes. It is said at error level with the node —
              // and carried to the start's answer and its audit row, where it
              // used to stop: bitcoind failed to start on the test node and the
              // deployment reported «6/6 apps online», exit 0, `outcome: ok`.
              this.logger.error(
                { node: nodeKey, stack: stackName, detail: infrastructure.detail },
                'Node infrastructure is not ready — deploying anyway, applications may not reach their databases',
              );
              notReady.push(`${nodeKey}: ${infrastructure.detail}`);
            }
          }

          // 2b. Ask the node what it actually provisioned.
          //
          // The credentials are generated ON THE NODE — `provisionStack` runs
          // `withGeneratedCredentials` against the node's own vault — so the
          // master's copy of the stack's infrastructure carries whatever was
          // DECLARED, which for a stack that declares none is nothing at all.
          // Writing that into the node's config left `resolveStackAddresses`
          // with no `infrastructure` block, and its fallback chain ends in a
          // literal:
          //
          //     infra?.postgres?.password ?? getEnv().POSTGRES_PASSWORD ?? 'postgres'
          //
          // Six apps were handed `postgres://postgres:postgres@localhost:5432/…`
          // against a container holding a 43-character generated secret, and
          // every one of them died with `password authentication failed for user
          // "postgres" (28P01)` after five retries.
          //
          // Only the secrets are taken from the node: ports, database names and
          // the rest stay as this stack declared them, because those are the
          // master's to decide and the node merely carried them out.
          phases.enter(`reading credentials from ${node.host}`);
          const nodeCredentials = await this.readNodeCredentials(
            connector,
            node,
            CREDENTIALED_SERVICES.filter((service) => Boolean((nodeInfra as Record<string, unknown> | undefined)?.[service])),
          );
          const deployedInfra = overlayCredentials(
            nodeInfra as Record<string, unknown> | undefined,
            nodeCredentials,
          );

          // Resolved as a LOCAL stack, because from the node's side these
          // services are: containers on that machine, ports on its loopback. The
          // remote branch of `resolveStackAddresses` answers with the node's
          // public host, which is the master's way of reaching it and not the
          // app's — and omnitron publishes every managed port on 127.0.0.1, so
          // that address reaches nothing from inside the node.
          //
          // Per app, and NOT as an `infrastructure` block in the node's config.
          // Writing one was the first attempt and it was worse than the problem:
          // a stack with an infrastructure block is a stack the node PROVISIONS,
          // so the node autostarted its own `deployed` stack, built a second
          // complete set of containers under `sample-deployed-*` on empty volumes,
          // and swept the master's `sample-test-*` as orphans. An address is not an
          // instruction to build what it points at.
          phases.enter(`resolving the environment for ${node.host}`);
          const appEnv = await this.resolveNodeAppEnv(
            ecosystemConfig,
            projectName,
            stackConfig,
            nodeApps,
            deployedInfra as import('../infrastructure/types.js').InfrastructureConfig | undefined,
            release?.remoteDefinitions,
          );
          // The stack's own, over the computed — as on a local stack, where
          // `settings.env` wins over both.
          for (const [app, env] of Object.entries(stackEnv).filter(([name]) => selectedNames.has(name))) appEnv[app] = { ...(appEnv[app] ?? {}), ...env };

          // 3. Deploy app artifacts via SSH
          if (nodeArtifacts.length > 0) {
            // The definitions travel with the artifacts. A node that receives
            // one without the other has files it cannot run, and says so only if
            // someone asks it directly.
            await leases.confirm(nodeKey, `delivering ${nodeArtifacts.length} artifact(s) to ${node.host}`);
            phases.enter(`delivering ${nodeArtifacts.length} artifact(s) to ${node.host}`);
            const sink = ecosystemConfig.monitoring?.alertSink;
            const results = await this.deployer.deployToStack([target], nodeArtifacts, projectName, {
              apps: nodeApps,
              appEnv,
              migrations: migrationRequests.filter(request => selectedNames.has(request.app)),
              stack: stackName,
              // Past the node's record of what each app runs: ship and restart all.
              ...(reinstall ? { force: true } : {}),
              // The node counts its own alarms and hands them to this project's
              // sink on the stack it runs; named as the master names the stack.
              ...(sink && { alertSink: { ...sink, host: `${projectName}/${stackName}` } }),
            });
            const failed = results.filter((r) => r.status === 'failed');
            if (failed.length > 0) {
              // The other half of the same invariant. Building every artifact
              // and then failing to DELIVER some of them leaves exactly the
              // split state the throw above exists to prevent, and it was a
              // WARN — a level nothing acts on, under a `Stack started` that
              // follows regardless.
              this.logger.error({ node: nodeKey, failed: failed.map((f) => f.app) }, 'App deployments failed');
              throw new Error(
                `Deployment to ${nodeKey} failed for ${failed.length} of ${results.length} app(s): ` +
                  failed.map((f) => f.app).join(', ') +
                  '. The node is in a mixed state — re-run the deployment once the cause is fixed.',
              );
            }
          }

          // 3b. Let the platform go — once it answers through the gateway, as
          //     a person's request will. One that does not keeps the lock,
          //     which then expires by itself; said, and carried to the answer.
          const held = locks.get(nodeKey);
          if (held) {
            locks.delete(nodeKey);
            phases.enter(`lifting maintenance on ${node.host}`);
            const lifted = await held.liftWhenAnswering(MAINTENANCE_PROBE_PATHS);
            if (!lifted.lifted) {
              notReady.push(
                `${nodeKey}: the platform did not answer through the gateway (${lifted.failed.join(', ')}) — ` +
                  'it stays in maintenance until the lock expires, or `omnitron stack maintenance … off`',
              );
            }
          }

          // 4. Connect master to slave daemon via Netron TCP
          await leases.confirm(nodeKey, `joining ${node.host} to the mesh`);
          phases.enter(`joining ${node.host} to the mesh`);
          await connector.addSlave({
            host: node.host,
            port: node.port ?? 9700,
            label: node.label,
            stack: stackName,
            project: projectName,
          });
        }

        // Not one node took the deployment. Nothing was installed, nothing was
        // started, and the applications on those machines — if any are still up
        // — are running whatever they were running before. Marking the stack
        // `running` and recording a `stack.start` after that is how a trail
        // acquires a deployment that did not happen.
        if (reached.length === 0 && nodes.length > 0) {
          throw new Error(
            `Refusing to call ${stackName} started: none of its ${nodes.length} node(s) could be provisioned — ` +
              `${skipped.join(', ')}. The per-node errors are above.`,
          );
        }

        return { nodes: nodes.length, reached: reached.length, skipped, notReady };
        } finally {
          // A node whose deployment threw or was skipped: its platform is not
          // held past this deployment — the state it is in is the one to see.
          for (const [nodeKey, lock] of locks) {
            await lock.lift('failed').catch((err: unknown) =>
              this.logger.error({ node: nodeKey, err: (err as Error).message }, 'Could not lift maintenance — it expires by itself'),
            );
          }
        }
      },
      undefined, {
        seconds: stackConfig.settings?.deploymentLeaseWaitSeconds ?? (release ? 300 : 0),
        onWait: (node, holder, remaining) => {
          waited.add(node);
          this.deployer.emitProgress(node, '*', 'waiting', 0, `Waiting for ${holder} on this node · ${remaining}s remaining`);
        },
      },
    ).catch((error: unknown) => {
      for (const node of waited) this.deployer.emitProgress(node, '*', 'failed', 0, describeFailure(error));
      throw error;
    });
  }

  /**
   * Warn the platform on this node, then hold it at its gateway for the
   * deployment (`maintenance-lock.ts`). `null` when the stack opted out, or
   * when the node has no running gateway and Redis to hold with — a first
   * deployment, which nobody is using yet.
   */
  private async holdForDeployment(
    target: DeployTarget,
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
    release: LoadedRelease | null,
    phases: DeployPhases,
  ): Promise<MaintenanceLock | null> {
    const settings = stackConfig.settings?.maintenance;
    if (settings?.disabled) {
      this.logger.warn({ stack: stackName }, 'Maintenance lock disabled for this stack — deploying under its users');
      return null;
    }
    const timing = {
      ...DEFAULT_MAINTENANCE_TIMING,
      ...(settings?.noticeSeconds !== undefined ? { noticeSeconds: settings.noticeSeconds } : {}),
      ...(settings?.etaSeconds !== undefined ? { etaSeconds: settings.etaSeconds } : {}),
    };
    // The database by the one rule the gateway on the node used for its own
    // REDIS_DB — from the same merged infrastructure the node was sent.
    const infra = mergeInfrastructure(ecosystemConfig, stackConfig) as
      | { redis?: { databases?: Record<string, number> } }
      | undefined;
    if (timing.noticeSeconds > 0) phases.enter(`warning the platform: maintenance in ${timing.noticeSeconds} s`);
    return MaintenanceLock.open(
      {
        run: this.deployer.leaseRunner(target),
        prefix: stackConfig.settings?.containerPrefix ?? `${projectName}-${stackName}`,
        db: gatewayRedisDb(infra?.redis?.databases),
        release: release?.id ?? 'unreleased',
      },
      this.logger,
      timing,
    );
  }

  /**
   * Ask a node to bring up the infrastructure a stack declares.
   *
   * Over the mesh connection rather than over SSH: the node already runs a
   * reconciler that knows how to wait on a container's health, how to detect
   * a drifted spec, and how to clean up a phantom endpoint. Driving `docker`
   * over SSH from here would be a second implementation of all of it, on the
   * side of the wire with the least information.
   *
   * The connection is opened for this and kept — it is the same one the mesh
   * uses afterwards, so the node is joined by the time its applications
   * start rather than at the next heartbeat.
   */
/**
   * Deliver each service's static content to the node, and report where.
   *
   * Only services that declare a `staticDir`, which today is the gateway
   * serving the portal. A stack that declares none sends nothing and this
   * costs nothing.
   *
   * A failure is reported and not thrown: a node whose databases came up and
   * whose frontend did not is a node worth looking at, and stopping the whole
   * provisioning over a frontend leaves less working, not more.
   */
  /**
   * What each deployed app should connect to, once it is on the node.
   *
   * The same `resolveStack` + `resolvedConfigToEnv` pair a local stack uses,
   * fed the infrastructure the node actually provisioned — so there is one
   * implementation of "what is DATABASE_URL" rather than a second one written
   * for nodes, which would drift from the first the first time either
   * changed.
   *
   * `type: 'local'` is not a pretence: the apps run as host processes on the
   * node, beside containers whose ports are published on that node's
   * loopback. Local is what they are from where they stand.
   */
  private async resolveNodeAppEnv(
    ecosystemConfig: IEcosystemConfig,
    projectName: string,
    stackConfig: IStackConfig,
    appEntries: readonly IEcosystemAppEntry[],
    infrastructure: import('../infrastructure/types.js').InfrastructureConfig | undefined,
    admitted?: Map<string, IAppDefinition>,
  ): Promise<Record<string, Record<string, string>>> {
    if (!infrastructure) return {};
    try {
      // The app DEFINITIONS, not an empty map. `resolveStack` reads each
      // app's `omnitron.infrastructure` to learn which database it wants,
      // which redis index, which bucket — and without them it produces an
      // app config with no `database` at all, so `resolvedConfigToEnv` emits
      // `APP_NAME`, `STACK_NAME` and `JWT_SECRET` and no `DATABASE_URL`.
      //
      // Measured: the node's config carried five environment variables per
      // app and not the one the apps were failing for. An empty map is not a
      // map of nothing declared; it is a map nobody filled.
      const definitions = admitted ?? await this.loadAppDefinitions(projectName, stackConfig, ecosystemConfig);

      // The stack's answers about services it does not provision.
      //
      // `serviceOverrides` is where a stack says that bitcoin and monero are
      // not containers here — they are daemons already running on the node,
      // on mainnet, at an address only this stack knows. It was left out of
      // the config this resolver was given, so a deployed app was configured
      // with the defaults its own declaration carries. Measured on the test
      // node, whose chains run at 192.168.100.2 with mainnet credentials:
      //
      //     BITCOIN_RPC_URL  http://localhost:18443   (regtest)
      //     MONERO_DAEMON_URL  http://localhost:38081 (stagenet)
      //     MONERO_RPC_PASS  omni_stagenet_dev_password
      //
      // — three facts about a laptop, written into the configuration of a
      // server, in the one subsystem where being wrong costs money.
      const serviceOverrides = await this.resolveOverrideSecrets(
        projectName,
        stackConfig.serviceOverrides,
      );

      const resolved = resolveStack(
        { ...ecosystemConfig, infrastructure },
        projectName,
        NODE_STACK,
        {
          type: 'local',
          apps: appEntries.map((a) => a.name),
          ...(serviceOverrides ? { serviceOverrides } : {}),
        },
        definitions,
        undefined,
      );

      const out: Record<string, Record<string, string>> = {};
      for (const entry of appEntries) {
        const appConfig = resolved.appConfigs.get(entry.name);
        if (!appConfig) continue;
        out[entry.name] = resolvedConfigToEnv(appConfig, entry.name, NODE_STACK);
      }
      return out;
    } catch (err) {
      // Not fatal, and loud: the apps would start with whatever their own
      // definitions carry, which is how they came to be started with
      // `postgres:postgres` in the first place.
      this.logger.error(
        { project: projectName, error: (err as Error).message },
        'Could not resolve application service bindings; deployment refused before application delivery',
      );
      throw new Error('Could not resolve application service bindings', { cause: err });
    }
  }

  /**
   * A stack's service overrides with their secret references resolved.
   *
   * An override names its credentials rather than carrying them:
   *
   *     "secrets": { "rpc_password": { "secret": "monero.mainnet.rpc_password" } }
   *
   * `resolveSecretRefs` has existed for that since it was written and had no
   * caller at all, so the synchronous resolver downstream turned every one of
   * these into the literal string `<secret:monero.mainnet.rpc_password>` and
   * handed it to the application as a password.
   *
   * A key the vault does not hold resolves to an empty string, which an
   * application reports as an authentication failure against a credential it
   * was never given. That is worth a line naming the key.
   */
  private async resolveOverrideSecrets(
    projectName: string,
    overrides: IStackConfig['serviceOverrides'],
  ): Promise<IStackConfig['serviceOverrides']> {
    if (!overrides || Object.keys(overrides).length === 0) return overrides;
    if (!this.secrets) {
      this.logger.warn(
        { project: projectName, services: Object.keys(overrides) },
        'No secrets store here — service overrides keep their references, and an app given one as a password cannot authenticate',
      );
      return overrides;
    }

    const missing: string[] = [];
    const { resolveSecretRefs } = await import('../project/config-resolver.js');
    const resolved = await resolveSecretRefs(
      overrides as unknown as Record<string, unknown>,
      async (key) => {
        const value = await this.secrets!.get(key);
        if (value === null) missing.push(key);
        return value;
      },
    );

    if (missing.length > 0) {
      this.logger.error(
        { project: projectName, missing },
        'These secrets are named by the stack and absent from the vault — the apps will be given an empty credential',
      );
    }

    return resolved as unknown as IStackConfig['serviceOverrides'];
  }

  /**
   * The credentials the NODE resolved, read back from the node.
   *
   * `getConnectionInfo` answers from the config `provisionStack` stored after
   * running `withGeneratedCredentials` against the node's vault, so it is the
   * only account of these secrets that is true on the machine the apps will
   * run on.
   *
   * `null` is an answer — the node runs no such service — and leaves it as
   * the stack declared it. A read that did not happen is not an answer. This
   * was «best-effort per service»: a failed read fell back to the declared
   * credentials, and for a secret the node generated those are wrong by
   * construction. Test node, 2026-09-22 21:17:51 UTC: the heartbeat dropped
   * the peer mid-read («manual disconnect»), the apps were configured with
   * the declared postgres password, 6 of 6 migrations failed on it, and the
   * node was left in a mixed state. So a dropped connection is reconnected
   * and asked once more — this is a read, it can be — and a read that still
   * fails stops the deployment HERE, before any application is configured
   * with a password that is not the node's.
   */
  private async readNodeCredentials(
    connector: SlaveConnector,
    node: import('../config/types.js').IStackNode,
    /** The services this stack declares — each must be answered for. */
    declared: readonly string[] = [],
  ): Promise<Record<string, Record<string, unknown>>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const service of CREDENTIALED_SERVICES) {
      let info: Record<string, unknown> | null;
      try {
        info = (await connector.invokeOnSlave(
          node.host,
          node.port ?? 9700,
          'OmnitronInfra',
          'getConnectionInfo',
          [{ service }],
          { retryOnDisconnect: true },
        )) as Record<string, unknown> | null;
      } catch (err) {
        throw new Error(
          `Could not read ${service}'s credentials from ${node.host}: ${(err as Error).message}. ` +
            'A secret the node generated is known only there, and the one this stack declares would be wrong — ' +
            'stopping before any application is configured with it.',
          { cause: err },
        );
      }
      if (info) out[service] = info;
    }
    // Nothing is an answer only for a service the stack does not run. For one
    // it does, it means the node's daemon holds no infrastructure for it — it
    // restarted since it last provisioned, and the step that would have
    // provisioned it did not reach it. The declared password in its place is
    // wrong by construction: on sample/test (2026-09-25) a deployment right
    // after a `fleet upgrade` found the node 66 s into a 60 s mesh wait,
    // «deployed anyway», configured six apps with `postgres`, and was stopped
    // only because each app's migrations had to log in first.
    const missing = declared.filter((service) => !out[service]);
    if (missing.length > 0) {
      throw new Error(
        `${node.host} answered nothing for ${missing.join(', ')}, which this stack runs there: its daemon holds no ` +
          'infrastructure for them — it restarted since it last provisioned, and this deployment did not reach it to ' +
          'provision them again (see the infrastructure step above). Their generated credentials are known only there, ' +
          'so no application is configured with the declared ones. Run the deployment again once the node is in the mesh.',
      );
    }
    return out;
  }

  private async shipStackStatics(
    infrastructure: import('../infrastructure/types.js').InfrastructureConfig,
    projectRoot: string,
    node: import('../config/types.js').IStackNode,
    /**
     * A release's bundle, built in its clean clone with this stack's
     * `staticEnv`. Shipped as it is: rebuilding it from this disk would put
     * the developer's tree back into a release.
     */
    releasedStatics?: string,
    /**
     * Whose stack this is. Given, the delivery also points
     * `current-<project>-<stack>` at what it unpacked, and the roots come back
     * beside the build directories so the gateway can mount the ROOT instead
     * of the build — which is what stops it being recreated, and with it the
     * second of 000 a deployment costs.
     */
    owner?: { project: string; stack: string } | undefined,
  ): Promise<{ dirs: Record<string, string>; roots: Record<string, string> }> {
    // Both spellings, like the config reader beside it: a stack may declare
    // the gateway as a preset service or through the legacy top-level block,
    // and reading only one is how `serviceOverrides` was honoured for half
    // the services in this codebase once already.
    const legacy = (infrastructure as { gateway?: { staticDir?: string; staticEnv?: Record<string, string> } })
      .gateway;
    const preset = (
      infrastructure as {
        services?: Record<string, { config?: { staticDir?: string; staticEnv?: Record<string, string> } }>;
      }
    ).services?.['gateway'];
    const staticDir = preset?.config?.staticDir ?? legacy?.staticDir;
    if (!staticDir) return { dirs: {}, roots: {} };

    // How to build it, when it turns out to be stale. See `staticEnv`.
    const staticEnv =
      (preset?.config as { staticEnv?: Record<string, string> } | undefined)?.staticEnv ??
      (legacy as { staticEnv?: Record<string, string> } | undefined)?.staticEnv ??
      {};

    const abs =
      releasedStatics ??
      (staticDir.startsWith('/')
        ? staticDir
        : `${projectRoot.replace(/\/$/, '')}/${staticDir.replace(/^\.\//, '')}`);

    try {
      // Build it if it is behind, for the same reason a vendored package is
      // built if its `dist` is behind: "deploy" has to mean "deploy what is
      // in the tree". Measured on the test stack before this existed — the
      // `index.html` the gateway was serving had been built ten days and 879
      // source files earlier, so the test portal was not a test of anything
      // in the working tree, and nothing said so because nothing looked.
      //
      // Best-effort: a frontend that will not build is still worth shipping
      // as it stands, beside an error that says which it is. Refusing would
      // block a deployment whose BACKENDS are what changed.
      const stale = releasedStatics ? null : staleBuild(`${path.dirname(abs)}/src`, abs);
      if (stale) {
        this.logger.info({ dir: abs, stale }, 'The built frontend is behind its sources — rebuilding');
        try {
          const { resolvePnpm } = await import('../shared/pnpm.js');
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          await promisify(execFile)(resolvePnpm(), ['run', 'build'], {
            cwd: path.dirname(abs),
            timeout: 900_000,
            maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, ...staticEnv },
          });
        } catch (err) {
          this.logger.error(
            {
              dir: abs,
              error: (err as Error).message.slice(0, 800),
              staticEnv: Object.keys(staticEnv),
            },
            'Could not rebuild the frontend — shipping the build that is there. ' +
              'A build that refuses to guess needs `staticEnv` on the gateway service.',
          );
        }
      }

      // The same target the deployer uses for artifacts — with the node's SSH
      // user and credential. Passing a bare `{ host }` is how the first
      // attempt failed: `Failed to connect to 37.27.130.185`, an error about
      // credentials that were sitting in the registry all along.
      const target = await this.targetForStackNode(node);
      // Shared by every stack on the NODE — the literal names no project and
      // no stack — which is why the link inside it is per stack.
      const gatewayRoot = '/opt/omnitron/stack-static/gateway';
      const link = owner ? gatewayStaticLinkName(owner.project, owner.stack) : undefined;
      const deliver = () => this.deployer.uploadStaticBundle(target, abs, gatewayRoot, link);
      // Once more before giving up: `uploadStaticBundle` starts from nothing
      // each time — it removes what a failed attempt left — so a second try
      // is a clean one, and a transfer that broke once on a loaded link
      // usually does not break twice.
      const { remoteDir, bytes } = await deliver().catch((first: Error) => {
        this.logger.warn(
          { node: node.host, service: 'gateway', dir: abs, error: first.message.slice(0, 400) },
          'The frontend did not reach the node whole — sending it once more',
        );
        return deliver();
      });
      this.logger.info(
        { node: node.host, service: 'gateway', from: abs, remoteDir, bytes },
        bytes === 0 ? 'The node already has this build' : 'Frontend delivered to the node',
      );
      // The root travels only when the link was made: a node that gets a root
      // mounts it and serves through the link, and one that does not behaves
      // exactly as it did before. An ADDITIVE field for the same reason — the
      // master's omni may legitimately be newer than the node's, so a changed
      // value type would break both mixing directions while a field an old
      // node ignores breaks neither.
      return { dirs: { gateway: remoteDir }, roots: link ? { gateway: gatewayRoot } : {} };
    } catch (err) {
      // Fatal, and before anything on the node changes. This returned `{}`,
      // and the node was then provisioned with no static root: the gateway,
      // recreated without its `/var/www/portal`, fell back to proxying `/` to
      // a Vite that is not there, and answered 504 after 60 s to every page
      // — while the deployment reported «6/6 apps online» and exited 0.
      // Measured on test, 2026-09-22 20:12–20:20 UTC. Refusing here leaves
      // the gateway serving the frontend it had.
      this.logger.error(
        { node: node.host, service: 'gateway', dir: abs, error: (err as Error).message },
        'Could not deliver the frontend — refusing to provision a gateway that would serve nothing at /',
      );
      throw new FrontendNotDeliveredError(node.host, (err as Error).message);
    }
  }

  /**
   * Where the stack's static build lives, absolute, or undefined.
   *
   * Both spellings, and the same resolution `shipStackStatics` performs —
   * named once because two questions ask it: what to ship, and whether the
   * trees it is built from are the commits they claim.
   */
  private staticDirOf(
    infrastructure: import('../infrastructure/types.js').InfrastructureConfig | undefined,
    projectRoot: string,
  ): string | undefined {
    if (!infrastructure) return undefined;
    const legacy = (infrastructure as { gateway?: { staticDir?: string } }).gateway;
    const preset = (infrastructure as { services?: Record<string, { config?: { staticDir?: string } }> })
      .services?.['gateway'];
    const staticDir = preset?.config?.staticDir ?? legacy?.staticDir;
    if (!staticDir) return undefined;
    return staticDir.startsWith('/')
      ? staticDir
      : `${projectRoot.replace(/\/$/, '')}/${staticDir.replace(/^\.\//, '')}`;
  }

  /**
   * The config files the stack's services need, read from this master.
   *
   * Only services that name a directory to ship (`shippedDirOf`) — the
   * gateway's nginx tree, Nominatim's import scripts. A stack that names none
   * sends nothing, so this costs nothing where it is not needed.
   */
  private async readStackConfigFiles(
    infrastructure: import('../infrastructure/types.js').InfrastructureConfig,
    projectRoot: string,
    /** Filled with each service whose directory was sent → that directory's absolute path here. */
    shippedDirs?: Map<string, string>,
    /** The services the stack's apps require — each may name a directory of its own, as the stack's may. */
    services?: Record<string, import('../infrastructure/types.js').IServiceRequirement>,
  ): Promise<import('../infrastructure/config-payload.js').ConfigPayload> {
    const { readConfigDirectory } = await import('../infrastructure/config-payload.js');
    const { shippedDirsOf } = await import('../infrastructure/shipped-config.js');
    const fsp = await import('node:fs/promises');
    const payload: import('../infrastructure/config-payload.js').ConfigPayload = {};

    // The stack's own services first — an app's requirement of the same name
    // is the same service, and one directory is shipped for it.
    const candidates = shippedDirsOf(infrastructure as never, services);

    for (const [name, configDir] of candidates) {
      const abs = configDir.startsWith('/')
        ? configDir
        : `${projectRoot.replace(/\/$/, '')}/${configDir.replace(/^\.\//, '')}`;
      try {
        const { files, skipped } = await readConfigDirectory(abs, {
          readdir: (d) => fsp.readdir(d, { withFileTypes: true }),
          readFile: (f) => fsp.readFile(f, 'utf-8'),
          stat: (f) => fsp.stat(f),
        });
        if (files.length > 0) {
          payload[name] = files;
          shippedDirs?.set(name, abs);
        }
        if (skipped.length > 0) {
          // Said out loud: a file left behind changes what the service does,
          // and silence here would make the node's behaviour unexplainable
          // from the master.
          this.logger.warn({ service: name, dir: abs, skipped }, 'Some files were not sent to the node');
        }
      } catch (err) {
        // Not fatal. A stack whose gateway config is missing still gets its
        // databases, and the gateway fails visibly rather than the whole
        // provisioning stopping before anything was done.
        this.logger.error(
          { service: name, dir: abs, error: (err as Error).message },
          'Could not read this service\'s config directory — the node will run it unconfigured',
        );
      }
    }

    return payload;
  }

  private async provisionNodeInfrastructure(
    connector: SlaveConnector,
    node: import('../config/types.js').IStackNode,
    infrastructure: import('../infrastructure/types.js').InfrastructureConfig,
    services?: Record<string, import('../infrastructure/types.js').IServiceRequirement> | undefined,
    owner?: {
      project: string;
      stack: string;
      overrides?: Record<string, import('../infrastructure/types.js').IServiceOverride> | undefined;
    } | undefined,
    /**
     * This project's root on the MASTER, for reading the config files a
     * service needs on the node.
     *
     * The gateway is configured by files — an nginx template, an entrypoint,
     * Lua modules — and `resolveGateway` mounts them from this path. A node
     * has no copy of the project, so on a node those mounts do not exist and
     * the container comes up as bare openresty: measured on the test server,
     * an empty `Mounts` array, a null entrypoint, zero UPSTREAM variables,
     * and an onion serving `Welcome to OpenResty!` over Tor.
     */
    projectRoot?: string | undefined,
    /** A release's static bundle, shipped as it was built — see `shipStackStatics`. */
    releasedStatics?: string | undefined,
  ): Promise<{ ready: boolean; detail: string }> {
    const host = node.host;
    const port = node.port ?? 9700;

    await connector.addSlave({ host, port, label: node.label });

    // `addSlave` starts the connection and returns; invoking straight after
    // races it. Measured: "Slave 37.27.130.185:9700 not connected", against
    // a node the master connected to successfully two seconds later.
    if (!(await connector.waitUntilConnected(host, port, 60_000))) {
      this.logger.error(
        { node: `${host}:${port}` },
        'This node did not join the mesh within a minute — its infrastructure cannot be brought up from here',
      );
      return { ready: false, detail: 'the node did not join the mesh within a minute' };
    }

    try {
      const shippedDirs = new Map<string, string>();
      const configFiles = projectRoot ? await this.readStackConfigFiles(infrastructure, projectRoot, shippedDirs, services) : {};
      // A service's bind mounts inside its shipped directory name the node's
      // copy, not this machine's path — the stack's own services and the ones
      // its apps require alike. See `shipped-config.ts`.
      const { pointMountsAtShippedConfig } = await import('../infrastructure/shipped-config.js');
      const configForNode =
        projectRoot && infrastructure.services
          ? { ...infrastructure, services: pointMountsAtShippedConfig(infrastructure.services, shippedDirs, projectRoot) }
          : infrastructure;
      const servicesForNode = projectRoot && services ? pointMountsAtShippedConfig(services, shippedDirs, projectRoot) : services;

      // The frontend the gateway serves, if this stack declares one. It goes
      // by SSH rather than inside the call: 32 MB is the wrong size for an
      // RPC argument, which is held whole on both sides and blocks the call
      // it rides on. Config files are 65 KB and ride along; a build does not.
      const shipped = projectRoot
        ? await this.shipStackStatics(infrastructure, projectRoot, node, releasedStatics, owner)
        : { dirs: {}, roots: {} };
      const staticRoots = shipped.dirs;
      const staticLinkRoots = shipped.roots;

      // Retry once if the connection turns out to be gone: the deployer just
      // restarted this node's daemon, so the mesh connection the master holds
      // was established to the process that exited. `provisionStack` is a
      // reconciler, so applying it twice is applying it once.
      const report = (await connector.invokeOnSlave(
        host,
        port,
        'OmnitronInfra',
        'provisionStack',
        [{ config: configForNode, services: servicesForNode, ...(owner ?? {}), configFiles, staticRoots, staticLinkRoots }],
        { retryOnDisconnect: true },
      )) as { ready?: boolean; detail?: string; running?: string[]; failed?: unknown[]; missing?: string[] } | undefined;

      this.logger.info(
        {
          node: `${host}:${port}`,
          ready: report?.ready ?? false,
          running: report?.running?.length ?? 0,
          missing: report?.missing ?? [],
          failed: report?.failed ?? [],
        },
        report?.detail ?? 'Node infrastructure provisioned',
      );
      // The node's own words travel with the verdict: «not ready» without
      // them is a sentence nobody downstream can act on.
      return { ready: report?.ready === true, detail: report?.detail ?? 'the node did not say' };
    } catch (err) {
      // Not «infrastructure incomplete, deploying anyway»: the node was not
      // touched, and going on would put new backends behind the old frontend.
      if (err instanceof FrontendNotDeliveredError) throw err;
      this.logger.error(
        { node: `${host}:${port}`, error: (err as Error).message },
        'Could not bring up this node\'s infrastructure',
      );
      return { ready: false, detail: `could not ask the node: ${(err as Error).message}` };
    }
  }

  // ===========================================================================
  // Private — Utilities
  // ===========================================================================

  /**
   * Execute the explicit normalized migration owners in their declared order. Migrations are executed after databases are
   * created but before apps are started, so apps always see a current schema.
   *
   * Config bindings use declared cwd and verified release members. Legacy true
   * retains the conventional script. Both receive the owner's resolved environment.
   * Normalized presets are the authority for opt-in, including legacy sugar.
   */
  private async runStackMigrations(
    projectName: string,
    stackName: string,
    services: Readonly<Record<string, IServiceRequirement>>,
    appEntries: IEcosystemAppEntry[],
    projectPath: string,
    resolveEntry: (entry: IEcosystemAppEntry) => IEcosystemAppEntry,
    verifyMigrations?: VerifyMigrationEntries,
  ): Promise<void> {
    const names = requestedMigrations(services);
    const planned = await localMigrationTargets(names, appEntries, projectPath, verifyMigrations);
    // Validate every resolved destination before the first DB probe. No missing source fallback.
    const targets = planned.map(target => {
      const env = resolveEntry(appEntries.find(entry => entry.name === target.app)!).env;
      const database = migrationDatabaseEnvironment(target.environmentApp, env?.['DATABASE_URL'] ?? '', target.database, target.mode);
      return { target, env, database };
    });
    validateMigrationDestinations(targets.map(({ target, database }) => ({ app: target.app, database })));
    // Import every config and resolve its definitions before the first connection.
    // Runtime connect()/SQL are intentionally not executed by this preflight.
    for (const { target, env, database } of targets) if (target.mode === 'config') {
      try { await executeLocalMigration(target, { ...env, ...database.env }, { validate: true }); }
      catch (error) {
        const failed = error as Error & { stderr?: string };
        throw new Error(`Migration config refused for ${target.service}/${target.database} (${target.app}); no migrations executed: ${describeFailure(failed.stderr?.trim() || failed)}`, { cause: error });
      }
    }
    for (const { target, env, database } of targets) {
      const { host, port, user, password, connectionString } = database;
      this.logger.info({ project: projectName, stack: stackName, database: target.database, host, port }, 'Waiting for migration database');
      await waitForPostgres(host, port, user, password, 180_000, connectionString);
      // Database readiness may take minutes. Recheck the canonical payload and owner immediately before execution.
      const [current] = await localMigrationTargets([target], appEntries, projectPath, verifyMigrations);
      if (!current || !isDeepStrictEqual(current, target)) throw Error('Migration target changed during database readiness');
      this.logger.info({ project: projectName, stack: stackName, database: target.database }, 'Running database migrations');
      try {
        const { stdout } = await executeLocalMigration(target, { ...env, ...database.env });
        for (const line of migrationOutput(stdout)) this.logger.info({ database: target.database, line: redactDiagnosticText(line) }, 'Migration said');
        this.logger.info({ database: target.database, attempts: 1 }, 'Migrations applied');
      } catch (error) {
        const failed = error as Error & { stderr?: string };
        this.logger.error({ database: target.database, error: redactDiagnosticText(failed.message), stderr: redactDiagnosticText(failed.stderr?.trim() ?? '') },
          'Migration failed — stack startup refused');
        const reason = describeFailure(failed.stderr?.trim() || failed);
        throw new Error(`Migration failed for ${projectName}/${stackName}/${target.service}/${target.database} (${target.app}); stack startup refused: ${reason}. Inspect the migration ledger before retrying.`, { cause: error });
      }
    }
  }

  /**
   * Resolve stacks from config + user stacks.
   * User-created stacks (from omnitron.stacks.json) are merged with config stacks.
   * Config stacks take precedence over user stacks with the same name.
   * No implicit fallbacks — stacks must be created explicitly.
   */
  private resolveStacks(config: IEcosystemConfig, project?: string | ISeedProject): Record<string, IStackConfig> {
    if (!project) return config.stacks ?? {};
    if (typeof project !== 'string') return resolveProjectStacks(config, project.path, project.name);
    const directory = path.dirname(this.getUserStacksPath(project));
    return resolveProjectStacks(config, directory, project);
  }

  /**
   * The environment a stack gives its apps, vault references resolved
   * (`project/stack-env.ts`). Throws — the start is refused — for a key the
   * vault does not hold, an `appEnv` for an app the stack does not run, or a
   * malformed entry. Values never leave this call except into the apps' env.
   */
  private async stackEnvFor(
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    apps: readonly string[],
  ): Promise<import('../project/stack-env.js').StackEnv> {
    const { resolveStackEnv } = await import('../project/stack-env.js');
    const secrets = this.secrets;
    return resolveStackEnv({
      settings: stackConfig.settings,
      apps,
      getSecret: secrets ? (key) => secrets.get(key) : undefined,
      where: `${projectName}/${stackName}`,
    });
  }

  /**
   * How each app of a local stack is started: the entry handed to the
   * orchestrator — named into its stack, its environment computed from the
   * stack's resolved configuration and then the project config's own.
   *
   * One builder for the start and for a re-read of the project
   * (`rereadProject`), so a running app is redefined exactly as it would be
   * started.
   */
  private stackEntryBuilder(
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
    appDefinitions: Map<string, IAppDefinition>,
    stackEnv: Readonly<Record<string, Readonly<Record<string, string>>>>,
  ): (entry: IEcosystemAppEntry) => IEcosystemAppEntry {
    const project = this.registry.get(projectName);
    const portAllocation = this.infraManager.getPortAllocation(projectName, stackName);
    const normalizedSvcs = this.infraManager.getNormalizedServices(projectName, stackName);
    const resolvedStack = ownsStackInfrastructure(stackConfig) ? resolveStack(
      ecosystemConfig,
      projectName,
      stackName,
      stackConfig,
      appDefinitions,
      portAllocation ?? undefined,
      normalizedSvcs ?? undefined,
    ) : undefined;

    return (entry: IEcosystemAppEntry): IEcosystemAppEntry => {
      const appConfig = resolvedStack?.appConfigs.get(entry.name);
      const infraEnv = appConfig ? resolvedConfigToEnv(appConfig, entry.name, stackName) : {};
      return {
        ...entry,
        name: ProjectService.handleKey(projectName, stackName, entry.name),
        ...(entry.bootstrap && project
          ? { bootstrap: resolveAppPath(project.path, entry, entry.bootstrap) }
          : {}),
        ...(project ? { cwd: resolveAppPath(project.path, entry) } : {}),
        env: {
          // Derived first, stated second. `infraEnv` is COMPUTED from the
          // stack's configuration; `entry.env` is WRITTEN — by a developer
          // in the project config, or, on a node, by the master that
          // provisioned the services and read their credentials back from
          // the machine they run on.
          //
          // The other order made the computed value win, and on a node the
          // computation has nothing to compute from: the generated config
          // carries no `infrastructure` block, so `resolveStackAddresses`
          // ends at its literal and overwrote a correct
          // `postgres://postgres:<43-char secret>@…` with
          // `postgres://postgres:postgres@…`. The apps then failed with
          // `password authentication failed for user "postgres" (28P01)`
          // against credentials that had been handed to them correctly and
          // thrown away one line later.
          //
          // It also meant an operator could not override a computed address
          // at all, which is not a thing a config system should refuse.
          // The stack's own (`settings.env`, then `settings.appEnv[app]`,
          // vault references resolved by `stackEnvFor`) still wins over both.
          ...infraEnv,
          ...entry.env,
          ...stackEnv[entry.name],
          OMNITRON_PROJECT: projectName,
          OMNITRON_STACK: stackName,
          OMNITRON_STACK_TYPE: 'local',
        },
      };
    };
  }

  /**
   * Every application in a stack, with what it declares it needs.
   *
   * Extracted because a remote stack needs exactly this and had no way to
   * get it: `startRemoteStack` built its own list of app ENTRIES and never
   * their definitions, so the `infrastructure` an application declares —
   * its chain daemon, its cache — was invisible on that path. The local
   * path had it all along, twenty lines up from where it was needed.
   */
  private async loadAppDefinitions(
    projectName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
    appEntries = this.resolveStackApps(stackConfig, ecosystemConfig),
    archived?: ReadonlyMap<string, DeclaredConfig>,
  ): Promise<Map<string, IAppDefinition>> {
    const appDefinitions = new Map<string, IAppDefinition>();
    const project = this.registry.get(projectName);

    for (const entry of appEntries) {
      if (entry.releaseFrom) throw Error('Application ' + entry.name + ' requires a prepared and selected release before its prerequisites can be read');
      if (entry.bootstrap && project) {
        try {
          const bootstrapAbsPath = resolveAppPath(project.path, entry, entry.bootstrap);
          const { definition: loaded, metadata } = await readBootstrapMetadata(bootstrapAbsPath);
          this.bootstrapMetadata.save(metadata);
          // Preserve only declarative data across backend handoffs, never executable hooks.
          this.bootstrapTopology.set(bootstrapAbsPath, structuredClone({ ...(loaded.requires ? { requires: loaded.requires } : {}), ...(loaded.omnitronConfig ? { omnitronConfig: loaded.omnitronConfig } : {}) }));

          // The app's `config/default.json`, read now and put on a COPY of
          // the definition: the loaded one is the loader's cache entry, and
          // writing to it made the first read the only one until the daemon
          // restarted (`project/declared-config.ts`).
          const declared = archived ? archived.get(entry.name) : readDeclaredConfig(bootstrapAbsPath);
          if (!declared) throw Error('Missing admitted app declaration');
          if (declared.malformed) throw new Error(`Application configuration is invalid or unreadable: ${entry.name}`);
          const definition = withDeclaredConfig(loaded, declared);

          appDefinitions.set(entry.name, definition);
        } catch (err) {
          this.bootstrapMetadata.fail(resolveAppPath(project.path, entry, entry.bootstrap), err);
          this.logger.error({ app: entry.name, bootstrap: entry.bootstrap }, 'Stack prerequisites unavailable; refusing incomplete provisioning');
          throw new Error(`Could not read declarations for ${entry.name}: ${publicLaunchFailure(err)}. Refresh declarations before starting.`, { cause: err });
        }
      }
    }

    return appDefinitions;
  }

  /**
   * The infrastructure a stack's applications declare, merged and overridden.
   *
   * One entry per service name: two applications that both declare
   * `postgres` mean one Postgres, which is what `serviceOverrides` keys on
   * and what the container resolver has always assumed. A later declaration
   * that disagrees with an earlier one refuses the plan; application ordering
   * must not silently choose the configuration of a shared service.
   */
  private async collectDeclaredServices(
    projectName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
    /** Keep the ones reached elsewhere too — to ask whether they answer, not to provision them. */
    options: { external?: boolean; definitions?: Map<string, IAppDefinition> | undefined } = {},
  ): Promise<Record<string, import('../infrastructure/types.js').IServiceRequirement>> {
    const merged: Record<string, import('../infrastructure/types.js').IServiceRequirement> = {};
    const definitions = options.definitions ?? await this.loadAppDefinitions(projectName, stackConfig, ecosystemConfig);

    for (const [appName, definition] of definitions) {
      const declared = definition.omnitronConfig?.infrastructure;
      if (!declared) continue;

      for (const [name, requirement] of Object.entries(declared)) {
        const override = stackConfig.serviceOverrides?.[`${appName}/${name}`] ?? stackConfig.serviceOverrides?.[name];
        // Disabled, or pointed at something that already exists: there is
        // nothing to provision, and an address reaches the application
        // through its environment instead.
        const { provisioning } = bindService(requirement as import('../infrastructure/types.js').IServiceRequirement, override);
        if (provisioning === 'disabled' || (provisioning === 'external' && !options.external)) continue;

        if (merged[name]) {
          if (!isDeepStrictEqual(merged[name], requirement)) throw new Error(`Conflicting infrastructure declarations for ${name}; use one shared specification or distinct service names`);
          continue;
        }
        merged[name] = requirement as import('../infrastructure/types.js').IServiceRequirement;
      }
    }

    return merged;
  }

  private localSelection(project: string, stack: string): LocalReleaseSelection {
    const registration = this.registry.get(project);
    if (!registration) throw new Error('Project is not registered');
    return new LocalReleaseSelection(this.daemonStateStore, { project, stack }, registration.registeredAt);
  }

  private async installedEntries(project: string, stack: string, definition: IStackConfig, config: IEcosystemConfig, release: LoadedRelease, prepare = false, requiredMigrations?: readonly string[], migrationFiles?: MigrationRequiredFiles) {
    return (await this.installedRelease(project, stack, definition, config, release, prepare, requiredMigrations, migrationFiles)).entries;
  }

  private async installedRelease(project: string, stack: string, definition: IStackConfig, config: IEcosystemConfig, release: LoadedRelease, prepare = false, requiredMigrations?: readonly string[], migrationFiles?: MigrationRequiredFiles) {
    const root = this.registry.get(project)?.path;
    if (!root) throw new Error('Project is not registered');
    const { inspectLocalReleaseInstallation, inspectLocalReleasePayloads } = await import('../release/local-installation.js');
    const stackEntries = this.resolveStackApps(definition, config);
    // Validate the complete stack before narrowing executable verification to
    // migration owners. Other applications still own their declared environment.
    const env = await this.stackEnvFor(project, stack, definition, stackEntries.map(entry => entry.name));
    const configured = stackEntries.filter(entry => !requiredMigrations || requiredMigrations.includes(entry.name));
    const entries = configured.map(entry => ({
      ...entry, env: { ...entry.env, ...env[entry.name] },
      ...(!entry.releaseFrom || entry.cwd !== undefined ? { cwd: resolveAppPath(root, entry) } : {}),
      ...(entry.bootstrap && { bootstrap: resolveAppPath(root, entry, entry.bootstrap) }),
    }));
    const ownerPid = this.orchestrator.getExecutionOwnerPid?.();
    if (!ownerPid) throw new Error('A verified local release requires a connected independent execution owner');
    const ownerPackage = await this.orchestrator.getExecutionOwnerPackage?.();
    if (!ownerPackage) throw new Error('Verified runtime origin requires an independently verified execution-owner package');
    const infrastructure = mergeInfrastructure(config, definition);
    const payloads = artifactVolumeEntries(infrastructure, config.apps);
    const roots = await inspectLocalReleasePayloads(release, payloads, prepare);
    const resolved = await bindArtifactVolumes(infrastructure, roots);
    const installed = await inspectLocalReleaseInstallation(release, stack, entries, { prepare, ownerPid, ownerPackage,
      ...(requiredMigrations && { requiredFiles: migrationFiles ?? Object.fromEntries(requiredMigrations.map(app => [app, [COMPILED_MIGRATION_ENTRY]])) }),
    });
    const preparedArtifactVolumes: import('../shared/dto/project.js').PreparedArtifactVolume[] = artifactVolumeBindings(infrastructure).map(([binding, value]) => {
      const service = resolved?.services?.[value.service];
      const mount = service && !('preset' in service) ? service.docker?.volumes?.[binding] : undefined;
      const artifact = release.manifest.artifacts.find(item => item.app === value.app);
      if (!mount || typeof mount === 'string' || mount.readonly !== true || !artifact) throw Error('Verified artifact volume result is unavailable');
      return { binding, ...value, source: mount.source, target: mount.target, readonly: true,
        releaseId: release.id, manifestSha256: release.manifestSha256, artifactSha256: artifact.sha256 };
    });
    return { entries: installed, infrastructure: resolved, preparedArtifactVolumes };
  }

  /** All consumers of executable declarations must see the same physical entry as the owner. */
  private async launchEntries(project: string, stack: string, definition: IStackConfig, config: IEcosystemConfig, requiredMigrations?: readonly string[], migrationFiles?: MigrationRequiredFiles) {
    const selected = definition.type === 'local' && !definition.managedOrigin ? this.localSelection(project, stack).read().release : null;
    if (!selected) return this.resolveStackApps(definition, config);
    const { loadRelease } = await import('../release/load.js');
    const release = await loadRelease(selected.id, await this.releaseStore());
    if (release.manifestSha256 !== selected.manifestSha256) throw new Error('Selected release manifest changed on disk');
    return this.installedEntries(project, stack, definition, config, release, false, requiredMigrations, migrationFiles);
  }

  private async checkLocalOwner(project: string, stack: string, entries: IEcosystemAppEntry[], changing: boolean, automatic = false) {
    const plan = await this.orchestrator.inspectStackExecution({ project, stack });
    await this.orchestrator.refreshObservation?.();
    if (plan.phase === 'stopping' || plan.phase === 'starting')
      throw new Error('Stack has an unfinished owner operation; inspect it before selecting a release');
    const expected = new Map(entries.map(entry => [ProjectService.handleKey(project, stack, entry.name), entry]));
    const retiring = plan.apps.filter(app => !expected.has(app.name));
    if (retiring.length) {
      if (this.orchestrator.getExecutionCapabilities?.()['stoppedStackReconciliation'] !== 1)
        throw new Error('Execution owner does not support stopped stack reconciliation; prepare an owner upgrade with an application restart plan before changing stack membership.');
      if (automatic) throw new Error('Automatic resume cannot remove retained applications; explicitly stop and start the selected stack to reconcile its membership');
    }
    for (const app of plan.apps) {
      const handle = this.orchestrator.getHandle(app.name);
      const entry = expected.get(app.name);
      if (!handle) throw new Error('Owner observation changed; inspect the local stack before selecting a release: ' + app.name);
      if (handle.status === 'stopped' && handle.pid === null) continue;
      if (retiring.length || changing || plan.phase === 'stopped' || !entry || !sameLaunchCode(handle.entry, entry))
        throw new LocalReleaseStopRequired('Stop the applications of this local stack before changing launch code or membership: ' + app.name);
    }
    return plan;
  }

  /** The owner's durable stop fence covers the gap between the SQLite commit and the complete graph reconciliation. */
  private async prepareLocalOwner(project: string, stack: string, entries: IEcosystemAppEntry[], changing: boolean,
    build: (entry: IEcosystemAppEntry) => IEcosystemAppEntry, commit: () => void) {
    let plan = await this.checkLocalOwner(project, stack, entries, changing);
    const next = new Map(entries.map(entry => { const built = build(entry); return [built.name, built]; }));
    const retiring = plan.apps.some(app => !next.has(app.name));
    if ((changing || retiring) && plan.phase !== 'stopped') {
      await this.orchestrator.stopStackExecution({ operationId: randomUUID(), plan });
      plan = await this.orchestrator.inspectStackExecution({ project, stack });
    }
    commit();
    if (changing || plan.phase === 'stopped') {
      if (this.orchestrator.getExecutionCapabilities?.()['stoppedStackReconciliation'] === 1) {
        await this.orchestrator.reconcileStoppedStack({ operationId: randomUUID(), plan, entries: [...next.values()] });
      } else {
        // Existing owners can replace entries of an unchanged inventory only.
        // checkLocalOwner refuses membership changes before committing a selection.
        for (const { name } of plan.apps) {
          if (!await this.orchestrator.redefineApp(name, next.get(name)!))
            throw new Error('Owner could not confirm the selected entry for ' + name + '; the stack remains fenced');
        }
      }
    }
  }

  private resolveStackApps(
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
  ) {
    const allApps = ecosystemConfig.apps.filter((a) => a.enabled !== false);

    if (!stackConfig.apps || stackConfig.apps === 'all') {
      return allApps;
    }

    return allApps.filter((a) => Array.isArray(stackConfig.apps) ? stackConfig.apps.includes(a.name) : true);
  }

  private markPriorStopSuperseded(project: string, stack: string, expectedStopId?: string): void {
    this.daemonStateStore.kvUpdateSync<StackStopProgress | null>(`stack:${project}/${stack}:last-stop`, prior => {
      if (!prior || (expectedStopId && prior.id !== expectedStopId)) return prior;
      return { ...prior, supersededAt: new Date().toISOString() };
    });
  }

  private updateEnabledStacks(projectName: string, stackName: string, enabled: boolean): void {
    this.registry.setStackEnabled(projectName, stackName, enabled);
  }

  private toProjectInfo(project: ISeedProject): IProjectInfo {
    const config = this.configRegistry.get(project.name)?.config;
    const stacks = config ? this.resolveStacks(config, project.name) : {};
    const runningStacks = this.getRunningStacks(project.name);

    return {
      name: project.name,
      displayName: config?.project ?? project.name,
      path: project.path,
      registeredAt: project.registeredAt,
      enabledStacks: project.enabledStacks ?? [],
      runningStacks: runningStacks.length,
      totalStacks: Object.keys(stacks).length,
    };
  }

  /**
   * A remote stack's apps, as the NODES report them.
   *
   * `toStackInfo` reads this daemon's own orchestrator handles. For a remote
   * stack there are none — the applications run on the nodes, under the
   * node's own naming (`<project>/deployed/<app>`) — so every app came back
   * `stopped` and the report was:
   *
   *     Stack sample/test: only 0/6 apps came online.
   *     Not online: main (stopped), storage (stopped), quotes (stopped),
   *     payments (stopped), messaging (stopped), geo (stopped)
   *
   * measured against a node answering `appsTotal: 6, appsOnline: 6` with
   * every port listening, thirty seconds after this same master installed,
   * migrated and started them. The CLI exits 1 on that count, so a correct
   * deployment fails a script; and the console's stack page shows the same
   * six rows, stopped.
   *
   * Each node retains its own observation. An unavailable source is unknown;
   * a replica on another node cannot turn that missing observation into online.
   */
  private localHealthRead: Promise<HealthAnswers | null> | null = null;

  async withRemoteAppStatuses(projectName: string, info: IStackInfo): Promise<IStackInfo> {
    if (info.type !== 'local') return (await this.askNodes(projectName, info)).info;
    // Concurrent inventory consumers share one owner read; no stale health cache
    // survives an application restart or silently becomes a green default.
    const read: Promise<HealthAnswers | null> = this.localHealthRead ??= Promise.resolve().then(() => this.orchestrator.getHealth())
      .catch(() => null).finally(() => { if (this.localHealthRead === read) this.localHealthRead = null; });
    const health = await read;
    // Re-read lifecycle after the asynchronous health observation.
    const current = this.getStack(projectName, info.name);
    const unchanged = new Set(info.apps.filter(a => current.apps.some(b => b.handleKey === a.handleKey &&
      b.pid === a.pid && b.status === a.status && b.restarts === a.restarts)).map(a => a.handleKey));
    const bound = health && Object.fromEntries(Object.entries(health).filter(([name]) => unchanged.has(name)));
    return observeStackHealth(current, new Map([['local', bound]]), new Date().toISOString());
  }

  /**
   * The same question, with the count of nodes that answered it.
   *
   * `connectedNodes` used to be read from the connector's registry, which
   * said 0 about a node that was answering RPCs at that moment — measured
   * 2026-09-22, three times in three seconds, beside a `stack status` that
   * listed six apps online from the very same node. A registry is
   * bookkeeping; an answer is a fact, and this is where the answers are.
   */
  private async askNodes(
    projectName: string,
    info: IStackInfo,
  ): Promise<{ info: IStackInfo; answered: number }> {
    if (info.type !== 'remote' && info.type !== 'cluster') return { info, answered: 0 };
    const nodes = [...(info.config.nodes ?? [])];
    // Keep the last actual runtime footprint visible if its source configuration changes.
    // Unadmitted target plans are never evidence that a workload ran on a node.
    for (const old of this.stackStates.get(`${projectName}/${info.name}`)?.config.nodes ?? [])
      if (!nodes.some(node => node.host === old.host && (node.port ?? 9700) === (old.port ?? 9700))) nodes.push({ ...old, apps: [] });
    if (nodes.length === 0) return { info: observeStackHealth(info, new Map(), new Date().toISOString()), answered: 0 };
    if (!this.slaveConnector) return {
      info: observeStackHealth(observeStack(info, nodes.map(node => nodePlacement(projectName, info, node, null, null, new Date().toISOString()))),
        new Map(), new Date().toISOString()),
      answered: 0,
    };

    const health = new Map<string, HealthAnswers | null>();
    const placements: import('../shared/dto/project.js').IStackPlacement[] = [];
    // Bounded fan-out: one failed peer must not hide the other peers' inventory.
    for (let offset = 0; offset < nodes.length; offset += 4) {
      placements.push(...await Promise.all(nodes.slice(offset, offset + 4).map(async node => {
        const [processAnswer, infrastructureAnswer, healthAnswer] = await Promise.allSettled([
          this.slaveConnector!.invokeOnSlave(node.host, node.port ?? 9700, 'OmnitronDaemon', 'status', []),
          this.remoteInfraStatus(projectName, info.name, node),
          this.slaveConnector!.invokeOnSlave(node.host, node.port ?? 9700, 'OmnitronDaemon', 'getHealth', [{}]),
        ]);
        const status = processAnswer.status === 'fulfilled'
          ? processAnswer.value as import('../config/types.js').DaemonStatusDto : null;
        const processes = status && Array.isArray(status.apps) ? status.apps : null;
        const reading = healthAnswer.status === 'fulfilled' ? healthAnswer.value as { apps?: HealthAnswers } : null;
        health.set(stackNodeKey(node.host, node.port), reading?.apps ?? null);
        return nodePlacement(projectName, info, node, processes,
          infrastructureAnswer.status === 'fulfilled' ? infrastructureAnswer.value : null,
          new Date().toISOString());
      })));
    }
    return { info: observeStackHealth(observeStack(info, placements), health, new Date().toISOString()), answered: placements.filter(node => node.appsObserved).length };
  }


  /**
   * One node's infrastructure, named the way the stack names it.
   *
   * The node's container names carry ITS prefix (`sample-test-postgres`), and
   * a reader wants the service — `postgres` — so the same stripping the
   * local path does is done here. `null` means the node could not answer;
   * an empty inventory is an observed absence, never this master's inventory.
   */
  private async remoteInfraStatus(
    projectName: string,
    stackName: string,
    node: import('../config/types.js').IStackNode,
  ): Promise<IStackInfraStatus | null> {
    if (!this.slaveConnector) return null;
    try {
      const state = (await this.slaveConnector.invokeOnSlave(
        node.host,
        node.port ?? 9700,
        'OmnitronInfra',
        'getState',
        [],
      )) as import('../infrastructure/types.js').InfrastructureState | null;

      const prefix = `${projectName}-${stackName}-`;
      const services: IStackInfraStatus['services'] = {};

      // A node's infra state is IN MEMORY. After its daemon restarts it
      // answers `null` until a master provisions the stack again, while the
      // containers keep running — so the stack read "not provisioned" about
      // six healthy containers. The containers are the fact; the state is a
      // cache of it.
      const entries: Array<[string, import('../infrastructure/types.js').ContainerState]> = state?.services
        ? Object.entries(state.services)
        : ((await this.slaveConnector.invokeOnSlave(
            node.host,
            node.port ?? 9700,
            'OmnitronInfra',
            'listContainers',
            [],
          )) as import('../infrastructure/types.js').ContainerState[] ?? [])
            .map((c) => [c.name, c]);

      const owned = entries.filter(([, service]) => service.project || service.stack
        ? service.project === projectName && service.stack === stackName
        : service.name.startsWith(prefix));

      for (const [containerName, svc] of owned) {
        const name = containerName.startsWith(prefix) ? containerName.slice(prefix.length) : containerName;
        services[name] = stackServiceObservation({ ...svc, service: svc.service ?? name });
      }

      // Without the node's own verdict, "ready" is what the containers say:
      // every one of them running.
      const ready = Object.values(services).every(svc => svc.status === 'running' && svc.health !== 'unhealthy' && svc.health !== 'starting' && !svc.error && (!svc.provisioning || svc.provisioning === 'ready'));
      return { ready, services };
    } catch (err) {
      this.logger.warn(
        { project: projectName, stack: stackName, node: node.host, error: (err as Error).message },
        'Node infrastructure inventory unavailable; placement state is unknown',
      );
      return null;
    }
  }

  private toStackInfo(projectName: string, stackName: string, config: IStackConfig): IStackInfo {
    const stateKey = `${projectName}/${stackName}`;
    const state = this.stackStates.get(stateKey);
    const prefix = `${projectName}/${stackName}/`;

    // Build app list from config — include both running and stopped apps.
    const ecosystemConfig = this.getLoadedConfig(projectName);
    const configuredApps = ecosystemConfig ? this.resolveStackApps(config, ecosystemConfig) : [];
    // A bare handle carries no project/stack ownership. Assigning it by basename
    // admitted the same process into every project that configured "api". Only an
    // exact namespace proves ownership; ad-hoc bare processes remain visible in list.
    const runningByName = new Map<string, ReturnType<OrchestratorService['list']>[number]>();
    for (const a of this.orchestrator.list()) {
      const effective = effectiveAppName(a.name);
      const inThisPrefix = a.name.startsWith(prefix);
      if (!inThisPrefix) continue;
      // An exact qualified identity belongs to this stack only.
      const existing = runningByName.get(effective);
      if (!existing || a.name.startsWith(prefix)) {
        runningByName.set(effective, a);
      }
    }

    const apps: IStackAppStatus[] = configuredApps.map((entry) => {
      const running = runningByName.get(entry.name);
      if (running) {
        runningByName.delete(entry.name);
        return {
          name: entry.name,
          handleKey: running.name,
          status: running.status,
          pid: running.pid,
          instances: running.instances,
          uptime: running.uptime,
          restarts: running.restarts,
          cpu: running.cpu,
          memory: running.memory,
          port: running.port ?? null,
          ...(running.generation !== undefined && { generation: running.generation }),
          ...(running.release && { release: running.release }),
        };
      }
      // App is configured but not running
      return {
        name: entry.name,
        handleKey: `${prefix}${entry.name}`,
        status: 'stopped' as AppStatus,
        pid: null,
        instances: 0,
        uptime: 0,
        restarts: 0,
        cpu: 0,
        memory: 0,
        port: null,
      };
    });

    // Include any running apps not in config (shouldn't happen, but be safe)
    for (const [name, running] of runningByName) {
      apps.push({
        name,
        handleKey: running.name,
        status: running.status,
        pid: running.pid,
        instances: running.instances,
        uptime: running.uptime,
        restarts: running.restarts,
        cpu: running.cpu,
        memory: running.memory,
        port: running.port ?? null,
        ...(running.generation !== undefined && { generation: running.generation }),
        ...(running.release && { release: running.release }),
      });
    }

    // Populate real node connectivity from SlaveConnector
    const slaveConnections = this.slaveConnector?.getConnections() ?? [];
    const nodes: IStackNodeStatus[] = (config.nodes ?? []).map((n) => {
        const port = n.port ?? 9700;
        const conn = slaveConnections.find((c: any) => c.host === n.host && c.port === port);
        const connected = conn?.status === 'connected';

        return {
          host: n.host,
          port,
          role: n.role,
          label: n.label ?? null,
          daemonRole: n.role === 'master' ? 'master' as DaemonRole : 'slave' as DaemonRole,
          connected,
          lastSeen: conn?.lastHeartbeat ?? null,
          syncStatus: (conn?.syncStatus ?? null) as ISyncStatus | null,
        };
      });

    // For local stacks, add implicit local node
    if (config.type === 'local' && nodes.length === 0) {
      nodes.push({
        host: 'localhost',
        port: 9700,
        role: 'app',
        label: 'Local',
        daemonRole: 'master',
        connected: true,
        lastSeen: Date.now(),
        syncStatus: null,
      });
    }

    // Populate infrastructure status from actual InfrastructureService
    const infraInstance = this.infraManager.getInstance(projectName, stackName);
    const infraState = infraInstance?.getState();
    const infraServices: IStackInfraStatus['services'] = {};

    if (infraState?.services) {
      // Container names are "{project}-{stack}-{service}" (e.g. omni-dev-postgres).
      // UI looks up by service name (e.g. "postgres"), so strip the stack prefix.
      const stackPrefix = `${projectName}-${stackName}-`;
      for (const [containerName, svcState] of Object.entries(infraState.services)) {
        const serviceName = containerName.startsWith(stackPrefix)
          ? containerName.slice(stackPrefix.length)
          : containerName;
        infraServices[serviceName] = stackServiceObservation(svcState);
      }
    }

    const infrastructure: IStackInfraStatus = {
      ready: infraState?.ready ?? false,
      services: infraServices,
    };

    // A remote stack's applications run on its nodes, and when they started
    // is the nodes' to say (`askNodes`). What this master remembers is when
    // IT took charge — deployed the stack, or attached to it after its own
    // restart — and that was printed as the stack's start: «13:03:46», 25
    // minutes of uptime, on a stack whose six applications had been running
    // on the node since 12:20:48 (measured 2026-09-23, after a master
    // restart). It is reported as what it is.
    const onNodes = config.type === 'remote' || config.type === 'cluster';
    const since = state?.startedAt ?? null;
    let status = state?.status ?? 'stopped';
    const notUp: string[] = [];
    if (!onNodes && (status === 'running' || (since !== null && (status === 'degraded' || status === 'error')))) {
      const down = apps.filter(app => app.status !== 'online');
      for (const app of down) {
        const errors = state?.appStartErrors;
        const reason = errors && Object.hasOwn(errors, app.name) ? errors[app.name] : undefined;
        notUp.push(`${app.name} (${app.status})${reason ? ': ' + reason : ''}`);
      }
      if (!infrastructure.ready && (state?.infrastructureStartFailed || state?.infraService?.getDesiredServices().length)) {
        notUp.push('infrastructure: required services are not ready (see daemon log)');
      }
      if (notUp.length === 0) status = 'running';
      else if (down.length < apps.length || down.some(app => app.status === 'starting') ||
        (apps.length === 0 && Object.values(infrastructure.services).some(service => service.status === 'running'))) status = 'degraded';
      else status = 'error';
    }

    const selectedRelease = config.type === 'local' && !config.managedOrigin ? this.localSelection(projectName, stackName).read().release : null;
    return {
      name: stackName,
      type: config.type,
      ...(selectedRelease && { selectedRelease }),
      status,
      ...(notUp.length > 0 && { notUp }),
      resumeOperation: this.daemonStateStore.kvGetSync<InstalledStackResumeResult>(`stack:${stateKey}:last-resume`, { strict: true }) ?? undefined,
      stopOperation: this.daemonStateStore.kvGetSync<import('../shared/dto/project.js').StackStopProgress>(`stack:${projectName}/${stackName}:last-stop`, { strict: true }) ?? undefined,
      config,
      nodes,
      apps,
      infrastructure,
      portRange: config.portRange ?? null,
      startedAt: !onNodes && since ? new Date(since).toISOString() : null,
      uptime: !onNodes && since ? Date.now() - since : 0,
      attachedAt: onNodes && since ? new Date(since).toISOString() : null,
    };
  }
}

/**
 * How a master's daemon builds this service: the tokens it resolves, in
 * order, and the factory that receives them.
 *
 * Here and not inline in daemon.module.ts so that the ORDER can be held to
 * account: `inject` and the factory's parameters are two lists that must
 * agree position by position, and the container hands the values over as
 * `any`. Swapped there, the vault arrives as the audit trail and neither
 * complains until a deployment needs one of them. See
 * `test/unit/a-factory-that-passed-its-arguments-by-position.test.ts`.
 */
export const MASTER_PROJECT_SERVICE_PROVIDER: {
  readonly inject: readonly unknown[];
  readonly useFactory: (
    loggerModule: ILoggerModule,
    orchestrator: OrchestratorService,
    daemonStateStore: DaemonStateStore,
    secrets: SecretsService,
    audit: AuditService,
  ) => ProjectService;
} = {
  inject: [LOGGER_SERVICE_TOKEN, ORCHESTRATOR_TOKEN, DAEMON_STATE_STORE_TOKEN, SECRETS_SERVICE_TOKEN, AUDIT_SERVICE_TOKEN],
  useFactory: (
    loggerModule: ILoggerModule,
    orchestrator: OrchestratorService,
    daemonStateStore: DaemonStateStore,
    secrets: SecretsService,
    audit: AuditService,
  ): ProjectService =>
    // `syncService` has never been passed here; `secrets` is what a stack's
    // service overrides name their credentials with, and without it a
    // deployed app is handed `<secret:…>` as a password. `audit` is here
    // because two of the three callers of `startStack` never pass through the
    // RPC layer that used to record it.
    new ProjectService(loggerModule.logger, orchestrator, daemonStateStore, {
      secrets, audit, ...(readSavedDaemonConfig()?.releaseStore ? { receiveRelease: async (id: string, root: string) => {
        const { configuredReleaseStore, configuredStoreConfig } = await import('../release/configured-store.js');
        const { pullRelease } = await import('../release/artifact-store.js');
        await audit.record({ action: 'release.pull.requested', resourceType: 'release', resourceId: id }, true);
        const store = await configuredReleaseStore(configuredStoreConfig(), key => secrets.get(key));
        try {
          const result = await pullRelease(id, store, { root });
          await audit.record({ action: 'release.pull', resourceType: 'release', resourceId: id,
            details: { indexSha256: result.indexSha256, files: result.moved.files, bytes: result.moved.bytes } }, true);
        } finally { store.close(); }
      } } : {}),
    }),
};

/** A slave has its own encrypted vault even though it has no master database/audit service. */
export const SLAVE_PROJECT_SERVICE_PROVIDER: {
  readonly inject: readonly unknown[];
  readonly useFactory: (
    loggerModule: ILoggerModule,
    orchestrator: OrchestratorService,
    daemonStateStore: DaemonStateStore,
    secrets: SecretsService,
  ) => ProjectService;
} = {
  inject: [LOGGER_SERVICE_TOKEN, ORCHESTRATOR_TOKEN, DAEMON_STATE_STORE_TOKEN, SECRETS_SERVICE_TOKEN] as const,
  useFactory: (
    loggerModule: ILoggerModule,
    orchestrator: OrchestratorService,
    daemonStateStore: DaemonStateStore,
    secrets: SecretsService,
  ): ProjectService => new ProjectService(loggerModule.logger, orchestrator, daemonStateStore, { secrets }),
};
