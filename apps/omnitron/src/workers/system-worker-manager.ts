/**
 * SystemWorkerManager — Registry for daemon-internal background workers
 *
 * Manages system-level PM workers (health-monitor, future: log-rotator, etc.)
 * Separate from OrchestratorService which manages user application processes.
 * All system workers are prefixed with "system:" in PM to avoid name collisions.
 *
 * A registry that only records what it started is a registry that lies the
 * moment a worker dies. Every entry here is bound to the child's `onExit`, so
 * the map holds workers that are actually running — `get()` returns null once
 * the process is gone, `spawn()` may be called again under the same name, and
 * callers holding a proxy are told to drop it. Before that, a crashed
 * health-monitor left its proxy in place and every fleet check answered
 * `Service with id HealthMonitor@1.0.0 not found` until the daemon restarted.
 */

import type { ProcessManager, ServiceProxy, IWorkerHandle } from '@omnitron-dev/titan-pm';

/**
 * What `IWorkerHandle.onExit` hands its subscriber.
 *
 * Derived from the handle rather than imported: `titan-pm` exports
 * `IWorkerHandle` from its index but not the `IWorkerExitInfo` its `onExit`
 * signature names, so the payload has no importable name. Reading it off the
 * method keeps this bound to the real contract — if the payload changes, this
 * stops compiling.
 */
type WorkerExitInfo = Parameters<Parameters<NonNullable<IWorkerHandle['onExit']>>[0]>[0];
import type { ILogger } from '@omnitron-dev/titan/module/logger';

export interface SystemWorkerInfo {
  name: string;
  /** PM-internal process ID (UUID) for getWorkerHandle() */
  processId: string;
  startedAt: number;
}

/** What a subscriber is told when a system worker's process ends. */
export interface SystemWorkerExit {
  name: string;
  processId: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  /** `true` when we asked for it (stop/stopAll), `false` for a crash. */
  expected: boolean;
}

interface WorkerEntry {
  proxy: ServiceProxy<any>;
  info: SystemWorkerInfo;
  /** Unsubscribe from the child's exit event. */
  offExit?: () => void;
  /** Set by `stop()` so the exit handler can report it as expected. */
  stopping?: boolean;
}

export class SystemWorkerManager {
  private readonly workers = new Map<string, WorkerEntry>();
  private readonly exitHandlers = new Map<string, Set<(exit: SystemWorkerExit) => void>>();

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

    const entry: WorkerEntry = {
      proxy,
      info: { name, processId, startedAt: Date.now() },
    };
    this.workers.set(name, entry);

    // Bind the entry's lifetime to the child's. Without this the map — and
    // every proxy handed out from it — outlives the process it describes.
    const handle = this.pm.getWorkerHandle(processId);
    if (handle?.onExit) {
      entry.offExit = handle.onExit((info: WorkerExitInfo) => {
        this.handleExit(name, processId, info);
      });
    } else {
      this.logger.warn(
        { worker: name, processId },
        'Worker handle has no onExit — a crash of this worker will not be noticed',
      );
    }
    if (handle?.onLog) {
      handle.onLog(this.forwardLog(name));
    } else {
      this.logger.warn({ worker: name, processId }, 'Worker handle has no onLog — what this worker says will not be seen');
    }

