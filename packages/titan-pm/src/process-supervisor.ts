/**
 * Process Supervisor Implementation
 *
 * Implements supervision trees for fault-tolerant process management.
 *
 * Two creation modes:
 *   1. Decorator-based: @Supervisor + @Child decorators on a class
 *   2. Config-based: ISupervisorConfig object (no decorators needed)
 *
 * Config-based mode is designed for orchestrators, process managers,
 * and other systems that create supervision trees programmatically.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Errors } from '@omnitron-dev/titan/errors';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type {
  ISupervisorOptions,
  ISupervisorChild,
  ISupervisorConfig,
  ISupervisorChildConfig,
  IProcessManager,
  IProcessInfo,
  IProcessMetrics,
  IHealthStatus,
} from './types.js';
import { SupervisionStrategy, RestartDecision } from './types.js';

import { SUPERVISOR_METADATA_KEY } from './decorators.js';

/**
 * Process supervisor for managing child processes with restart strategies.
 *
 * Events:
 *   - 'child:crash' (name, error) — child crashed
 *   - 'child:restart' (name, attempt) — child restarting
 *   - 'child:started' (name) — child successfully started
 *   - 'child:stopped' (name) — child stopped
 *   - 'escalate' (name, error) — critical child exceeded max restarts
 *   - 'shutdown' () — supervisor shutting down
 */
export class ProcessSupervisor extends EventEmitter {
  private children = new Map<string, { info: ISupervisorChild; proxy: any }>();
  /** Reverse lookup map for O(1) processId -> name resolution */
  private readonly processIdToName = new Map<string, string>();
  private restartCounts = new Map<string, number>();
  private restartTimestamps = new Map<string, number[]>();
  private isStarted = false;
  private crashHandler: ((info: IProcessInfo, error: Error) => Promise<void>) | null = null;

  /**
   * Pre-resolved children for config-based creation (set by fromConfig).
   * When set, getSupervisorMetadata() is bypassed.
   */
  private configChildren: Map<string, ISupervisorChild> | null = null;

  /** Custom crash handler from config */
  private configCrashHandler: ((child: ISupervisorChild, error: Error) => Promise<RestartDecision>) | null = null;

  constructor(
    private readonly manager: IProcessManager,
    private readonly SupervisorClass: new () => any,
    private readonly options: ISupervisorOptions,
    private readonly logger: ILogger
  ) {
    super();
  }

