/**
 * Process Manager Implementation
 *
 * Core class that manages process lifecycle, spawning processes as Netron services,
 * and providing type-safe inter-process communication.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import path from 'node:path';

import { Injectable } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

import type {
  IProcessManager,
  IProcessOptions,
  IProcessInfo,
  ServiceProxy,
  IProcessPool,
  IProcessPoolOptions,
  IProcessMetrics,
  IHealthStatus,
  IProcessManagerConfig,
  ISupervisorOptions,
  ISupervisorConfig,
  IProcessMetadata,
  IWorkerHandle,
} from './types.js';

import { ProcessStatus } from './types.js';

import { PROCESS_METADATA_KEY, WORKFLOW_METADATA_KEY } from './decorators.js';
import { ProcessPool } from './process-pool.js';
import { ProcessSupervisor } from './process-supervisor.js';
import { ProcessWorkflow } from './process-workflow.js';
import { ServiceProxyHandler } from './service-proxy.js';
import { ProcessSpawnerFactory } from './process-spawner.js';
import { generateUuidV7 } from '@omnitron-dev/titan/utils';
import type { IProcessSpawner } from './types.js';
import { ProcessRegistry } from './process-registry.js';
import { ProcessMetricsCollector } from './process-metrics.js';
import { ProcessHealthChecker } from './process-health.js';

/**
 * Main Process Manager implementation
 */
@Injectable()
export class ProcessManager extends EventEmitter implements IProcessManager {
  private readonly processes = new Map<string, IProcessInfo>();
  private readonly workers = new Map<string, IWorkerHandle>();
  private readonly serviceProxies = new Map<string, ServiceProxy<unknown>>();
  private readonly pools = new Map<string, ProcessPool<unknown>>();
  private isShuttingDown = false;

  private readonly registry: ProcessRegistry;
  private readonly spawner: IProcessSpawner;
  private readonly metricsCollector: ProcessMetricsCollector;
  private readonly healthChecker: ProcessHealthChecker;

  constructor(
    private readonly logger: ILogger,
    private readonly config: IProcessManagerConfig = {}
  ) {
    super();

    // Initialize sub-components
    this.registry = new ProcessRegistry();

    // Use factory to create appropriate spawner
    this.spawner = ProcessSpawnerFactory.create(this.logger, this.config);

    this.metricsCollector = new ProcessMetricsCollector(this.logger);
    this.healthChecker = new ProcessHealthChecker(this.logger);

    // Setup shutdown handlers only when explicitly opted in.
    // PM is a library component — the daemon (or top-level app) should own
    // process signal handling. Default: off.
    if (config.handleSignals === true) {
      this.setupShutdownHandlers();
    }
  }

