/**
 * SystemWorkerManager — Registry for daemon-internal background workers
 *
 * Manages system-level PM workers (health-monitor, future: log-rotator, etc.)
 * Separate from OrchestratorService which manages user application processes.
 * All system workers are prefixed with "system:" in PM to avoid name collisions.
 */

import type { ProcessManager, ServiceProxy } from '@omnitron-dev/titan-pm';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

export interface SystemWorkerInfo {
  name: string;
  /** PM-internal process ID (UUID) for getWorkerHandle() */
  processId: string;
  startedAt: number;
}

export class SystemWorkerManager {
  private readonly workers = new Map<string, { proxy: ServiceProxy<any>; info: SystemWorkerInfo }>();

  constructor(
    private readonly pm: ProcessManager,
    private readonly logger: ILogger,
  ) {}

  /**
   * Spawn a system worker process.
   *
   * @param name - Logical name (e.g., 'health-monitor')
   * @param processPath - Absolute path to the @Process file
   * @param dependencies - Dependencies passed to process init()
   * @param options - PM spawn options (execArgv, etc.)
   */
  async spawn<T>(
    name: string,
    processPath: string,
    dependencies: Record<string, any>,
    options: { execArgv?: string[]; startupTimeout?: number } = {},
  ): Promise<ServiceProxy<T>> {
    if (this.workers.has(name)) {
      throw new Error(`System worker "${name}" is already running`);
    }

    const pmName = `system:${name}`;
    this.logger.info({ worker: name, processPath }, 'Spawning system worker');

    const spawnOpts: Record<string, any> = {
      name: pmName,
      allMethodsPublic: true,
      dependencies,
    };
    if (options.execArgv) spawnOpts['execArgv'] = options.execArgv;
    if (options.startupTimeout != null) spawnOpts['startupTimeout'] = options.startupTimeout;

    const proxy = await this.pm.spawn<T>(processPath, spawnOpts);

    // Extract PM-internal processId from the proxy for IPC handle lookup
    const processId = (proxy as any).__processId as string;

    this.workers.set(name, {
      proxy,
      info: { name, processId, startedAt: Date.now() },
    });

    this.logger.info({ worker: name, processId }, 'System worker started');
    return proxy;
  }

  /** Get a running worker's proxy */
  get<T>(name: string): ServiceProxy<T> | null {
    return (this.workers.get(name)?.proxy as ServiceProxy<T>) ?? null;
  }

  /**
   * Register an IPC message handler on a worker using PM's public API.
   * Uses pm.getWorkerHandle(processId).onMessage() — no internal access.
   */
  onMessage(name: string, handler: (data: any) => void): boolean {
    const entry = this.workers.get(name);
    if (!entry) return false;

    const handle = this.pm.getWorkerHandle(entry.info.processId);
    if (handle?.onMessage) {
      handle.onMessage(handler);
      return true;
    }
    this.logger.warn({ worker: name }, 'Worker handle has no onMessage — IPC not available');
    return false;
  }

  /** Stop a specific worker */
  async stop(name: string): Promise<void> {
    const entry = this.workers.get(name);
    if (!entry) return;

    try {
      // Use PM.kill() for clean process termination
      await this.pm.kill(entry.info.processId);
    } catch {
      // Fallback: destroy proxy
      try {
        await (entry.proxy as any).__destroy?.();
      } catch { /* best-effort */ }
    }
    this.workers.delete(name);
    this.logger.info({ worker: name }, 'System worker stopped');
  }

  /** Stop all system workers */
  async stopAll(): Promise<void> {
    const names = Array.from(this.workers.keys());
    await Promise.allSettled(names.map((n) => this.stop(n)));
  }

  /** List running workers */
  list(): SystemWorkerInfo[] {
    return Array.from(this.workers.values()).map((w) => w.info);
  }
}
