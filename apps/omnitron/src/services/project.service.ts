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
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { ProjectRegistry } from '../project/registry.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type {
  IEcosystemConfig,
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
import { StackInfrastructureManager } from '../infrastructure/stack-infra-manager.js';
import { resolveStack, resolvedConfigToEnv } from '../project/config-resolver.js';
import { SlaveConnector } from '../cluster/slave-connector.js';
import { RemoteDeployer } from './remote-deployer.service.js';
import type { FleetService } from './fleet.service.js';
import type { SyncService } from './sync.service.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';



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
  startedAt: number | null;
  /** InfrastructureService instance for this stack (local stacks only) */
  infraService: InfrastructureService | null;
}

// =============================================================================
// ProjectService
// =============================================================================

export class ProjectService extends EventEmitter {
  private readonly registry: ProjectRegistry;
  private readonly configRegistry = new Map<string, LoadedProject>();
  private readonly stackStates = new Map<string, StackRuntimeState>();
  private readonly infraManager: StackInfrastructureManager;
  private slaveConnector: SlaveConnector | null = null;
  private readonly deployer: RemoteDeployer;

  constructor(
    private readonly logger: ILogger,
    private readonly orchestrator: OrchestratorService,
    private readonly fleetService?: FleetService,
    private readonly syncService?: SyncService,
  ) {
    super();
    this.registry = new ProjectRegistry();
    this.infraManager = new StackInfrastructureManager(logger);
    this.deployer = new RemoteDeployer(logger);
  }