    this.logger.info({ worker: name, processId }, 'System worker started');
    return proxy;
  }

  /**
   * A worker's own lines, into the daemon's log under the worker's name.
   *
   * The daemon switches titan-pm's forwarding off (`forwardChildLogs: false`
   * in daemon.module.ts), because the orchestrator subscribes to an APP's
   * lines itself and a second forwarder stored each of them twice. A system
   * worker has no such subscriber: its output was captured line by line and
   * handed to nobody. The health monitor said «Failed to persist health
   * check results» once a minute from 12:15 UTC on 2026-09-22, and the only
   * place that sentence reached was Postgres's own log, as the error behind
   * it. Six and a half hours without a node's history, in silence.
   */
  private forwardLog(name: string): (line: string, stream: 'stdout' | 'stderr') => void {
    return (line, stream) => {
      let parsed: Record<string, unknown> | null = null;
      try {
        const value: unknown = JSON.parse(line);
        if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
      } catch {
        // Not pino's JSON: a stack trace, a runtime warning — said as it came.
      }
      if (!parsed) {
        if (stream === 'stderr') this.logger.warn({ worker: name, stream }, line);
        else this.logger.info({ worker: name, stream }, line);
        return;
      }
      const { level, time: _time, pid: _pid, hostname: _hostname, msg, ...fields } = parsed;
      const data = { ...fields, worker: name };
      const text = typeof msg === 'string' ? msg : '';
      const n = typeof level === 'number' ? level : 30;
      // pino: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal.
      if (n >= 50) this.logger.error(data, text);
      else if (n >= 40) this.logger.warn(data, text);
      else if (n >= 30) this.logger.info(data, text);
      else this.logger.debug(data, text);
    };
  }

  /** Get a running worker's proxy */
  get<T>(name: string): ServiceProxy<T> | null {
    return (this.workers.get(name)?.proxy as ServiceProxy<T>) ?? null;
  }

  /** Whether a worker is registered and its process is still alive. */
  isAlive(name: string): boolean {
    const entry = this.workers.get(name);
    if (!entry) return false;
    const handle = this.pm.getWorkerHandle(entry.info.processId);
    // No handle means PM has already forgotten the process; treat as dead.
    // `isAlive` is optional on the handle — absent, the registration stands.
    return handle ? (handle.isAlive?.() ?? true) : false;
  }

  /**
   * Subscribe to a worker's termination.
   *
   * Registered per NAME, not per process, so a subscriber keeps working
   * across respawns. The handler fires once per physical termination; the
   * entry is already removed from the registry by the time it runs, so a
   * handler may call `spawn()` for the same name.
   */
  onExit(name: string, handler: (exit: SystemWorkerExit) => void): () => void {
    let set = this.exitHandlers.get(name);
    if (!set) {
      set = new Set();
      this.exitHandlers.set(name, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.exitHandlers.delete(name);
    };
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

    // Mark first: `pm.kill()` fires the child's exit event, and the handler
    // must be able to tell a deliberate stop from a crash.
    entry.stopping = true;

    try {
      // Use PM.kill() for clean process termination
      await this.pm.kill(entry.info.processId);
    } catch {
      // Fallback: destroy proxy
      try {
        await (entry.proxy as any).__destroy?.();
      } catch { /* best-effort */ }
    }
    // The exit handler normally does this; do it here too in case the handle
    // never fired (no onExit support, or PM dropped the handle first).
    if (this.workers.get(name) === entry) {
      entry.offExit?.();
      this.workers.delete(name);
    }
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

  // ===========================================================================
  // Private
  // ===========================================================================

  private handleExit(name: string, processId: string, info: WorkerExitInfo): void {
    const entry = this.workers.get(name);
    // A late exit from a process we already replaced must not evict its
    // successor.
    if (entry && entry.info.processId !== processId) return;

    const expected = entry?.stopping === true || info.expected === true;
    if (entry) {
      entry.offExit?.();
      this.workers.delete(name);
    }

    const exit: SystemWorkerExit = {
      name,
      processId,
      code: info.code ?? null,
      signal: info.signal ?? null,
      expected,
    };

    if (expected) {
      this.logger.info({ worker: name, processId, code: exit.code, signal: exit.signal }, 'System worker exited');
    } else {
      this.logger.error(
        { worker: name, processId, code: exit.code, signal: exit.signal },
        'System worker died unexpectedly',
      );
    }

    for (const handler of this.exitHandlers.get(name) ?? []) {
      try {
        handler(exit);
      } catch (err) {
        this.logger.warn({ worker: name, error: (err as Error).message }, 'System worker exit handler failed');
      }
    }
  }
}
