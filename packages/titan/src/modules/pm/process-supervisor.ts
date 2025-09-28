/**
 * Process Supervisor Implementation
 *
 * Implements supervision trees for fault-tolerant process management
 */

import type { ILogger } from '../logger/logger.types.js';
import type {
  ISupervisorOptions,
  ISupervisorChild,
  IProcessManager,
  IProcessInfo
} from './types.js';
import { SupervisionStrategy, RestartDecision } from './types.js';

import { SUPERVISOR_METADATA_KEY } from './decorators.js';

/**
 * Process supervisor for managing child processes with restart strategies
 */
export class ProcessSupervisor {
  private children = new Map<string, { info: ISupervisorChild; proxy: any }>();
  private restartCounts = new Map<string, number>();
  private restartTimestamps = new Map<string, number[]>();
  private isStarted = false;

  constructor(
    private readonly manager: IProcessManager,
    private readonly SupervisorClass: new () => any,
    private readonly options: ISupervisorOptions,
    private readonly logger: ILogger
  ) {}

  /**
   * Start the supervisor and all child processes
   */
  async start(): Promise<void> {
    if (this.isStarted) return;

    this.logger.info({ supervisor: this.SupervisorClass.name }, 'Starting supervisor');

    // Get supervisor metadata
    const metadata = this.getSupervisorMetadata();

    // Start child processes
    for (const [name, childDef] of metadata.children) {
      await this.startChild(name, childDef);
    }

    // Setup monitoring
    this.setupMonitoring();

    this.isStarted = true;
  }

  /**
   * Stop the supervisor and all child processes
   */
  async stop(): Promise<void> {
    if (!this.isStarted) return;

    this.logger.info({ supervisor: this.SupervisorClass.name }, 'Stopping supervisor');

    // Stop all children
    for (const [name, child] of this.children) {
      await this.stopChild(name);
    }

    this.isStarted = false;
  }

  /**
   * Restart a child process
   */
  async restartChild(name: string): Promise<void> {
    const child = this.children.get(name);
    if (!child) return;

    await this.stopChild(name);
    await this.startChild(name, child.info);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get supervisor metadata from decorators
   */
  private getSupervisorMetadata(): any {
    const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, this.SupervisorClass);
    if (!metadata) {
      throw new Error('Supervisor metadata not found');
    }

    // Resolve process classes from property values
    const instance = new this.SupervisorClass();
    if (metadata.children) {
      for (const [key, childDef] of metadata.children) {
        // Get the actual process class from the property value
        const propertyKey = (childDef as any).propertyKey || key;
        const processClass = (instance as any)[propertyKey];
        if (processClass) {
          childDef.processClass = processClass;
        }
      }
    }

    return metadata;
  }