  /**
   * Get or create the SlaveConnector (lazy — only created when first remote/cluster stack starts).
   */
  private getSlaveConnector(): SlaveConnector {
    if (!this.slaveConnector) {
      this.slaveConnector = new SlaveConnector(this.logger, this.fleetService, this.syncService ?? null);
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

  listProjects(): IProjectInfo[] {
    return this.registry.list().map((p) => this.toProjectInfo(p));
  }

  getProject(name: string): IProjectInfo {
    const project = this.registry.get(name);
    if (!project) throw new Error(`Project '${name}' not found`);
    return this.toProjectInfo(project);
  }

  addProject(name: string, projectPath: string): IProjectInfo {
    const project = this.registry.add(name, projectPath);
    this.logger.info({ project: name, path: projectPath }, 'Project registered');
    this.emit('project:added', name, projectPath);
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
          // Pull images in background (don't block stack creation)
          const images = new Set<string>();
          if (stackConfig.infrastructure.postgres) images.add('postgres:17-alpine');
          if (stackConfig.infrastructure.redis) images.add('redis:7-alpine');
          if (stackConfig.infrastructure.minio) images.add('minio/minio:latest');
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

  async startStack(projectName: string, stackName: string): Promise<IStackInfo> {
    const config = await this.loadProjectConfig(projectName);
    const stacks = this.resolveStacks(config, projectName);
    const stackConfig = stacks[stackName];
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found in project '${projectName}'`);

    const stateKey = `${projectName}/${stackName}`;
    const existing = this.stackStates.get(stateKey);
    if (existing?.status === 'running') {
      this.logger.warn({ project: projectName, stack: stackName }, 'Stack already running');
      return this.toStackInfo(projectName, stackName, stackConfig);
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

    try {
      if (stackConfig.type === 'local') {
        await this.startLocalStack(projectName, stackName, stackConfig, config);
      } else if (stackConfig.type === 'remote') {
        await this.startRemoteStack(projectName, stackName, stackConfig, config);
      } else if (stackConfig.type === 'cluster') {
        await this.startClusterStack(projectName, stackName, stackConfig, config);
      }

      state.status = 'running';
      state.startedAt = Date.now();

      // Update registry with enabled stack
      this.updateEnabledStacks(projectName, stackName, true);

      this.emit('stack:started', projectName, stackName, stackConfig.type);
      this.logger.info({ project: projectName, stack: stackName }, 'Stack started');

      return this.toStackInfo(projectName, stackName, stackConfig);
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

  getStackStatus(projectName: string, stackName: string): StackRuntime {
    const stateKey = `${projectName}/${stackName}`;
    const state = this.stackStates.get(stateKey);

    const config = this.getLoadedConfig(projectName);
    const stacks = config ? this.resolveStacks(config, projectName) : {};
    const stackConfig = stacks[stackName] ?? state?.config;
    if (!stackConfig) throw new Error(`Stack '${stackName}' not found`);

    const prefix = `${projectName}/${stackName}/`;
    const apps = this.orchestrator.list().filter((a) => a.name.startsWith(prefix));
    const onlineApps = apps.filter((a) => a.status === 'online');

    // Derive status from app health if running
    let status: StackStatus = state?.status ?? 'stopped';
    if (status === 'running' && apps.length > 0 && onlineApps.length < apps.length) {
      status = 'degraded';
    }

    return {
      name: stackName,
      type: stackConfig.type,
      status,
      totalApps: apps.length,
      onlineApps: onlineApps.length,
      totalNodes: stackConfig.nodes?.length ?? 1,
      connectedNodes: stackConfig.type === 'local'
        ? 1
        : (this.slaveConnector?.getConnections().filter((c) => c.stack === stackName && c.status === 'connected').length ?? 0),
      totalCpu: apps.reduce((sum, a) => sum + a.cpu, 0),
      totalMemory: apps.reduce((sum, a) => sum + a.memory, 0),
      syncSummary: (stackConfig.type === 'remote' || stackConfig.type === 'cluster')
        ? {
            totalSlaves: stackConfig.nodes?.filter((n) => n.role !== 'master').length ?? 0,
            syncedSlaves: 0,
            totalPending: 0,
          }
        : null,
    };
  }

  /**
   * Get the infrastructure manager (for daemon-level access).
   */
  getInfraManager(): StackInfrastructureManager {
    return this.infraManager;
  }

  /**
   * Dispose of all resources held by this service.
   * Called during daemon shutdown.
   */
  async dispose(): Promise<void> {
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
            ...(dbConfig.pool ? {} : {}),
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
    const appDefinitions = new Map<string, IAppDefinition>();
    const appEntries = this.resolveStackApps(stackConfig, ecosystemConfig);
    const project = this.registry.get(projectName);

    for (const entry of appEntries) {
      if (entry.bootstrap && project) {
        try {
          const bootstrapAbsPath = path.resolve(project.path, entry.bootstrap);
          const { loadBootstrapConfig } = await import('../orchestrator/bootstrap-loader.js');
          const definition = await loadBootstrapConfig(bootstrapAbsPath, { devMode: false });

          // Populate omnitronConfig from app's config/default.json if not already set
          if (!definition.omnitronConfig) {
            const srcDir = path.dirname(bootstrapAbsPath);
            const appRoot = path.resolve(srcDir, '..');
            const configPath = path.join(appRoot, 'config', 'default.json');
            try {
              const content = fs.readFileSync(configPath, 'utf-8');
              const json = JSON.parse(content);
              if (json.omnitron) {
                definition.omnitronConfig = json.omnitron as OmnitronAppConfig;
              }
            } catch { /* config file missing — skip */ }
          }

          appDefinitions.set(entry.name, definition);
        } catch {
          // Non-critical — app can start without definition
        }
      }
    }

    // 2. Provision per-stack infrastructure (built-in + app-declared services)
    //    Auto-detect core services (postgres, redis, minio) from app requirements,
    //    then merge with explicit infrastructure config (gateway, custom services).
    // Merge stack-level + ecosystem-level infrastructure (stack overrides ecosystem, but both contribute)
    let effectiveInfra: InfrastructureConfig | undefined;
    if (stackConfig.infrastructure || ecosystemConfig.infrastructure) {
      effectiveInfra = {
        ...ecosystemConfig.infrastructure,
        ...stackConfig.infrastructure,
        // Deep-merge services maps from both levels
        services: {
          ...ecosystemConfig.infrastructure?.services,
          ...stackConfig.infrastructure?.services,
        },
      };
    }

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
        this.logger.error(
          { project: projectName, stack: stackName, error: (err as Error).message },
          'Failed to provision stack infrastructure — apps may fail to start'
        );
      }
    }

    // 2b. Run database migrations for apps that have migrate: true
    if (effectiveInfra && project) {
      await this.runStackMigrations(projectName, stackName, effectiveInfra as InfrastructureConfig, appEntries, project.path);
    }

    // 3. Resolve per-app infrastructure config via stack resolver
    const portAllocation = this.infraManager.getPortAllocation(projectName, stackName);
    const normalizedSvcs = this.infraManager.getNormalizedServices(projectName, stackName);
    const resolvedStack = resolveStack(
      ecosystemConfig,
      projectName,
      stackName,
      stackConfig,
      appDefinitions,
      portAllocation ?? undefined,
      undefined,
      normalizedSvcs ?? undefined,
    );

    // 4. Start each app with namespaced handle key and resolved infra config
    for (const entry of appEntries) {
      const appConfig = resolvedStack.appConfigs.get(entry.name);

      // Build environment variables from resolved infrastructure config
      const infraEnv = appConfig ? resolvedConfigToEnv(appConfig, entry.name, stackName) : {};
      this.logger.info(
        { app: entry.name, envKeys: Object.keys(infraEnv), hasS3: !!infraEnv['S3_ENDPOINT'], hasDb: !!infraEnv['DATABASE_URL'] },
        'Infrastructure env vars for app'
      );

      const namespacedEntry = {
        ...entry,
        name: ProjectService.handleKey(projectName, stackName, entry.name),
        // Resolve bootstrap to absolute path using project root — the orchestrator's
        // cwd may differ from the project directory (e.g. daemon running from webapp/).
        ...(entry.bootstrap && project
          ? { bootstrap: path.resolve(project.path, entry.bootstrap) }
          : {}),
        // Set CWD to project root so child processes can resolve relative config paths
        // (e.g., apps/storage/config/default.json) correctly.
        ...(project ? { cwd: project.path } : {}),
        env: {
          ...entry.env,
          ...infraEnv,
          ...stackConfig.settings?.env,
          OMNITRON_PROJECT: projectName,
          OMNITRON_STACK: stackName,
          OMNITRON_STACK_TYPE: 'local',
        },
      };

      try {
        await this.orchestrator.startApp(namespacedEntry, ecosystemConfig);
      } catch (err) {
        this.logger.error(
          { app: entry.name, project: projectName, stack: stackName, error: (err as Error).message },
          'Failed to start app in stack'
        );
      }
    }
  }

  private async startRemoteStack(
    projectName: string,
    stackName: string,
    stackConfig: IStackConfig,
    ecosystemConfig: IEcosystemConfig,
  ): Promise<void> {
    const nodes = stackConfig.nodes ?? [];
    if (nodes.length === 0) {
      throw new Error(`Remote stack '${stackName}' has no nodes configured`);
    }

    this.logger.info(
      { project: projectName, stack: stackName, nodes: nodes.length },
      'Starting remote stack — deploying to slave daemons'
    );

    const connector = this.getSlaveConnector();

    // Build artifacts for apps in this stack
    const appEntries = this.resolveStackApps(stackConfig, ecosystemConfig);
    const project = this.registry.get(projectName);
    let artifacts: import('../project/artifact-builder.js').ArtifactInfo[] = [];

    if (project) {
      try {
        const { ArtifactBuilder } = await import('../project/artifact-builder.js');
        const builder = new ArtifactBuilder(project.path);
        artifacts = await builder.buildAll(appEntries);
        this.logger.info(
          { artifacts: artifacts.map((a) => `${a.app}@${a.version}`), stack: stackName },
          'Artifacts built for deployment'
        );
      } catch (err) {
        this.logger.error(
          { error: (err as Error).message, stack: stackName },
          'Failed to build artifacts — deploying without rebuild'
        );
      }
    }

    // Resolve master address (from this daemon's perspective — what slaves connect to)
    const { DEFAULT_DAEMON_CONFIG: _dc } = await import('../config/defaults.js');
    const masterHost = _dc.host === '0.0.0.0' ? 'auto' : _dc.host;
    const masterPort = _dc.port;

    // Deploy to each node: provision slave → deploy artifacts → connect
    for (const node of nodes) {
      const nodeKey = `${node.host}:${node.port ?? 9700}`;

      // 1. Provision slave: install runtime + omnitron + generate slave config + start daemon
      const unsubProvision = this.deployer.onProgress((progress) => {
        this.emit('stack:deploy_progress', projectName, stackName, progress);
      });
      const provisioned = await this.deployer.provisionSlaveNode(
        node,
        masterHost === 'auto' ? node.host : masterHost, // If master binds 0.0.0.0, slave uses its own view of master
        masterPort,
        projectName,
      );
      unsubProvision();

      if (!provisioned) {
        this.logger.error({ node: nodeKey }, 'Failed to provision slave — skipping');
        continue;
      }

      // 2. Deploy app artifacts via SSH
      if (artifacts.length > 0) {
        const unsubDeploy = this.deployer.onProgress((progress) => {
          this.emit('stack:deploy_progress', projectName, stackName, progress);
        });
        const results = await this.deployer.deployToStack([node], artifacts, projectName);
        unsubDeploy();
        const failed = results.filter((r) => r.status === 'failed');
        if (failed.length > 0) {
          this.logger.warn({ node: nodeKey, failed: failed.map((f) => f.app) }, 'Some app deployments failed');
        }
      }

      // 3. Connect master to slave daemon via Netron TCP
      await connector.addSlave({
        host: node.host,
        port: node.port ?? 9700,
        label: node.label,
        stack: stackName,
        project: projectName,
      });
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
        const builder = new ArtifactBuilder(project.path);
        artifacts = await builder.buildAll(appEntries);
      } catch (err) {
        this.logger.error({ error: (err as Error).message }, 'Artifact build failed');
      }
    }

    // Resolve master address
    const { DEFAULT_DAEMON_CONFIG: _dc } = await import('../config/defaults.js');
    const masterHost = _dc.host === '0.0.0.0' ? 'auto' : _dc.host;
    const masterPort = _dc.port;

    // Provision all slave nodes in parallel (install runtime + omnitron + config)
    const appNodes = nodes.filter((n) => n.role !== 'database' && n.role !== 'cache');
    for (const node of appNodes) {
      const unsubProvision = this.deployer.onProgress((progress) => {
        this.emit('stack:deploy_progress', projectName, stackName, progress);
      });
      await this.deployer.provisionSlaveNode(
        node,
        masterHost === 'auto' ? node.host : masterHost,
        masterPort,
        projectName,
      );
      unsubProvision();
    }

    // Deploy app artifacts to all provisioned nodes
    if (artifacts.length > 0 && appNodes.length > 0) {
      const unsubDeploy = this.deployer.onProgress((progress) => {
        this.emit('stack:deploy_progress', projectName, stackName, progress);
      });
      const results = await this.deployer.deployToStack(appNodes, artifacts, projectName, { concurrency: 5 });
      unsubDeploy();
      const successful = results.filter((r) => r.status === 'success').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      this.logger.info(
        { successful, failed, total: results.length },
        'Cluster deployment complete'
      );
    }

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

      try {
        const { execFileSync } = await import('node:child_process');
        execFileSync(
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
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        this.logger.info({ database: dbName }, 'Migrations applied');
      } catch (err: any) {
        const stderr = err.stderr?.toString?.()?.trim?.() ?? '';
        this.logger.error(
          { database: dbName, error: err.message, stderr },
          'Migration failed — app may fail to start',
        );
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

  private toStackInfo(projectName: string, stackName: string, config: IStackConfig): IStackInfo {
    const stateKey = `${projectName}/${stackName}`;
    const state = this.stackStates.get(stateKey);
    const prefix = `${projectName}/${stackName}/`;

    // Get apps running in this stack
    const stackApps = this.orchestrator.list({ prefix });
    const runningByName = new Map(stackApps.map((a) => [a.name.replace(prefix, ''), a]));

    // Build app list from config — include both running and stopped apps
    const ecosystemConfig = this.getLoadedConfig(projectName);
    const configuredApps = ecosystemConfig ? this.resolveStackApps(config, ecosystemConfig) : [];

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
          syncStatus: null as ISyncStatus | null,
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

    return {
      name: stackName,
      type: config.type,
      status: state?.status ?? 'stopped',
      config,
      nodes,
      apps,
      infrastructure,
      portRange: config.portRange ?? null,
      startedAt: state?.startedAt ? new Date(state.startedAt).toISOString() : null,
      uptime: state?.startedAt ? Date.now() - state.startedAt : 0,
    };
  }
}
