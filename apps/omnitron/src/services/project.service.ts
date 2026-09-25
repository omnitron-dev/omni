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
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
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
import type { InfrastructureConfig, PostgresDatabaseConfig } from '../infrastructure/types.js';
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
  type DeployTarget,
  type DeployProgressRecord,
} from './remote-deployer.service.js';
import { withNodeLeases } from './node-deploy-lease.js';
import type { LoadedRelease } from '../release/load.js';
import type { SyncService } from './sync.service.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import { ExecutionService, type SSHTarget } from '../execution/execution.service.js';



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

/**
 * The infrastructure a stack actually gets: the ecosystem's, plus its own.
 *
 * Shallow for the top-level keys — a stack that declares `postgres` replaces
 * the ecosystem's — and merged for `services`, because those are named
 * things and a stack adding one must not remove the rest.
 */
export function mergeInfrastructure(
  ecosystemConfig: { infrastructure?: InfrastructureConfig | undefined },
  stackConfig: { infrastructure?: Partial<InfrastructureConfig> | undefined },
): InfrastructureConfig | undefined {
  if (!stackConfig.infrastructure && !ecosystemConfig.infrastructure) return undefined;

  return {
    ...ecosystemConfig.infrastructure,
    ...stackConfig.infrastructure,
    services: {
      ...ecosystemConfig.infrastructure?.services,
      ...stackConfig.infrastructure?.services,
    },
  } as InfrastructureConfig;
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
   * deployment of `daos/test` in twenty-four hours; the daemon log knew about
   * eight. The seven it missed were the boot resume and the reconciler, both
   * of which call `startStack` directly — so the trail recorded the
   * deployments a human typed and none of the ones the daemon decided on,
   * which is the wrong half to have.
   */
  readonly audit?: import('./audit.service.js').AuditService;
}

export class ProjectService extends EventEmitter {
  private readonly registry: ProjectRegistry;
  private readonly configRegistry = new Map<string, LoadedProject>();
  private readonly stackStates = new Map<string, StackRuntimeState>();
  private readonly infraManager: StackInfrastructureManager;
  private slaveConnector: SlaveConnector | null = null;
  private readonly deployer: RemoteDeployer;
  // Enabled-stacks reconciler state (see startEnabledStacksReconciler)
  private resumeTimer: NodeJS.Timeout | null = null;
  private readonly resumeBackoff = new Map<string, { nextAt: number; delayMs: number }>();
  private dockerWasAvailable: boolean | null = null;

  private readonly syncService: SyncService | undefined;
  private readonly secrets: import('./secrets.service.js').SecretsService | undefined;
  private readonly audit: import('./audit.service.js').AuditService | undefined;