  /**
   * Start a child process
   */
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
    } catch (error) {
      this.logger.error({ error, child: name }, 'Failed to start child process');

      if (childDef.critical) {
        throw error;
      }
    }
  }

  /**
   * Stop a child process
   */
  private async stopChild(name: string): Promise<void> {
    const child = this.children.get(name);
    if (!child) return;

    this.logger.debug({ child: name }, 'Stopping child process');

    try {
      if ('__destroy' in child.proxy) {
        await child.proxy.__destroy();
      }
      this.children.delete(name);
    } catch (error) {
      this.logger.error({ error, child: name }, 'Failed to stop child process');
    }
  }

  /**
   * Setup process monitoring
   */
  private setupMonitoring(): void {
    // Monitor process crashes
    this.manager.on('process:crash', async (info: IProcessInfo, error: Error) => {
      const childEntry = Array.from(this.children.entries()).find(
        ([_, child]) => (child.proxy as any).__processId === info.id
      );

      if (childEntry) {
        const [name, child] = childEntry;
        await this.handleChildCrash(name, child.info, error);
      }
    });
  }

  /**
   * Handle child process crash
   */
  private async handleChildCrash(
    name: string,
    childDef: ISupervisorChild,
    error: Error
  ): Promise<void> {
    this.logger.error({ error, child: name }, 'Child process crashed');

    // Check restart policy
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
        // Do nothing
        break;
    }
  }

  /**
   * Get restart decision based on strategy
   */
  private async getRestartDecision(
    name: string,
    childDef: ISupervisorChild,
    error: Error
  ): Promise<RestartDecision> {
    // Check restart count
    const restartCount = this.restartCounts.get(name) || 0;
    const maxRestarts = this.options.maxRestarts || 3;
    const window = this.options.window || 60000;

    // Check if we've exceeded max restarts
    if (restartCount >= maxRestarts) {
      const timestamps = this.restartTimestamps.get(name) || [];
      const recentRestarts = timestamps.filter(t => Date.now() - t < window);

      if (recentRestarts.length >= maxRestarts) {
        return childDef.critical
          ? RestartDecision.ESCALATE
          : RestartDecision.IGNORE;
      }
    }

    // Check if supervisor has custom restart logic
    const supervisor = new this.SupervisorClass();
    if (typeof supervisor.onChildCrash === 'function') {
      return await supervisor.onChildCrash(
        { ...childDef, name },
        error
      );
    }

    return RestartDecision.RESTART;
  }

  /**
   * Perform restart based on strategy
   */
  private async performRestart(name: string, childDef: ISupervisorChild): Promise<void> {
    const strategy = this.options.strategy || SupervisionStrategy.ONE_FOR_ONE;

    // Update restart tracking
    const count = (this.restartCounts.get(name) || 0) + 1;
    this.restartCounts.set(name, count);

    const timestamps = this.restartTimestamps.get(name) || [];
    timestamps.push(Date.now());
    this.restartTimestamps.set(name, timestamps);

    switch (strategy) {
      case SupervisionStrategy.ONE_FOR_ONE:
        // Restart only the failed child
        await this.restartChild(name);
        break;

      case SupervisionStrategy.ONE_FOR_ALL:
        // Restart all children
        await this.restartAll();
        break;

      case SupervisionStrategy.REST_FOR_ONE:
        // Restart failed child and all children started after it
        await this.restartRestForOne(name);
        break;

      case SupervisionStrategy.SIMPLE_ONE_FOR_ONE:
        // For dynamic children, just restart the failed one
        await this.restartChild(name);
        break;
    }
  }

  /**
   * Restart all children
   */
  private async restartAll(): Promise<void> {
    const children = Array.from(this.children.entries());

    // Stop all children
    for (const [name] of children) {
      await this.stopChild(name);
    }

    // Start all children
    for (const [name, child] of children) {
      await this.startChild(name, child.info);
    }
  }

  /**
   * Restart failed child and all children started after it
   */
  private async restartRestForOne(failedChild: string): Promise<void> {
    const children = Array.from(this.children.entries());
    const failedIndex = children.findIndex(([name]) => name === failedChild);

    if (failedIndex === -1) return;

    // Stop and restart failed child and all after it
    for (let i = failedIndex; i < children.length; i++) {
      const entry = children[i];
      if (!entry) continue;
      const [name, child] = entry;
      await this.stopChild(name);
      await this.startChild(name, child.info);
    }
  }

  /**
   * Escalate failure to parent supervisor or system
   */
  private async escalateFailure(
    name: string,
    childDef: ISupervisorChild,
    error: Error
  ): Promise<void> {
    this.logger.error(
      { child: name, error },
      'Child failure escalated'
    );

    // In a real implementation, this would notify parent supervisor
    // or trigger system-wide error handling
    throw new Error(`Critical child ${name} failed: ${error.message}`);
  }

  /**
   * Shutdown all children and the supervisor
   */
  private async shutdownAll(): Promise<void> {
    this.logger.info('Shutting down supervisor due to child failure');
    await this.stop();
  }
}