  /**
   * Spawn a new process as a Netron service
   */
  async spawn<T>(
    processPathOrClass: string | (new (...args: any[]) => T),
    options: IProcessOptions = {}
  ): Promise<ServiceProxy<T>> {
    const processId = generateUuidV7();

    // Handle both string path and class
    let ProcessClass: (new (...args: any[]) => T) | null = null;
    let processName: string;

    if (typeof processPathOrClass === 'string') {
      // File path case - we'll use the name from options or derive from path
      processName = options.name || path.basename(processPathOrClass, '.js');
    } else {
      // Class constructor case
      ProcessClass = processPathOrClass;
      processName = ProcessClass.name;
    }

    const processMetadata = ProcessClass ? this.getProcessMetadata(ProcessClass) : undefined;
    const mergedOptions = this.mergeOptions(processMetadata, options);

    // Create process info
    const processInfo: IProcessInfo = {
      id: processId,
      name: mergedOptions.name || processName,
      status: ProcessStatus.PENDING,
      startTime: Date.now(),
      restartCount: 0,
    };

    this.processes.set(processId, processInfo);

    try {
      // Update status
      processInfo.status = ProcessStatus.STARTING;
      this.emit('process:spawn', processInfo);

      // Spawn the process with unified interface
      const handle = await this.spawner.spawn(processPathOrClass, {
        processId,
        name: mergedOptions.name,
        version: mergedOptions.version,
        config: mergedOptions,
        dependencies: mergedOptions.dependencies,
        env: mergedOptions.env,
        startupTimeout: mergedOptions.startupTimeout,
        transport: this.mapTransport(mergedOptions.netron?.transport),
        host: mergedOptions.netron?.host,
        isolation: mergedOptions.security?.isolation,
        execArgv: mergedOptions.execArgv,
      });

      // Store references
      this.workers.set(processId, handle);

      // Check if worker is already running
      if (handle.status === ProcessStatus.RUNNING) {
        processInfo.status = ProcessStatus.RUNNING;
      } else {
        // Wait for process to be ready
        await this.waitForProcessReady(processId);
      }

      // Use proxy from handle if available, or create one
      const proxy =
        (handle.proxy as ServiceProxy<T>) ||
        (await this.createServiceProxy<T>(ProcessClass, processId, null, mergedOptions));

      this.serviceProxies.set(processId, proxy);

      // Register in the registry for discovery
      this.registry.register(processInfo);

      // Update status — use actual child PID, not daemon PID
      processInfo.status = ProcessStatus.RUNNING;
      processInfo.pid = handle.pid ?? process.pid;
      this.emit('process:ready', processInfo);

      // Setup monitoring
      if (mergedOptions.health?.enabled) {
        this.healthChecker.startMonitoring(processId, proxy, mergedOptions.health);
      }

      if (mergedOptions.observability?.metrics) {
        this.metricsCollector.startCollection(processId, proxy);
      }

      return proxy;
    } catch (error) {
      processInfo.status = ProcessStatus.FAILED;
      processInfo.errors = [error as Error];
      this.emit('process:crash', processInfo, error);
      throw error;
    }
  }