  constructor(
    private readonly logger: ILogger,
    private readonly orchestrator: OrchestratorService,
    daemonStateStore: import('../daemon/daemon-state-store.service.js').DaemonStateStore,
    /**
     * What a master has and a slave does not — by NAME. These were four more
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
    this.audit = options.audit;
    // T-7 — registry persistence routed through DaemonStateStore
    // (SQLite, transactional, co-located with daemon-state-kv,
    // pid-lock, etc.). The registry itself is unchanged in API;
    // only its backing storage moved.
    this.registry = new ProjectRegistry(daemonStateStore);
    this.infraManager = new StackInfrastructureManager(logger);
    // The deployer reaches nodes through the same SSH implementation as the
    // health checks, which is the only one that can present a password or a
    // key passphrase — see the note at the top of `remote-deployer.service.ts`.
    this.deployer = new RemoteDeployer(logger, new ExecutionService(logger));
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
  setNodeCredentialResolver(resolve: (host: string) => Promise<SSHTarget | null>): void {
    this.resolveNodeCredentials = resolve;
  }

  private resolveNodeCredentials: ((host: string) => Promise<SSHTarget | null>) | null = null;

  /** A deploy target for a stack node, with the registry filling the gaps. */
  private async targetForStackNode(node: import('../config/types.js').IStackNode): Promise<DeployTarget> {
    const declared = stackNodeToDeployTarget(node);
    if (!this.resolveNodeCredentials) return declared;
    const registered = await this.resolveNodeCredentials(node.host).catch(() => null);
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
  getDeployProgress(): DeployProgressRecord[] {
    return this.deployer.getProgress();
  }

  listProjects(): IProjectInfo[] {
    return this.registry.list().map((p) => this.toProjectInfo(p));
  }

  getProject(name: string): IProjectInfo {
    const project = this.registry.get(name);
    if (!project) throw new Error(`Project '${name}' not found`);
    return this.toProjectInfo(project);
  }

  async addProject(name: string, projectPath: string): Promise<IProjectInfo & { reread?: { redefined: number } }> {
    // Already registered AT THIS PATH: read it again rather than refuse.
    //
    // A deployment registers a node's project after writing its config, on
    // every deployment. The node answered «Project 'daos' already registered»
    // to every one after the first (four in two days, measured), the
    // deployer's SSH step failed on the exit code, and the node never read
    // the config it had just been given — a redeployment that changed an
    // app's environment restarted the app on the old one (paysys on
    // daos/test, pointed at the chain's previous address, 2026-09-23). A
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
  async rereadProject(name: string): Promise<number> {
    this.configRegistry.delete(name);
    const config = await this.loadProjectConfig(name);
    const stacks = this.resolveStacks(config, name);

    let redefined = 0;
    for (const [key, state] of this.stackStates) {
      if (!key.startsWith(`${name}/`) || state.status === 'stopped' || state.status === 'error') continue;
      const stackConfig = stacks[state.stack];
      // A remote stack's apps run on its nodes; they are redefined there.
      if (!stackConfig || stackConfig.type !== 'local') continue;
      const definitions = await this.loadAppDefinitions(name, stackConfig, config);
      const entries = this.resolveStackApps(stackConfig, config);
      const stackEnv = await this.stackEnvFor(name, state.stack, stackConfig, entries.map((e) => e.name));
      const build = this.stackEntryBuilder(name, state.stack, stackConfig, config, definitions, stackEnv);
      for (const entry of entries) {
        const built = build(entry);
        if (this.orchestrator.redefineApp(built.name, built)) redefined += 1;
      }
    }

    this.logger.info(
      { project: name, redefined },
      'Project read again — running apps take the new definition on their next start',
    );
    this.emit('project:updated', name, {});
    return redefined;
  }

  updateProject(name: string, data: { path?: string }): IProjectInfo {
    const project = this.registry.get(name);
    if (!project) throw new Error(`Project '${name}' not found`);

    if (data.path) {
      // Invalidate cached config so next access reloads from new path
      this.configRegistry.delete(name);
      const updated = this.registry.updatePath(name, data.path);

      // Registry may have renamed the project (basename of new path)
      if (updated.name !== name) {
        this.configRegistry.delete(updated.name);
        this.logger.info({ oldName: name, newName: updated.name, path: data.path }, 'Project renamed and path updated');
        this.emit('project:renamed', name, updated.name);
      } else {
        this.logger.info({ project: name, path: data.path }, 'Project path updated');
      }
      this.emit('project:updated', updated.name, data);
      return this.toProjectInfo(updated);
    }

    return this.toProjectInfo(project);
  }

  removeProject(name: string): void {
    // Stop all running stacks for this project first
    const runningStacks = this.getRunningStacks(name);
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

    if (allStacks[input.name]) {
      throw new Error(`Stack '${input.name}' already exists`);
    }

    // Build stack config
    const stackConfig: IStackConfig = {
      type: input.type,
      apps: input.apps,
      ...(input.nodeIds && input.type !== 'local' && {
        nodes: input.nodeIds.map((id) => ({ host: id, role: 'app' as const })),
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
          const { createDefaultRegistry } = await import('../infrastructure/presets/index.js');
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

  private loadUserStacks(project: string): Record<string, IStackConfig> {
    const filePath = this.getUserStacksPath(project);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as Record<string, IStackConfig>;
    } catch {
      return {};
    }
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
   * `omnitron stack start daos test` landed within twenty seconds of each
   * other, and ran the whole remote deployment TWICE, concurrently.
   *
   * That is not merely wasteful. The artifact build rebuilds shared packages
   * whose `build` script is `rm -rf dist && tsc`, so one pass emptied
   * `@omnitron-dev/titan-database/dist` while the other compiled `@daos/main`
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
  private readonly startsInFlight = new Map<string, Promise<IStackInfo>>();

  async startStack(
    projectName: string,
    stackName: string,
    opts?: { source?: StackStartSource; allowDirty?: boolean; release?: string; reinstall?: boolean },
  ): Promise<IStackInfo> {
    const inFlightKey = `${projectName}/${stackName}`;
    const running = this.startsInFlight.get(inFlightKey);
    if (running) {
      this.logger.info(
        { project: projectName, stack: stackName },
        'This stack is already being started — joining the run in progress',
      );
      return running;
    }

    const started = this.startStackOnce(
      projectName,
      stackName,
      opts?.source ?? 'unknown',
      opts?.allowDirty === true,
      opts?.release,
      opts?.reinstall === true,
    ).finally(() => {
      this.startsInFlight.delete(inFlightKey);
    });
    this.startsInFlight.set(inFlightKey, started);
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
   * (15:12:41), «daos/test takes releases only» (15:32:43), and the
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
  ): Promise<IStackInfo> {
    const known: StackStartKnown = { attach: false };
    try {
      return await this.runStackStart(projectName, stackName, source, allowDirty, releaseId, known, reinstall);
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
            ...(releaseId ? { release: releaseId } : {}),
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
  ): Promise<IStackInfo> {
    const config = await this.loadProjectConfig(projectName);
    const stacks = this.resolveStacks(config, projectName);
    const stackConfig = stacks[stackName];
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found in project '${projectName}'`);
    known.type = stackConfig.type;

    // A restart of this daemon re-attaches a remote stack; it never deploys
    // one. See `attachRemoteStack`.
    if (stackConfig.type !== 'local' && (source === 'boot' || source === 'auto-resume')) {
      known.attach = true;
      return this.attachRemoteStack(projectName, stackName, stackConfig, source);
    }

    // A release, when one is named — and a stack that takes nothing else.
    let release: LoadedRelease | null = null;
    if (releaseId) {
      release = await this.admitRelease(projectName, stackName, stackConfig, config, releaseId);
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
    if (stackConfig.type === 'remote' && !release) {
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

    const stateKey = `${projectName}/${stackName}`;
    const existing = this.stackStates.get(stateKey);
    // Not for a release: putting a release onto a running stack is the point.
    if (existing?.status === 'running' && !release) {
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
      // `down: [main, storage, priceverse, paysys, messaging, geo]` against
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
      if (down.length === 0) {
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
      if (stackConfig.type === 'local') {
        await this.startLocalStack(projectName, stackName, stackConfig, config);
      } else if (stackConfig.type === 'remote') {
        reach = await this.startRemoteStack(projectName, stackName, stackConfig, config, release, reinstall);
      } else if (stackConfig.type === 'cluster') {
        await this.startClusterStack(projectName, stackName, stackConfig, config);
      }

      state.status = 'running';
      state.startedAt = Date.now();

      // Update registry with enabled stack
      this.updateEnabledStacks(projectName, stackName, true);

      this.emit('stack:started', projectName, stackName, stackConfig.type);
      this.logger.info({ project: projectName, stack: stackName, source }, 'Stack started');

      const info = this.toStackInfo(projectName, stackName, stackConfig);
      // What did not come up, said in the row. A boot at 12:14 UTC on
      // 2026-09-23 started daos/dev with paysys and messaging errored and
      // recorded `outcome: ok, apps: 6`: the stack «started», two of its six
      // apps never did. For a local stack the apps are this daemon's; for a
      // remote one, what did not happen is a node that was skipped.
      const notUp =
        stackConfig.type === 'local'
          ? info.apps.filter((a) => a.status !== 'online').map((a) => `${a.name} (${a.status})`)
          : [
              ...(reach?.skipped ?? []).map((n) => `node ${typeof n === 'string' ? n : JSON.stringify(n)}`),
              ...(reach?.notReady ?? []).map((n) => `infrastructure on ${n}`),
            ];
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
        outcome: notUp.length > 0 ? 'partial' : 'ok',
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

  async stopStack(projectName: string, stackName: string): Promise<IStackInfo> {
    const stateKey = `${projectName}/${stackName}`;
    const state = this.stackStates.get(stateKey);

    if (!state || state.status === 'stopped') {
      const config = this.getLoadedConfig(projectName);
      const stacks = config ? this.resolveStacks(config, projectName) : {};
      const stackConfig = stacks[stackName];
      if (!stackConfig) throw new Error(`Stack '${stackName}' not found`);
      return this.toStackInfo(projectName, stackName, stackConfig);
    }

    this.logger.info({ project: projectName, stack: stackName }, 'Stopping stack');
    state.status = 'stopping';
    this.emit('stack:stopping', projectName, stackName);

    try {
      // Stop all apps with this stack's namespace prefix (reverse order for graceful shutdown)
      const prefix = `${projectName}/${stackName}/`;
      const handleNames = this.orchestrator.listHandleNames(prefix);
      for (const name of handleNames.reverse()) {
        try {
          await this.orchestrator.stopApp(name);
        } catch (err) {
          this.logger.warn(
            { app: name, error: (err as Error).message },
            'Failed to stop app during stack shutdown'
          );
        }
      }

      // Disconnect slave daemons for remote/cluster stacks
      if (state.config.type !== 'local' && this.slaveConnector) {
        for (const node of state.config.nodes ?? []) {
          await this.slaveConnector.removeSlave(node.host, node.port ?? 9700);
        }
      }

      // Teardown per-stack infrastructure (namespaced containers)
      await this.infraManager.teardownStack(projectName, stackName);

      state.status = 'stopped';
      state.startedAt = null;

      this.updateEnabledStacks(projectName, stackName, false);
      this.emit('stack:stopped', projectName, stackName, 'manual');
      this.logger.info({ project: projectName, stack: stackName }, 'Stack stopped');

      return this.toStackInfo(projectName, stackName, state.config);
    } catch (err) {
      state.status = 'error';
      throw err;
    }
  }

  /**
   * What is running in this stack, asked of whoever is running it.
   *
   * For a remote stack that is the node. This counted `this.orchestrator
   * .list()` — the MASTER's process table — which lists none of a remote
   * stack's applications, so `stack runtime daos test` answered
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

    const prefix = `${projectName}/${stackName}/`;
    // Match by namespaced prefix OR by bare-name when the bare entry's
    // effective name is part of this stack's configured app set. See
    // toStackInfo for the full rationale; we keep the same rule here so
    // CLI `omnitron list` and the webapp's stack status agree.
    const configForStatus = this.getLoadedConfig(projectName);
    const configuredNames = configForStatus
      ? new Set(this.resolveStackApps(stackConfig, configForStatus).map((a) => a.name))
      : new Set<string>();
    const apps = this.orchestrator.list().filter((a) => {
      if (a.name.startsWith(prefix)) return true;
      if (a.name.includes('/')) return false;
      return configuredNames.has(effectiveAppName(a.name));
    });
    const onlineApps = apps.filter((a) => a.status === 'online');

    // Derive status from app health if running
    let status: StackStatus = state?.status ?? 'stopped';
    if (status === 'running' && apps.length > 0 && onlineApps.length < apps.length) {
      status = 'degraded';
    }

    const base: StackRuntime = {
      name: stackName,
      type: stackConfig.type,
      status,
      totalApps: apps.length,
      onlineApps: onlineApps.length,
      totalNodes: stackConfig.nodes?.length ?? 1,
      connectedNodes: stackConfig.type === 'local' ? 1 : 0,
      totalCpu: apps.reduce((sum, a) => sum + a.cpu, 0),
      totalMemory: apps.reduce((sum, a) => sum + a.memory, 0),
      syncSummary: (stackConfig.type === 'remote' || stackConfig.type === 'cluster')
        ? summariseSync(this.nodesWithSync(stackConfig))
        : null,
    };

    if (stackConfig.type === 'local') return base;

    // The node is asked, and what it answers replaces every count that was
    // taken from this machine. `connectedNodes` is the number of nodes that
    // ANSWERED rather than the number of entries in the connector's
    // registry: that registry reported 0 connections for a node that was
    // answering RPCs in the same second.
    const { info, answered } = await this.askNodes(
      projectName,
      this.getStack(projectName, stackName),
    );
    const remote = info.apps;
    const up = remote.filter((a) => a.status === 'online');
    return {
      ...base,
      status: info.status,
      totalApps: remote.length,
      onlineApps: up.length,
      connectedNodes: answered,
      totalCpu: remote.reduce((sum, a) => sum + (a.cpu ?? 0), 0),
      totalMemory: remote.reduce((sum, a) => sum + (a.memory ?? 0), 0),
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
  ): Promise<{ ok: boolean; because: string }> {
    try {
      const config = await this.loadProjectConfig(projectName);
      const stacks = this.resolveStacks(config, projectName);
      const stackConfig = stacks[stackName];
      if (!stackConfig) throw new Error(`Stack '${stackName}' not found in project '${projectName}'`);
      const release = await this.admitRelease(projectName, stackName, stackConfig, config, releaseId, 'check');
      const gates = release.manifest.gates;
      const passed = gates.filter((g) => g.status === 'passed').length;
      return {
        ok: true,
        because:
          `${projectName}/${stackName} would take ${release.id}: ${passed} of ${gates.length} gates passed, ` +
          `${release.files.length} artifact(s) match the manifest` +
          `${release.staticsDir ? `, static bundle built for ${release.manifest.statics?.stack}` : ''}.`,
      };
    } catch (err) {
      return { ok: false, because: (err as Error).message };
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
    // paysys accounts with their deposit addresses (on daos/test, 2026-09-24:
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
            attestationCommand({ remoteDir, stack: stackName, releaseId, containerPrefix, provision: accounts === 'provisioned' }),
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
          tool.operatorAccountCommand({
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
            await on.run((remoteDir, containerPrefix) => tool.operatorAccountShowCommand({ remoteDir, containerPrefix, username }), 60_000),
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
              tool.operatorAccountRemoveCommand({ remoteDir, containerPrefix, username, id: account.id }),
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
            (remoteDir, containerPrefix) => tool.probeLeftoversCommand({ remoteDir, containerPrefix, mode, also: request.also }),
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
        await on.run((remoteDir, containerPrefix) => tool.operatorCensusCommand({ remoteDir, containerPrefix }), 180_000),
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
        await on.run((remoteDir, containerPrefix) => tool.operatorAccountShowCommand({ remoteDir, containerPrefix, username: name }), 60_000),
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
        await on.run((remoteDir, containerPrefix) => tool.operatorAccountRemoveCommand({ remoteDir, containerPrefix, username, id }), 120_000),
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
  ): Promise<string[]> {
    const { definitionInputs } = await import('../release/definition-inputs.js');
    const { shippedDirsOf } = await import('../infrastructure/shipped-config.js');
    const shipped = shippedDirsOf(
      mergeInfrastructure(config, stackConfig),
      await this.collectDeclaredServices(projectName, stackConfig, config),
    );
    return definitionInputs(
      root,
      this.resolveStackApps(stackConfig, config).flatMap((a) => (a.bootstrap ? [a.bootstrap] : [])),
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
  ): Promise<LoadedRelease> {
    if (stackConfig.type === 'local') {
      throw new Error(`A release is for a remote stack — ${projectName}/${stackName} is local and runs its working tree.`);
    }
    const { loadRelease, treeEqualsCommit } = await import('../release/load.js');
    const { decideStackRelease } = await import('../release/manifest.js');
    const release = await loadRelease(releaseId, await this.releaseStore());

    const apps = this.resolveStackApps(stackConfig, config).map((a) => a.name);
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
      let ran: Readonly<Record<string, string>> | undefined;
      try {
        ran = (await loadRelease(running, await this.releaseStore())).manifest.migrations;
      } catch (err) {
        this.logger.warn(
          { project: projectName, stack: stackName, running, error: (err as Error).message },
          'The release running on this stack could not be read — its migrations are not compared',
        );
      }
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
    // Only what the definition reads has to be the release's — see
    // `release/definition-inputs.ts`. The rest of the checkout is other
    // people's work in progress, which no deployment reads. When the files
    // cannot be named, the whole tree is compared, as before.
    const root = fs.realpathSync(project.path);
    let inputs: string[] | undefined;
    try {
      inputs = await this.deploymentReads(projectName, stackConfig, config, root);
    } catch (err) {
      this.logger.warn(
        { project: projectName, stack: stackName, error: (err as Error).message },
        'Could not name the files the definition reads — the whole working tree has to be the release\'s commit',
      );
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

    const infra = mergeInfrastructure(config, stackConfig) as
      | { gateway?: { staticDir?: string }; services?: Record<string, { config?: { staticDir?: string } }> }
      | undefined;
    const servesStatics = Boolean(infra?.services?.['gateway']?.config?.staticDir ?? infra?.gateway?.staticDir);
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
    return release;
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
      void this.reconcileEnabledStacks().catch((err) => {
        this.logger.warn({ error: (err as Error).message }, 'Enabled-stacks reconciler tick failed');
      });
    }, intervalMs);
    this.resumeTimer.unref();
    this.logger.info({ intervalMs }, 'Enabled-stacks reconciler started');
  }

  private async reconcileEnabledStacks(): Promise<void> {
    // Collect the divergence set first — cheap, no I/O.
    const pending: Array<{ project: string; stack: string }> = [];
    for (const project of this.registry.list()) {
      for (const stackName of project.enabledStacks ?? []) {
        const state = this.stackStates.get(`${project.name}/${stackName}`);
        const status = state?.status;
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

    // One cheap probe gates the whole round: without Docker every start is
    // guaranteed to fail, so don't burn backoff budget on it.
    const { isDockerAvailable } = await import('../infrastructure/container-runtime.js');
    if (!(await isDockerAvailable())) {
      if (this.dockerWasAvailable !== false) {
        this.logger.warn(
          { pending: pending.map((p) => `${p.project}/${p.stack}`) },
          'Reconciler: Docker unavailable — deferring enabled-stack resume',
        );
      }
      this.dockerWasAvailable = false;
      return;
    }
    this.dockerWasAvailable = true;

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
        await this.startStack(project, stack, { source: 'auto-resume' });
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
    await this.infraManager.teardownAll();
  }

  // ===========================================================================
  // Config Management
  // ===========================================================================

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
   * at 12:07:48 UTC, 20 ERROR lines «Project 'daos' config not loaded» from
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

  async reloadConfig(projectName?: string): Promise<void> {
    if (projectName) {
      await this.loadProjectConfig(projectName);
      this.emit('project:config_reloaded', projectName);
    } else {
      for (const project of this.registry.list()) {
        await this.loadProjectConfig(project.name);
        this.emit('project:config_reloaded', project.name);
      }
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  getRunningStacks(projectName: string): string[] {
    const result: string[] = [];
    for (const [, state] of this.stackStates) {
      if (state.project === projectName && (state.status === 'running' || state.status === 'starting')) {
        result.push(state.stack);
      }
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
            migrate: true,
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
    const config = await this.loadProjectConfig(projectName);
    const stacks = this.resolveStacks(config, projectName);
    const stackConfig = stacks[stackName];

    if (!stackConfig) {
      return { valid: false, issues: [`Stack '${stackName}' not found`] };
    }

    const project = this.registry.get(projectName);
    if (!project) {
      return { valid: false, issues: [`Project '${projectName}' not found`] };
    }

    // Determine effective infrastructure: stack-level overrides ecosystem-level
    const effectiveInfra = stackConfig.infrastructure ?? config.infrastructure;
    const issues: string[] = [];

    // Scan app requirements
    const { scanRequirements } = await import('../project/requirements-scanner.js');
    const appEntries = this.resolveStackApps(stackConfig, config);
    const reqs = await scanRequirements(appEntries, project.path);

    // Check PostgreSQL
    if (reqs.databases.length > 0 && !effectiveInfra?.postgres) {
      issues.push(
        `PostgreSQL required by ${reqs.databases.map((d) => d.app).join(', ')} but not configured in infrastructure`
      );
    } else if (reqs.databases.length > 0 && effectiveInfra?.postgres) {
      // Check individual databases exist in config
      const configuredDbs = new Set(Object.keys(effectiveInfra.postgres.databases ?? {}));
      for (const db of reqs.databases) {
        if (!configuredDbs.has(db.database)) {
          issues.push(`Database '${db.database}' needed by '${db.app}' not found in postgres.databases`);
        }
      }
    }

    // Check Redis
    if (reqs.redis.appCount > 0 && !effectiveInfra?.redis) {
      issues.push(
        `Redis required by ${reqs.redis.allocations.map((a) => a.app).join(', ')} but not configured in infrastructure`
      );
    }

    // Check S3/MinIO
    if (reqs.buckets.length > 0 && !effectiveInfra?.minio) {
      issues.push(
        `S3/MinIO required by ${reqs.buckets.map((b) => b.app).join(', ')} but not configured in infrastructure`
      );
    } else if (reqs.buckets.length > 0 && effectiveInfra?.minio) {
      const configuredBuckets = new Set(effectiveInfra.minio.buckets ?? []);
      for (const b of reqs.buckets) {
        if (configuredBuckets.size > 0 && !configuredBuckets.has(b.bucket)) {
          issues.push(`Bucket '${b.bucket}' needed by '${b.app}' not found in minio.buckets`);
        }
      }
    }

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
  ): Promise<void> {
    const stateKey = `${projectName}/${stackName}`;
    const state = this.stackStates.get(stateKey)!;

    // 0. Validate infrastructure covers app requirements (warn only, don't block)
    try {
      const validation = await this.validateStackInfrastructure(projectName, stackName);
      if (!validation.valid) {
        for (const issue of validation.issues) {
          this.logger.warn({ project: projectName, stack: stackName, issue }, 'Infrastructure validation issue');
        }
      }
    } catch {
      // Validation is best-effort — don't block stack start
    }

    // 1. Load bootstrap definitions (needed for both infra provisioning and config resolution)
    const appEntries = this.resolveStackApps(stackConfig, ecosystemConfig);
    // What the stack gives its apps, vault references resolved — now, before
    // anything is provisioned: a key the vault does not hold refuses the
    // start here (project/stack-env.ts).
    const stackEnv = await this.stackEnvFor(projectName, stackName, stackConfig, appEntries.map((e) => e.name));
    const project = this.registry.get(projectName);
    const appDefinitions = await this.loadAppDefinitions(projectName, stackConfig, ecosystemConfig);

    // 2. Provision per-stack infrastructure (built-in + app-declared services)
    //    Auto-detect core services (postgres, redis, minio) from app requirements,
    //    then merge with explicit infrastructure config (gateway, custom services).
    // Merge stack-level + ecosystem-level infrastructure (stack overrides ecosystem, but both contribute)
    let effectiveInfra = mergeInfrastructure(ecosystemConfig, stackConfig);

    if (project) {
      try {
        const { scanRequirements, buildInfraFromRequirements } = await import('../project/requirements-scanner.js');
        const reqs = await scanRequirements(appEntries, project.path);
        const autoInfra = buildInfraFromRequirements(reqs);

        if (Object.keys(autoInfra).length > 0) {
          const explicitServices = effectiveInfra?.services ?? {};
          this.logger.info(
            { explicitServiceKeys: Object.keys(explicitServices), hasEffective: !!effectiveInfra },
            'Pre-merge: explicit services from config'
          );
          // Merge: auto-detected core services + explicit config (gateway, custom services)
          effectiveInfra = {
            ...autoInfra,
            ...effectiveInfra,
            services: { ...explicitServices },
          };
          this.logger.info(
            { project: projectName, stack: stackName, auto: Object.keys(autoInfra), explicit: Object.keys(effectiveInfra.services ?? {}) },
            'Merged auto-detected + explicit infrastructure'
          );
        }
      } catch (err) {
        this.logger.warn(
          { error: (err as Error).message },
          'Failed to auto-detect infrastructure requirements'
        );
      }
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
        // Edge case: stacks that intentionally talk to *external* infra and
        // declare nothing in their `infrastructure` section never reach this
        // branch (`effectiveInfra` is falsy). For deliberate degraded-mode
        // operation the stack settings can opt in via
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

        this.logger.warn(
          { project: projectName, stack: stackName },
          'allowDegradedInfra=true — proceeding with app start despite infra failure'
        );
      }
    }

    // 2b. Run database migrations for apps that have migrate: true
    if (effectiveInfra && project) {
      await this.runStackMigrations(projectName, stackName, effectiveInfra as InfrastructureConfig, appEntries, project.path);
    }

    // 3. How each app is started: its entry, built from the stack's resolved
    //    configuration (`stackEntryBuilder` — the same builder a re-read of
    //    the project uses to redefine running apps).
    const appConfigBuilder = this.stackEntryBuilder(projectName, stackName, stackConfig, ecosystemConfig, appDefinitions, stackEnv);

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
    const failed = new Set<string>();
    const blocked = new Set<string>();

    for (const wave of resolveStartupOrder(appEntries)) {
      await Promise.all(
        wave.map(async (entry) => {
          const blockingDep = (entry.dependsOn ?? []).find((d) => failed.has(d) || blocked.has(d));
          if (blockingDep) {
            blocked.add(entry.name);
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
            failed.add(entry.name);
            this.logger.error(
              { app: entry.name, project: projectName, stack: stackName, error: (err as Error).message },
              'Failed to start app in stack',
            );
          }
        }),
      );
    }

    if (failed.size > 0 || blocked.size > 0) {
      this.logger.warn(
        { project: projectName, stack: stackName, failed: [...failed], blocked: [...blocked] },
        'Stack startup finished with failures — some apps did not launch',
      );
    }
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
    release: LoadedRelease | null = null,
    reinstall = false,
  ): Promise<NodeReach> {
    const phases = reportPhases(this.logger, { project: projectName, stack: stackName });
    try {
      return await this.deployRemoteStack(projectName, stackName, stackConfig, ecosystemConfig, phases, release, reinstall);
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
    release: LoadedRelease | null = null,
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
    const declaredServices = await this.collectDeclaredServices(projectName, stackConfig, ecosystemConfig);

    // Build artifacts for apps in this stack
    const appEntries = this.resolveStackApps(stackConfig, ecosystemConfig);
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
    return withNodeLeases(
      [...targets].map(([node, target]) => ({
        node,
        machine: `${target.host}:${target.sshPort ?? 22}`,
        run: this.deployer.leaseRunner(target),
      })),
      `${projectName}/${stackName}`,
      this.logger,
      async (leases) => {
        // Deploy to each node: provision slave → deploy artifacts → connect
        for (const node of nodes) {
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
          const unsubProvision = this.deployer.onProgress((progress) => {
            this.emit('stack:deploy_progress', projectName, stackName, progress);
          });
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
          phases.enter(`provisioning ${node.host}`);
          const provisioned = await this.deployer.provisionSlaveNode(
            target,
            master.host,
            masterPort,
            projectName,
          );
          unsubProvision();

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
          const nodeCredentials = await this.readNodeCredentials(connector, node);
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
          // complete set of containers under `daos-deployed-*` on empty volumes,
          // and swept the master's `daos-test-*` as orphans. An address is not an
          // instruction to build what it points at.
          phases.enter(`resolving the environment for ${node.host}`);
          const appEnv = await this.resolveNodeAppEnv(
            ecosystemConfig,
            projectName,
            stackConfig,
            appEntries,
            deployedInfra as import('../infrastructure/types.js').InfrastructureConfig | undefined,
          );
          // The stack's own, over the computed — as on a local stack, where
          // `settings.env` wins over both.
          for (const [app, env] of Object.entries(stackEnv)) appEnv[app] = { ...(appEnv[app] ?? {}), ...env };

          // 3. Deploy app artifacts via SSH
          if (artifacts.length > 0) {
            const unsubDeploy = this.deployer.onProgress((progress) => {
              this.emit('stack:deploy_progress', projectName, stackName, progress);
            });
            // The definitions travel with the artifacts. A node that receives
            // one without the other has files it cannot run, and says so only if
            // someone asks it directly.
            await leases.confirm(nodeKey, `delivering ${artifacts.length} artifact(s) to ${node.host}`);
            phases.enter(`delivering ${artifacts.length} artifact(s) to ${node.host}`);
            const results = await this.deployer.deployToStack([target], artifacts, projectName, {
              apps: appEntries,
              appEnv,
              stack: stackName,
              // Past the node's record of what each app runs: ship and restart all.
              ...(reinstall ? { force: true } : {}),
            });
            unsubDeploy();
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
      },
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
      const definitions = await this.loadAppDefinitions(projectName, stackConfig, ecosystemConfig);

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
        'Could not resolve what the deployed apps connect to — they will start with their declared env only',
      );
      return {};
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
  ): Promise<Record<string, Record<string, unknown>>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const service of ['postgres', 'redis', 'minio']) {
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
  ): Promise<Record<string, string>> {
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
    if (!staticDir) return {};

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
      const deliver = () => this.deployer.uploadStaticBundle(target, abs, '/opt/omnitron/stack-static/gateway');
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
      return { gateway: remoteDir };
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
      const staticRoots = projectRoot
        ? await this.shipStackStatics(infrastructure, projectRoot, node, releasedStatics)
        : {};

      // Retry once if the connection turns out to be gone: the deployer just
      // restarted this node's daemon, so the mesh connection the master holds
      // was established to the process that exited. `provisionStack` is a
      // reconciler, so applying it twice is applying it once.
      const report = (await connector.invokeOnSlave(
        host,
        port,
        'OmnitronInfra',
        'provisionStack',
        [{ config: configForNode, services: servicesForNode, ...(owner ?? {}), configFiles, staticRoots }],
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

  private async startClusterStack(
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
  ): Promise<void> {
    const nodes = stackConfig.nodes ?? [];
    if (nodes.length === 0) {
      throw new Error(`Cluster stack '${stackName}' has no nodes configured`);
    }

    this.logger.info(
      { project: projectName, stack: stackName, nodes: nodes.length },
      'Starting cluster stack — coordinating slave daemons'
    );

    const connector = this.getSlaveConnector();

    // Build artifacts
    const appEntries = this.resolveStackApps(stackConfig, ecosystemConfig);
    const project = this.registry.get(projectName);
    let artifacts: import('../project/artifact-builder.js').ArtifactInfo[] = [];

    if (project) {
      try {
        const { ArtifactBuilder } = await import('../project/artifact-builder.js');
        const builder = new ArtifactBuilder(project.path, undefined, {
          info: (msg) => this.logger.info({ project: project.name }, msg),
        });
        const outcome = await builder.buildAll(appEntries);
        artifacts = outcome.built;
        for (const f of outcome.failed) {
          this.logger.error({ app: f.app, error: f.error }, 'Artifact build failed');
        }
      } catch (err) {
        this.logger.error({ error: (err as Error).message }, 'Artifact build failed');
      }
    }

    // Resolve master address (from the SLAVE's perspective — what it dials)
    const { DEFAULT_DAEMON_CONFIG: _dc } = await import('../config/defaults.js');
    const { resolveMasterHost } = await import('./master-address.js');
    const masterPort = _dc.port;

    // Provision all slave nodes in parallel (install runtime + omnitron + config)
    const appNodes = nodes.filter((n) => n.role !== 'database' && n.role !== 'cache');
    // One writer per machine, as for a remote stack — see `deployRemoteStack`
    // and `node-deploy-lease.ts`.
    const targets = new Map<string, DeployTarget>();
    for (const node of appNodes) {
      targets.set(`${node.host}:${node.port ?? 9700}`, await this.targetForStackNode(node));
    }
    await withNodeLeases(
      [...targets].map(([node, target]) => ({
        node,
        machine: `${target.host}:${target.sshPort ?? 22}`,
        run: this.deployer.leaseRunner(target),
      })),
      `${projectName}/${stackName}`,
      this.logger,
      async (leases) => {
        const leased = appNodes.filter((n) => leases.has(`${n.host}:${n.port ?? 9700}`));
        for (const [node, because] of leases.unreachable) {
          this.logger.error({ node, because }, 'Could not reach this node to lease it — skipping');
        }
        for (const node of leased) {
          const nodeKey = `${node.host}:${node.port ?? 9700}`;
          const unsubProvision = this.deployer.onProgress((progress) => {
            this.emit('stack:deploy_progress', projectName, stackName, progress);
          });
          const target = targets.get(nodeKey)!;
          const master = await resolveMasterHost(
            { advertiseHost: _dc.advertiseHost, bindHost: _dc.host },
            target,
          );
          this.logger.info(
            { node: node.host, masterHost: master.host ?? '(none — this node is pulled from)', from: master.source },
            'Resolved the master address this slave will dial',
          );
          await leases.confirm(nodeKey, `provisioning ${node.host}`);
          await this.deployer.provisionSlaveNode(target, master.host, masterPort, projectName);
          unsubProvision();
        }

        // Deploy app artifacts to all provisioned nodes
        if (artifacts.length > 0 && leased.length > 0) {
          for (const node of leased) {
            await leases.confirm(`${node.host}:${node.port ?? 9700}`, `delivering to ${node.host}`);
          }
          const unsubDeploy = this.deployer.onProgress((progress) => {
            this.emit('stack:deploy_progress', projectName, stackName, progress);
          });
          const results = await this.deployer.deployToStack(
            leased.map((n) => targets.get(`${n.host}:${n.port ?? 9700}`)!),
            artifacts,
            projectName,
            // Same on the cluster path: artifacts without definitions are files a
            // node cannot run.
            { concurrency: 5, apps: appEntries },
          );
          unsubDeploy();
          const successful = results.filter((r) => r.status === 'success').length;
          const failed = results.filter((r) => r.status === 'failed').length;
          this.logger.info(
            { successful, failed, total: results.length },
            'Cluster deployment complete'
          );
        }
      },
    );

    // Connect to all slave daemons
    for (const node of nodes) {
      await connector.addSlave({
        host: node.host,
        port: node.port ?? 9700,
        label: node.label,
        stack: stackName,
        project: projectName,
      });
    }
  }

  // ===========================================================================
  // Private — Utilities
  // ===========================================================================

  /**
   * Run database migrations for apps that declare migrate: true in their
   * stack infrastructure config. Migrations are executed after databases are
   * created but before apps are started, so apps always see a current schema.
   *
   * Convention: each app's migration script is at `apps/{appName}/src/database/migrate.ts`.
   * The script reads DATABASE_URL or app-specific env vars and defaults to
   * localhost:{port}/{dbName} with postgres:postgres — matching the stack's provisioned postgres.
   */
  private async runStackMigrations(
    projectName: string,
    stackName: string,
    infraConfig: InfrastructureConfig,
    appEntries: { name: string }[],
    projectPath: string,
  ): Promise<void> {
    const pgConfig = infraConfig.postgres;
    if (!pgConfig?.databases) return;

    const appNames = new Set(appEntries.map((a) => a.name));
    const port = pgConfig.port ?? 5432;
    const user = pgConfig.user ?? 'postgres';
    const password = typeof pgConfig.password === 'string' ? pgConfig.password : 'postgres';

    // Wait for postgres to actually accept connections before running ANY
    // migrations. Containers can be reported "running" by Docker before
    // pg_isready would pass, especially right after a fresh provision. Without
    // this we hit ECONNREFUSED on the first migration and fail-fast bubbles
    // into the user's face.
    //
    // Three minutes, not one. A minute fits a container that already has its
    // data directory; it does not fit a cold one, which has to initdb and
    // install extensions before it listens — and on a loaded machine that is
    // several minutes. When the wait gives up the whole `stack start` aborts
    // and no app is started at all, so a deadline set for the warm case turns
    // a slow first boot into a stack that will not come up.
    await waitForPostgres('localhost', port, user, password, 180_000);

    for (const [dbName, dbConfig] of Object.entries(pgConfig.databases)) {
      // Only run if migrate flag is set AND a matching app exists
      if (!dbConfig || typeof dbConfig !== 'object' || !(dbConfig as any).migrate) continue;
      if (!appNames.has(dbName)) continue;

      const migrateScript = path.join(projectPath, 'apps', dbName, 'src', 'database', 'migrate.ts');
      try {
        await fs.promises.access(migrateScript);
      } catch {
        this.logger.debug(
          { app: dbName, script: migrateScript },
          'Migration script not found — skipping',
        );
        continue;
      }

      this.logger.info(
        { project: projectName, stack: stackName, database: dbName },
        'Running database migrations',
      );

      // Retry policy: up to 5 attempts with exponential backoff (1s, 2s, 4s, 8s, 16s).
      // Migration tools are typically idempotent, so retrying after a transient
      // ECONNREFUSED / role-creation race is safe.
      const maxAttempts = 5;
      let attempt = 0;
      let lastErr: Error | null = null;
      while (attempt < maxAttempts) {
        attempt++;
        try {
          // Asynchronously. This was `execFileSync`, and a synchronous spawn
          // holds the daemon's whole event loop for as long as the child runs
          // — no RPC answered, no heartbeat, no mesh — which the event-loop
          // watch caught at a master boot on 2026-09-23: six migrations back
          // to back, 1 539 / 871 / 727 / 941 / 740 / 782 ms, 5.6 s of a daemon
          // that answered nothing, on every restart. And with the retries
          // below, a migration that hangs held it up to 60 s per attempt.
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const running = promisify(execFile)(
            process.execPath,
            ['--import', 'tsx/esm', migrateScript],
            {
              cwd: path.join(projectPath, 'apps', dbName),
              env: {
                ...process.env,
                DATABASE_URL: `postgresql://${user}:${password}@localhost:${port}/${dbName}`,
                // App-specific env vars (various naming conventions)
                [`${dbName.toUpperCase()}__DATABASE__HOST`]: 'localhost',
                [`${dbName.toUpperCase()}__DATABASE__PORT`]: String(port),
                [`${dbName.toUpperCase()}__DATABASE__DATABASE`]: dbName,
                [`${dbName.toUpperCase()}__DATABASE__USER`]: user,
                [`${dbName.toUpperCase()}__DATABASE__PASSWORD`]: password,
              },
              timeout: 60_000,
              maxBuffer: 16 * 1024 * 1024,
            },
          );
          // Nothing to read from us, as `stdio: 'ignore'` said before.
          running.child.stdin?.end();
          await running;
          this.logger.info({ database: dbName, attempts: attempt }, 'Migrations applied');
          lastErr = null;
          break;
        } catch (err: any) {
          lastErr = err;
          const stderr = err.stderr?.toString?.()?.trim?.() ?? '';
          // Only retry on transient connection errors. Schema / SQL errors
          // are deterministic and won't go away by trying again.
          const transient = /ECONNREFUSED|ECONNRESET|ENOTCONN|terminat(ing|ed)|server closing|kysely.*Connection/i.test(stderr) ||
            /ECONNREFUSED|ECONNRESET/i.test(err.message ?? '');
          if (!transient || attempt >= maxAttempts) {
            this.logger.error(
              { database: dbName, attempt, error: err.message, stderr },
              'Migration failed — app may fail to start',
            );
            break;
          }
          const delayMs = Math.min(1000 * 2 ** (attempt - 1), 16_000);
          this.logger.warn(
            { database: dbName, attempt, nextRetryInMs: delayMs, error: err.message },
            'Migration transient failure — retrying',
          );
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      if (lastErr) {
        // Already logged above; intentionally do NOT throw here so other
        // databases can still attempt their migrations.
      }
    }
  }

  /**
   * Resolve stacks from config + user stacks.
   * User-created stacks (from omnitron.stacks.json) are merged with config stacks.
   * Config stacks take precedence over user stacks with the same name.
   * No implicit fallbacks — stacks must be created explicitly.
   */
  private resolveStacks(config: IEcosystemConfig, projectName?: string): Record<string, IStackConfig> {
    const configStacks = config.stacks ?? {};

    if (projectName) {
      const userStacks = this.loadUserStacks(projectName);
      return { ...userStacks, ...configStacks };
    }

    return configStacks;
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
    const resolvedStack = resolveStack(
      ecosystemConfig,
      projectName,
      stackName,
      stackConfig,
      appDefinitions,
      portAllocation ?? undefined,
      normalizedSvcs ?? undefined,
    );

    return (entry: IEcosystemAppEntry): IEcosystemAppEntry => {
      const appConfig = resolvedStack.appConfigs.get(entry.name);
      const infraEnv = appConfig ? resolvedConfigToEnv(appConfig, entry.name, stackName) : {};
      return {
        ...entry,
        name: ProjectService.handleKey(projectName, stackName, entry.name),
        ...(entry.bootstrap && project
          ? { bootstrap: path.resolve(project.path, entry.bootstrap) }
          : {}),
        ...(project ? { cwd: project.path } : {}),
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
  ): Promise<Map<string, IAppDefinition>> {
    const appDefinitions = new Map<string, IAppDefinition>();
    const appEntries = this.resolveStackApps(stackConfig, ecosystemConfig);
    const project = this.registry.get(projectName);

    for (const entry of appEntries) {
      if (entry.bootstrap && project) {
        try {
          const bootstrapAbsPath = path.resolve(project.path, entry.bootstrap);
          const { loadBootstrapConfig } = await import('../orchestrator/bootstrap-loader.js');
          const loaded = await loadBootstrapConfig(bootstrapAbsPath, { devMode: false });

          // The app's `config/default.json`, read now and put on a COPY of
          // the definition: the loaded one is the loader's cache entry, and
          // writing to it made the first read the only one until the daemon
          // restarted (`project/declared-config.ts`).
          const declared = readDeclaredConfig(bootstrapAbsPath);
          if (declared.malformed) {
            this.logger.error(
              { app: entry.name, configPath: declared.configPath, error: declared.malformed },
              'config/default.json does not parse — its `omnitron` section is being ignored'
            );
          }
          const definition = withDeclaredConfig(loaded, declared);

          appDefinitions.set(entry.name, definition);
        } catch (err) {
          // An app can start without its definition; a STACK cannot be
          // provisioned without it. The definition is where an application
          // declares what it needs — its database, its cache, its chain
          // daemon — so a swallowed failure here does not degrade the
          // deployment, it silently removes a whole category from it.
          //
          // Measured: a remote stack reported `declared by apps: (none)` and
          // provisioned no infrastructure, because every bootstrap import
          // had failed in a process that could not load TypeScript. Nothing
          // said so at any level.
          this.logger.warn(
            { app: entry.name, bootstrap: entry.bootstrap, error: (err as Error).message },
            'Could not load this app\'s definition — anything it declares it needs will not be provisioned',
          );
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
   * that disagrees with an earlier one is not merged silently — the first
   * wins and the disagreement is said, because two applications wanting
   * different versions of one service is a fact about the stack, not a
   * detail to resolve by ordering.
   */
  private async collectDeclaredServices(
    projectName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
    /** Keep the ones reached elsewhere too — to ask whether they answer, not to provision them. */
    options: { external?: boolean } = {},
  ): Promise<Record<string, import('../infrastructure/types.js').IServiceRequirement>> {
    const merged: Record<string, import('../infrastructure/types.js').IServiceRequirement> = {};
    const definitions = await this.loadAppDefinitions(projectName, stackConfig, ecosystemConfig);

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
          this.logger.debug(
            { service: name, app: appName },
            'Service already declared by another app in this stack — the first declaration stands',
          );
          continue;
        }
        merged[name] = requirement as import('../infrastructure/types.js').IServiceRequirement;
      }
    }

    return merged;
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

  private updateEnabledStacks(projectName: string, stackName: string, enabled: boolean): void {
    const project = this.registry.get(projectName);
    if (!project) return;

    const enabledStacks = new Set(project.enabledStacks ?? []);
    if (enabled) {
      enabledStacks.add(stackName);
    } else {
      enabledStacks.delete(stackName);
    }
    project.enabledStacks = [...enabledStacks];

    // Persist to disk via registry
    try {
      this.registry.persist();
    } catch {
      // Non-critical — runtime state is authoritative
    }
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
   *     Stack daos/test: only 0/6 apps came online.
   *     Not online: main (stopped), storage (stopped), priceverse (stopped),
   *     paysys (stopped), messaging (stopped), geo (stopped)
   *
   * measured against a node answering `appsTotal: 6, appsOnline: 6` with
   * every port listening, thirty seconds after this same master installed,
   * migrated and started them. The CLI exits 1 on that count, so a correct
   * deployment fails a script; and the console's stack page shows the same
   * six rows, stopped.
   *
   * A node that cannot be asked leaves its apps exactly as they were, with a
   * line saying why. "We could not ask" is not "they are down" — and the
   * local rows are at least honest about being local.
   */
  async withRemoteAppStatuses(projectName: string, info: IStackInfo): Promise<IStackInfo> {
    return (await this.askNodes(projectName, info)).info;
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
    const nodes = info.config.nodes ?? [];
    if (nodes.length === 0 || !this.slaveConnector) return { info, answered: 0 };

    const reported = new Map<string, import('../config/types.js').ProcessInfoDto>();
    let remoteInfra: IStackInfraStatus | null = null;
    let answered = 0;
    for (const node of nodes) {
      try {
        const status = (await this.slaveConnector.invokeOnSlave(
          node.host,
          node.port ?? 9700,
          'OmnitronDaemon',
          'status',
          [],
        )) as import('../config/types.js').DaemonStatusDto;
        answered += 1;

        // The containers are on the node too — `infraManager.getInstance`
        // answers about THIS machine, where a remote stack has none, so the
        // stack read "Infrastructure: not provisioned" beside a node running
        // postgres, redis, minio, the gateway and tor.
        remoteInfra ??= await this.remoteInfraStatus(projectName, info.name, node);
        for (const app of status?.apps ?? []) {
          // The node names them `<project>/deployed/<app>`; the stack knows
          // them by the app's own name.
          const bare = app.name.includes('/') ? app.name.slice(app.name.lastIndexOf('/') + 1) : app.name;
          reported.set(bare, app);
        }
      } catch (err) {
        this.logger.warn(
          { project: projectName, stack: info.name, node: node.host, error: (err as Error).message },
          'Could not ask this node what it is running — its apps are reported as this master sees them',
        );
      }
    }

    if (answered === 0) return { info, answered };

    const apps = info.apps.map((app) => {
      const running = reported.get(app.name);
      if (!running) return app;
      return {
        ...app,
        handleKey: running.name,
        status: running.status,
        pid: running.pid,
        instances: running.instances,
        uptime: running.uptime,
        restarts: running.restarts,
        cpu: running.cpu,
        memory: running.memory,
        port: running.port ?? null,
      };
    });

    // The stack's own status is this master's memory of having started it,
    // and a daemon restart forgets it — so a stack whose six applications
    // are running on a node read `stopped` a minute after an upgrade. The
    // apps are the fact here too.
    const online = apps.filter((a) => a.status === 'online').length;
    const status: StackStatus =
      online === apps.length && apps.length > 0
        ? 'running'
        : online > 0
          ? 'degraded'
          : info.status;

    // And when the stack started is when its applications did: the
    // longest-running one a node reports online. An uptime is a duration the
    // node measured on its own clock, so taking it from this one needs no
    // agreement between the two clocks.
    const longest = apps.reduce(
      (max, a) => (reported.has(a.name) && a.status === 'online' && a.uptime > max ? a.uptime : max),
      0,
    );

    return {
      info: {
        ...info,
        status,
        infrastructure: remoteInfra ?? info.infrastructure,
        apps,
        startedAt: longest > 0 ? new Date(Date.now() - longest).toISOString() : null,
        uptime: longest,
      },
      answered,
    };
  }


  /**
   * One node's infrastructure, named the way the stack names it.
   *
   * The node's container names carry ITS prefix (`daos-test-postgres`), and
   * a reader wants the service — `postgres` — so the same stripping the
   * local path does is done here. `null` when the node cannot answer or has
   * no infrastructure of its own, which leaves the master's view in place.
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
            .filter((c) => c.name.startsWith(prefix))
            .map((c) => [c.name, c]);

      if (entries.length === 0) return null;

      for (const [containerName, svc] of entries) {
        const name = containerName.startsWith(prefix) ? containerName.slice(prefix.length) : containerName;
        services[name] = {
          status: svc.status === 'running' ? 'running' : svc.error ? 'error' : 'stopped',
          containerName: svc.name,
          port: svc.ports ? Object.values(svc.ports)[0] ?? null : null,
        };
      }

      // Without the node's own verdict, "ready" is what the containers say:
      // every one of them running.
      const ready = state?.ready ?? Object.values(services).every((svc) => svc.status === 'running');
      return { ready, services };
    } catch (err) {
      this.logger.warn(
        { project: projectName, stack: stackName, node: node.host, error: (err as Error).message },
        'Could not ask this node about its infrastructure — the stack shows this master\'s view',
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
    const configuredNames = new Set(configuredApps.map((a) => a.name));

    // Match running handles by effective (un-prefixed) name. Two
    // registration paths can land an app in the orchestrator's handle
    // map: the namespaced stack-mode path (`omni/dev/main`) and the
    // bare-name daemon-RPC path (`main`). Pre-fix the UI only saw the
    // first; a CLI `omnitron start main` (or any ecosystem.config entry
    // started before the stack-mode env vars were known) registered
    // bare and silently disappeared from the project/stack view, even
    // though `omnitron list` happily reported it online. By keying off
    // `effectiveAppName` we accept either form so the UI matches the
    // CLI's worldview. Cross-stack collisions on the same effective
    // name still resolve via the namespaced handle's prefix; the bare
    // fallback only applies when that name appears in this stack's
    // configured-app set, so an unrelated bare handle in another stack
    // never bleeds in.
    const runningByName = new Map<string, ReturnType<OrchestratorService['list']>[number]>();
    for (const a of this.orchestrator.list()) {
      const effective = effectiveAppName(a.name);
      const inThisPrefix = a.name.startsWith(prefix);
      const inThisStackByName = !a.name.includes('/') && configuredNames.has(effective);
      if (!inThisPrefix && !inThisStackByName) continue;
      // Namespaced wins over bare on collision.
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
        infraServices[serviceName] = {
          status: svcState.status === 'running' ? 'running' : svcState.error ? 'error' : 'stopped',
          containerName: svcState.name,
          port: svcState.ports ? Object.values(svcState.ports)[0] ?? null : null,
        };
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

    return {
      name: stackName,
      type: config.type,
      status: state?.status ?? 'stopped',
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
    new ProjectService(loggerModule.logger, orchestrator, daemonStateStore, { secrets, audit }),
};