  /**
   * Create a supervisor from a plain config object (no decorators needed).
   *
   * Maps ISupervisorChildConfig[] to ISupervisorChild[] (the internal format)
   * and bypasses decorator metadata resolution.
   */
  static fromConfig(manager: IProcessManager, config: ISupervisorConfig, logger: ILogger): ProcessSupervisor {
    // Placeholder class — supervisor doesn't use it in config mode
    class ConfigSupervisor {}

    const supervisor = new ProcessSupervisor(
      manager,
      ConfigSupervisor,
      {
        strategy: config.strategy,
        maxRestarts: config.maxRestarts,
        window: config.window,
        backoff: config.backoff,
      },
      logger
    );

    // Map config children to internal ISupervisorChild format
    supervisor.configChildren = new Map();
    for (const child of config.children) {
      supervisor.configChildren.set(child.name, configChildToInternal(child));
    }

    if (config.onChildCrash) {
      supervisor.configCrashHandler = config.onChildCrash;
    }

    return supervisor;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Start the supervisor and all child processes
   */
  async start(): Promise<void> {
    if (this.isStarted) return;

    this.logger.info({ supervisor: this.SupervisorClass.name }, 'Starting supervisor');

    // Resolve children: config-based or decorator-based
    const childrenMap = this.configChildren ?? this.getDecoratorChildren();

    // Start child processes in order
    for (const [name, childDef] of childrenMap) {
      await this.startChild(name, childDef);
    }

    this.setupMonitoring();
    this.isStarted = true;
  }

  /**
   * Stop the supervisor and all child processes
   */
  async stop(): Promise<void> {
    if (!this.isStarted) return;

    this.logger.info({ supervisor: this.SupervisorClass.name }, 'Stopping supervisor');
    this.emit('shutdown');

    if (this.crashHandler) {
      this.manager.off('process:crash', this.crashHandler);
      this.crashHandler = null;
    }

    // Stop all children in reverse order
    const names = Array.from(this.children.keys()).reverse();
    for (const name of names) {
      await this.stopChild(name);
    }

    this.isStarted = false;
  }

  /**
   * Restart a specific child
   */
  async restartChild(name: string): Promise<void> {
    const child = this.children.get(name);
    if (!child) return;

    await this.stopChild(name);
    await this.startChild(name, child.info);
  }

  // ============================================================================
  // Public API — child access, scaling, metrics
  // ============================================================================

  /** Get child proxy by name */
  getChildProxy(name: string): any | null {
    return this.children.get(name)?.proxy ?? null;
  }

  /** Get all child names */
  getChildNames(): string[] {
    return Array.from(this.children.keys());
  }

  /** Get PM process ID for a child */
  getChildProcessId(name: string): string | null {
    const child = this.children.get(name);
    if (!child) return null;
    return (child.proxy as any)?.__processId ?? null;
  }

  /** Get all PM process IDs across all children */
  getAllProcessIds(): string[] {
    const ids: string[] = [];
    for (const child of this.children.values()) {
      const id = (child.proxy as any)?.__processId;
      if (id) ids.push(id);
    }
    return ids;
  }

  /** Get restart count for a child */
  getRestartCount(name: string): number {
    return this.restartCounts.get(name) ?? 0;
  }

  /** Scale a pool child */
  async scaleChild(name: string, size: number): Promise<void> {
    const child = this.children.get(name);
    if (!child) throw Errors.notFound('Supervisor child', name);

    if (!child.info.pool) {
      throw Errors.badRequest(`Child '${name}' is not a pool — cannot scale`);
    }

    if (typeof child.proxy?.scale === 'function') {
      await child.proxy.scale(size);
    }
  }

  /** Get metrics for a child via PM */
  async getChildMetrics(name: string): Promise<IProcessMetrics | null> {
    const processId = this.getChildProcessId(name);
    if (!processId) return null;
    return this.manager.getMetrics(processId);
  }

  /** Get health for a child via PM */
  async getChildHealth(name: string): Promise<IHealthStatus | null> {
    const processId = this.getChildProcessId(name);
    if (!processId) return null;
    return this.manager.getHealth(processId);
  }

  /** Whether supervisor is running */
  get running(): boolean {
    return this.isStarted;
  }

  // ============================================================================
  // Private — Child lifecycle
  // ============================================================================

  private async startChild(name: string, childDef: ISupervisorChild): Promise<void> {
    this.logger.debug({ child: name }, 'Starting child process');

    try {
      let proxy;

      if (childDef.pool) {
        // Create process pool
        proxy = await this.manager.pool(childDef.processClass, childDef.pool);
      } else {
        // Create single process
        proxy = await this.manager.spawn(childDef.processClass, childDef.options);
      }

      this.children.set(name, { info: childDef, proxy });
      this.restartCounts.set(name, 0);

      // Add to reverse lookup map for O(1) crash handling
      const processId = (proxy as any).__processId;
      if (processId) {
        this.processIdToName.set(processId, name);
      }

      this.emit('child:started', name);
    } catch (error) {
      this.logger.error({ err: error, child: name }, 'Failed to start child process');

      if (!childDef.optional && childDef.critical) {
        throw error;
      }
    }
  }

  private async stopChild(name: string): Promise<void> {
    const child = this.children.get(name);
    if (!child) return;

    this.logger.debug({ child: name }, 'Stopping child process');

    try {
      const processId = (child.proxy as any).__processId;
      if (processId) {
        this.processIdToName.delete(processId);
      }

      // Kill the child process. PM.kill() calls both proxy.__destroy() (RPC disconnect)
      // AND WorkerHandle.terminate() (SIGTERM/SIGKILL) to ensure the OS process is cleaned up.
      if (processId) {
        await this.manager.kill(processId);
      } else {
        // Fallback: try pool destroy or direct proxy cleanup
        try {
          if (typeof child.proxy?.destroy === 'function') {
            await child.proxy.destroy();
          } else if ('__destroy' in child.proxy) {
            await child.proxy.__destroy();
          }
        } catch {
          // Best-effort cleanup — process may already be gone
        }
      }

      this.children.delete(name);
      this.emit('child:stopped', name);
    } catch (error) {
      this.logger.error({ err: error, child: name }, 'Failed to stop child process');
    }
  }

  // ============================================================================
  // Private — Crash handling
  // ============================================================================

  private setupMonitoring(): void {
    this.crashHandler = async (info: IProcessInfo, error: Error) => {
      try {
        const name = this.processIdToName.get(info.id);
        if (name) {
          const child = this.children.get(name);
          if (child) {
            this.emit('child:crash', name, error);
            await this.handleChildCrash(name, child.info, error);
          }
        }
      } catch (handlerError) {
        this.logger.error({ err: handlerError, originalError: String(error) }, 'Error in crash handler');
      }
    };

    this.manager.on('process:crash', this.crashHandler);
  }

  private async handleChildCrash(name: string, childDef: ISupervisorChild, error: Error): Promise<void> {
    this.logger.error({ err: error, child: name }, 'Child process crashed');

    const decision = await this.getRestartDecision(name, childDef, error);

    switch (decision) {
      case RestartDecision.RESTART:
        await this.performRestart(name, childDef);
        break;
      case RestartDecision.ESCALATE:
        await this.escalateFailure(name, childDef, error);
        break;
      case RestartDecision.SHUTDOWN:
        await this.shutdownAll();
        break;
      case RestartDecision.IGNORE:
      default:
        break;
    }
  }

  private async getRestartDecision(name: string, childDef: ISupervisorChild, error: Error): Promise<RestartDecision> {
    const restartCount = this.restartCounts.get(name) || 0;
    const maxRestarts = this.options.maxRestarts || 3;
    const window = this.options.window || 60000;

    // Check window-based restart limit
    if (restartCount >= maxRestarts) {
      const timestamps = this.restartTimestamps.get(name) || [];
      const recentRestarts = timestamps.filter((t) => Date.now() - t < window);

      if (recentRestarts.length >= maxRestarts) {
        return childDef.critical ? RestartDecision.ESCALATE : RestartDecision.IGNORE;
      }
    }

    // Config-based custom handler
    if (this.configCrashHandler) {
      return this.configCrashHandler(childDef, error);
    }

    // Decorator-based custom handler
    const supervisor = new this.SupervisorClass();
    if (typeof supervisor.onChildCrash === 'function') {
      return supervisor.onChildCrash({ ...childDef, name }, error);
    }

    return RestartDecision.RESTART;
  }

  private async performRestart(name: string, _childDef: ISupervisorChild): Promise<void> {
    const strategy = this.options.strategy || SupervisionStrategy.ONE_FOR_ONE;

    const count = (this.restartCounts.get(name) || 0) + 1;
    this.restartCounts.set(name, count);

    const timestamps = this.restartTimestamps.get(name) || [];
    timestamps.push(Date.now());
    this.restartTimestamps.set(name, timestamps);

    this.emit('child:restart', name, count);

    switch (strategy) {
      case SupervisionStrategy.ONE_FOR_ONE:
      case SupervisionStrategy.SIMPLE_ONE_FOR_ONE:
        await this.restartChild(name);
        break;
      case SupervisionStrategy.ONE_FOR_ALL:
        await this.restartAll();
        break;
      case SupervisionStrategy.REST_FOR_ONE:
        await this.restartRestForOne(name);
        break;
      default:
        await this.restartChild(name);
        break;
    }
  }

  private async restartAll(): Promise<void> {
    const children = Array.from(this.children.entries());
    for (const [name] of children) {
      await this.stopChild(name);
    }
    for (const [name, child] of children) {
      await this.startChild(name, child.info);
    }
  }

  private async restartRestForOne(failedChild: string): Promise<void> {
    const children = Array.from(this.children.entries());
    const failedIndex = children.findIndex(([name]) => name === failedChild);
    if (failedIndex === -1) return;

    for (let i = failedIndex; i < children.length; i++) {
      const entry = children[i];
      if (!entry) continue;
      const [name, child] = entry;
      await this.stopChild(name);
      await this.startChild(name, child.info);
    }
  }

  private async escalateFailure(name: string, _childDef: ISupervisorChild, error: Error): Promise<void> {
    this.logger.error({ child: name, error }, 'Child failure escalated');
    this.emit('escalate', name, error);
  }

  private async shutdownAll(): Promise<void> {
    this.logger.info('Shutting down supervisor due to child failure');
    this.emit('shutdown');
    await this.stop();
  }

  // ============================================================================
  // Private — Metadata resolution
  // ============================================================================

  /**
   * Get children from @Supervisor/@Child decorator metadata.
   * Only used in decorator-based mode (configChildren is null).
   */
  private getDecoratorChildren(): Map<string, ISupervisorChild> {
    const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, this.SupervisorClass);
    if (!metadata) {
      throw Errors.notFound('Supervisor metadata', this.SupervisorClass.name);
    }

    // Resolve process classes from property values
    const instance = new this.SupervisorClass();
    if (metadata.children) {
      for (const [key, childDef] of metadata.children) {
        const propertyKey = (childDef as any).propertyKey || key;
        const processClass = (instance as any)[propertyKey];
        if (processClass) {
          childDef.processClass = processClass;
        }
      }
    }

    return metadata.children ?? new Map();
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert config child to internal ISupervisorChild format */
function configChildToInternal(child: ISupervisorChildConfig): ISupervisorChild {
  return {
    name: child.name,
    processClass: child.process,
    options: child.spawnOptions as any,
    pool: child.poolOptions,
    critical: child.critical,
    optional: child.optional,
  };
}