  /**
   * Create a process pool for load balancing
   */
  async pool<T>(
    processPathOrClass: string | (new (...args: any[]) => T),
    options: IProcessPoolOptions = {}
  ): Promise<IProcessPool<T>> {
    const pool = new ProcessPool<T>(this, processPathOrClass, options, this.logger);

    await pool.initialize();

    // Track pool for graceful shutdown
    const poolId = `pool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pools.set(poolId, pool as ProcessPool<unknown>);

    // Remove from tracking when pool is destroyed
    pool.on('pool:destroyed', () => {
      this.pools.delete(poolId);
    });

    // Create a proxy that allows direct method calls on the pool
    // The proxy implements the full IProcessPool<T> interface including ServiceProxy<T> methods
    return new Proxy(pool, {
      get(target, property: string | symbol) {
        // Return pool properties and methods if they exist
        if (property in target) {
          return (target as any)[property];
        }

        // Prevent the proxy from being treated as a Promise
        if (property === 'then' || property === 'catch' || property === 'finally') {
          return undefined;
        }

        // For unknown properties, create a function that executes through the pool
        if (typeof property === 'string' && property !== 'constructor') {
          return async (...args: any[]) => target.execute(property, ...args);
        }

        return undefined;
      },
    }) as unknown as IProcessPool<T>;
  }

  /**
   * Discover a service by name
   *
   * Note: This only checks local registry. For distributed discovery,
   * use the Discovery module at the application level or implement
   * discovery within your process logic.
   */
  async discover<T>(serviceName: string): Promise<ServiceProxy<T> | null> {
    // Check local registry
    const localProcess = this.registry.findByServiceName(serviceName);
    if (localProcess) {
      return this.serviceProxies.get(localProcess.id) as ServiceProxy<T>;
    }

    // For remote discovery, processes should use the Discovery module
    // or implement their own discovery mechanism
    return null;
  }

  /**
   * Create a workflow
   */
  async workflow<T>(WorkflowPathOrClass: string | (new () => T)): Promise<T> {
    let WorkflowClass: new () => T;

    // Handle file path case
    if (typeof WorkflowPathOrClass === 'string') {
      WorkflowClass = await this.loadWorkflowFromFile<T>(WorkflowPathOrClass);
    } else {
      WorkflowClass = WorkflowPathOrClass;
    }

    const workflow = new ProcessWorkflow<T>(this, WorkflowClass, this.logger);

    return workflow.create();
  }

  /**
   * Load workflow class from a file path
   */
  private async loadWorkflowFromFile<T>(filePath: string): Promise<new () => T> {
    try {
      // Resolve the file path
      const resolvedPath = path.resolve(filePath);

      // Verify file exists
      const fs = await import('node:fs/promises');
      try {
        await fs.access(resolvedPath);
      } catch {
        throw Errors.notFound('Workflow file', resolvedPath);
      }

      // Dynamic import the module
      const module = await import(resolvedPath);

      // Try to find the workflow class from the module
      // Priority: default export, named export matching filename, first exported class
      let WorkflowClass: new () => T;

      if (module.default) {
        // Prefer default export
        WorkflowClass = module.default;
      } else {
        // Try to find a named export
        const basename = path.basename(filePath, path.extname(filePath));
        const pascalCaseName = basename
          .split(/[-_]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join('');

        // Try exact match, PascalCase match, or first exported value
        WorkflowClass =
          module[basename] ||
          module[pascalCaseName] ||
          (Object.values(module).find((exp) => typeof exp === 'function') as new () => T);

        if (!WorkflowClass) {
          throw Errors.badRequest(`No workflow class found in ${resolvedPath}`);
        }
      }

      // Validate that it's a constructor
      if (typeof WorkflowClass !== 'function') {
        throw Errors.badRequest(`Workflow export is not a class constructor in ${resolvedPath}`);
      }

      // Check if it has workflow metadata
      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, WorkflowClass);
      if (!metadata) {
        throw Errors.badRequest(
          `Class in ${resolvedPath} is not decorated with @Workflow(). ` +
            'Please add the @Workflow() decorator to your workflow class.'
        );
      }

      return WorkflowClass;
    } catch (error: any) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
        throw Errors.notFound('Workflow module', filePath);
      }
      throw error;
    }
  }

  /**
   * Create a supervisor tree.
   *
   * Supports two modes:
   *   1. Decorator-based: pass a @Supervisor decorated class
   *   2. Config-based: pass an ISupervisorConfig object (no decorators needed)
   *
   * @example Config-based
   * ```typescript
   * const supervisor = await pm.supervisor({
   *   strategy: SupervisionStrategy.ONE_FOR_ONE,
   *   maxRestarts: 5,
   *   children: [
   *     { name: 'api', process: './api.js', spawnOptions: { ... }, critical: true },
   *     { name: 'workers', process: './worker.js', poolOptions: { size: 4 } },
   *   ],
   * });
   * ```
   */
  /**
   * Create a supervisor without starting it.
   * Use this when you need to wire event listeners before child processes start.
   *
   * @example
   * ```typescript
   * const supervisor = pm.createSupervisor(config);
   * supervisor.on('child:started', (name) => handle.markOnline());
   * await supervisor.start();
   * ```
   */
  createSupervisor(
    classOrConfig: (new () => any) | ISupervisorConfig,
    options: ISupervisorOptions = {}
  ): ProcessSupervisor {
    if (typeof classOrConfig === 'function') {
      return new ProcessSupervisor(this, classOrConfig, options, this.logger);
    }
    return ProcessSupervisor.fromConfig(this, classOrConfig, this.logger);
  }

  async supervisor(
    classOrConfig: (new () => any) | ISupervisorConfig,
    options: ISupervisorOptions = {}
  ): Promise<ProcessSupervisor> {
    const supervisor = this.createSupervisor(classOrConfig, options);
    await supervisor.start();
    return supervisor;
  }

  /**
   * Get process information
   */
  getProcess(processId: string): IProcessInfo | undefined {
    return this.processes.get(processId);
  }

  /**
   * List all processes
   */
  listProcesses(): IProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * Get the worker handle for a spawned process by its ID.
   */
  getWorkerHandle(processId: string): IWorkerHandle | undefined {
    return this.workers.get(processId);
  }

  /**
   * Kill a process
   */
  async kill(processId: string, signal: string = 'SIGTERM'): Promise<boolean> {
    const processInfo = this.processes.get(processId);
    if (!processInfo) {
      return false;
    }

    processInfo.status = ProcessStatus.STOPPING;
    this.emit('process:stop', processInfo);

    try {
      // Cleanup proxy
      const proxy = this.serviceProxies.get(processId);
      if (proxy && '__destroy' in proxy) {
        await proxy.__destroy();
      }

      // Stop monitoring
      this.healthChecker.stopMonitoring(processId);
      this.metricsCollector.stopCollection(processId);

      // Terminate worker handle
      const handle = this.workers.get(processId);
      if (handle && 'terminate' in handle) {
        await handle.terminate();
      }

      // Cleanup references
      this.workers.delete(processId);
      this.serviceProxies.delete(processId);

      // Unregister from registry
      this.registry.unregister(processId);

      // Update status
      processInfo.status = ProcessStatus.STOPPED;
      processInfo.endTime = Date.now();

      return true;
    } catch (error) {
      this.logger.error({ error, processId }, 'Failed to kill process');
      processInfo.status = ProcessStatus.FAILED;
      processInfo.errors = [...(processInfo.errors || []), error as Error];
      return false;
    }
  }

  /**
   * Get metrics for a process
   */
  async getMetrics(processId: string): Promise<IProcessMetrics | null> {
    const proxy = this.serviceProxies.get(processId);
    if (!proxy || !('__getMetrics' in proxy)) {
      return null;
    }

    try {
      return await proxy.__getMetrics();
    } catch (error) {
      this.logger.error({ error, processId }, 'Failed to get process metrics');
      return null;
    }
  }

  /**
   * Get health status
   */
  async getHealth(processId: string): Promise<IHealthStatus | null> {
    const proxy = this.serviceProxies.get(processId);
    if (!proxy || !('__getHealth' in proxy)) {
      return null;
    }

    try {
      return await proxy.__getHealth();
    } catch (error) {
      this.logger.error({ error, processId }, 'Failed to get process health');
      return null;
    }
  }

  /**
   * Shutdown all processes
   */
  async shutdown(options: { timeout?: number; force?: boolean } = {}): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    const { timeout = 30000, force = false } = options;

    this.logger.info('Shutting down Process Manager');

    try {
      // Phase 1: Drain all pools first to complete in-flight requests
      if (this.pools.size > 0 && !force) {
        this.logger.info({ poolCount: this.pools.size }, 'Draining pools before shutdown');

        const drainPromises = Array.from(this.pools.values()).map(async (pool) => {
          try {
            await pool.drain();
          } catch (error) {
            this.logger.warn({ error }, 'Pool drain failed during shutdown');
          }
        });

        // Give pools time to drain, but don't block forever
        const drainTimeout = Math.min(timeout / 2, 15000);
        await Promise.race([
          Promise.all(drainPromises),
          new Promise<void>((resolve) => setTimeout(resolve, drainTimeout)),
        ]);
      }

      // Phase 2: Destroy all pools (cleans up pool workers)
      const destroyPoolPromises = Array.from(this.pools.values()).map(async (pool) => {
        try {
          await pool.destroy();
        } catch (error) {
          this.logger.warn({ error }, 'Pool destroy failed during shutdown');
        }
      });
      await Promise.all(destroyPoolPromises);
      this.pools.clear();

      // Phase 3: Kill remaining processes
      const shutdownPromises = Array.from(this.processes.keys()).map((processId) =>
        this.kill(processId, force ? 'SIGKILL' : 'SIGTERM')
      );

      await Promise.race([
        Promise.all(shutdownPromises),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(Errors.timeout('Process Manager shutdown', timeout)), timeout)
        ),
      ]);
    } catch (error) {
      if (force) {
        // Force kill all processes
        for (const processId of this.processes.keys()) {
          await this.kill(processId, 'SIGKILL');
        }
      } else {
        throw error;
      }
    }

    this.logger.info('Process Manager shutdown complete');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get process metadata from decorators
   */
  private getProcessMetadata(ProcessClass: any): IProcessMetadata | undefined {
    return Reflect.getMetadata(PROCESS_METADATA_KEY, ProcessClass);
  }

  /**
   * Merge process options
   */
  private mergeOptions(metadata: IProcessMetadata | undefined, options: IProcessOptions): IProcessOptions {
    return {
      // Set memory limit from PM config if not specified
      memory: {
        limit: this.config.resources?.maxMemory,
        ...metadata?.memory,
        ...options.memory,
      },
      ...metadata,
      ...options,
    };
  }

  /**
   * Wait for process to be ready
   * Uses event-based signaling instead of polling to avoid race conditions
   */
  private async waitForProcessReady(processId: string): Promise<void> {
    const STARTUP_TIMEOUT = 30000;

    return new Promise((resolve, reject) => {
      let resolved = false;
      let pollTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        resolved = true;
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        this.off('process:ready', readyHandler);
        this.off('process:crash', crashHandler);
      };

      const readyHandler = (info: IProcessInfo) => {
        if (info.id === processId && !resolved) {
          cleanup();
          resolve();
        }
      };

      const crashHandler = (info: IProcessInfo, error: Error) => {
        if (info.id === processId && !resolved) {
          cleanup();
          reject(error || Errors.internal(`Process ${processId} failed to start`));
        }
      };

      // Listen for events
      this.on('process:ready', readyHandler);
      this.on('process:crash', crashHandler);

      // Also poll in case status changed before we attached listeners
      const checkReady = () => {
        if (resolved) return;

        const processInfo = this.processes.get(processId);
        if (processInfo?.status === ProcessStatus.RUNNING) {
          cleanup();
          resolve();
        } else if (processInfo?.status === ProcessStatus.FAILED) {
          cleanup();
          reject(Errors.internal(`Process ${processId} failed to start`));
        } else {
          pollTimer = setTimeout(checkReady, 100);
        }
      };

      // Initial check
      checkReady();

      // Timeout handler
      setTimeout(() => {
        if (!resolved) {
          cleanup();
          reject(Errors.timeout(`Process ${processId} startup`, STARTUP_TIMEOUT));
        }
      }, STARTUP_TIMEOUT);
    });
  }

  /**
   * Create a type-safe service proxy
   */
  private async createServiceProxy<T>(
    ProcessClass: (new (...args: unknown[]) => T) | null,
    processId: string,
    netron: null,
    options: IProcessOptions
  ): Promise<ServiceProxy<T>> {
    const serviceName = ProcessClass?.name ?? options.name ?? 'unknown';
    const handler = new ServiceProxyHandler<T>(processId, netron, serviceName, this.logger);

    return handler.createProxy();
  }

  /**
   * Map netron transport type to spawn transport type
   */
  private mapTransport(transport?: string): 'tcp' | 'unix' | 'ws' | undefined {
    if (!transport) return undefined;

    const mapping: Record<string, 'tcp' | 'unix' | 'ws'> = {
      tcp: 'tcp',
      unix: 'unix',
      websocket: 'ws',
      http: 'ws', // HTTP uses WebSocket transport
    };

    return mapping[transport];
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

    signals.forEach((signal) => {
      process.on(signal, async () => {
        this.logger.info({ signal }, 'Received shutdown signal');
        await this.shutdown();
        process.exit(0);
      });
    });

    process.on('uncaughtException', async (error) => {
      this.logger.error({ error }, 'Uncaught exception');
      await this.shutdown({ force: true });
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      this.logger.error({ reason, promise }, 'Unhandled rejection');
      await this.shutdown({ force: true });
      process.exit(1);
    });
  }
}
