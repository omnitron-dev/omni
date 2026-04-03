/**
 * Process Spawner - Clean Architecture Implementation
 *
 * This implementation follows file-based process architecture where each process
 * is defined in a separate file with a default export. No runtime code extraction!
 */

import { Worker } from 'worker_threads';
import { fork, ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Errors } from '@omnitron-dev/titan/errors';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IProcessSpawner, ISpawnOptions, IWorkerHandle, IProcessOptions, IProcessManagerConfig } from './types.js';
import { ProcessStatus } from './types.js';
import { NetronClient } from './netron-client.js';
import { ServiceProxyHandler } from './service-proxy.js';
import { getAvailablePort } from '@omnitron-dev/titan/utils';
import { generateUuidV7 } from '@omnitron-dev/titan/utils';
// MockProcessSpawner is now in @omnitron-dev/testing/titan - use dynamic import to avoid circular dependency
let MockProcessSpawnerClass: any = null;

/** Resolve current directory at module level (ESM-only) */
const SPAWNER_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Transport configuration for Netron communication
 */
interface ITransportConfig {
  type: 'tcp' | 'unix' | 'ws';
  host?: string;
  port?: number;
  path?: string;
  url?: string;
}

/**
 * Worker context for spawned processes
 */
interface IWorkerContext {
  processId: string;
  processPath: string; // Path to the process file
  transport: ITransportConfig;
  options: IProcessOptions;
  dependencies?: Record<string, any>;
}

/**
 * Unified worker handle implementation
 */
export class WorkerHandle implements IWorkerHandle {
  private _status: ProcessStatus;
  private messageHandlers = new Map<string, (data: any) => void>();
  private logHandlers = new Set<(line: string, stream: 'stdout' | 'stderr') => void>();
  public readonly worker: Worker | ChildProcess;
  public readonly netronClient: NetronClient | null;

  constructor(
    public readonly id: string,
    worker: Worker | ChildProcess,
    netronClient: NetronClient | null,
    public readonly transportUrl: string,
    public readonly serviceName: string,
    public readonly serviceVersion: string,
    private readonly logger: ILogger,
    private readonly isWorkerThread: boolean,
    public readonly proxy?: any,
    initialStatus: ProcessStatus = ProcessStatus.STARTING,
    public readonly transportConfig?: ITransportConfig
  ) {
    this._status = initialStatus;
    this.worker = worker;
    this.netronClient = netronClient;
    this.setupMessageHandlers();
    this.setupDefaultLogForwarding();
  }

  get status(): ProcessStatus {
    return this._status;
  }

  /** OS process ID of the child (undefined for worker threads) */
  get pid(): number | undefined {
    if (this.isWorkerThread) return undefined;
    return (this.worker as ChildProcess).pid;
  }

  async terminate(): Promise<void> {
    try {
      this._status = ProcessStatus.STOPPING;

      // Disconnect Netron client if present
      if (this.netronClient?.isConnected()) {
        await this.netronClient.disconnect();
      }

      // Terminate the worker
      if (this.isWorkerThread) {
        const worker = this.worker as Worker;
        await worker.terminate();
      } else {
        const child = this.worker as ChildProcess;

        // Wait for actual process exit with proper timeout handling
        await this.terminateChildProcess(child);
      }

      // Clean up Unix socket file (E1)
      if (this.transportConfig?.type === 'unix' && this.transportConfig.path) {
        try { fsSync.unlinkSync(this.transportConfig.path); } catch { /* already gone */ }
      }

      // Clean up message/log handlers to prevent leaks (E5)
      this.messageHandlers.clear();
      this.logHandlers.clear();

      this._status = ProcessStatus.STOPPED;
    } catch (error) {
      this.logger.error({ error, workerId: this.id }, 'Error terminating worker');
      this._status = ProcessStatus.FAILED;
      throw error;
    }
  }

  /**
   * Terminate child process with proper exit verification
   */
  private async terminateChildProcess(child: ChildProcess): Promise<void> {
    const GRACEFUL_TIMEOUT = 2000;
    const SIGTERM_TIMEOUT = 2000;
    const SIGKILL_TIMEOUT = 1000;

    return new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        resolved = true;
        child.off('exit', exitHandler);
        child.off('error', errorHandler);
      };

      const exitHandler = () => {
        if (!resolved) {
          cleanup();
          resolve();
        }
      };

      const errorHandler = (err: Error) => {
        if (!resolved) {
          cleanup();
          // Ignore "channel closed" errors during shutdown
          if ((err as any).code !== 'ERR_IPC_CHANNEL_CLOSED') {
            this.logger.warn({ error: err, workerId: this.id }, 'Error during child termination');
          }
          resolve(); // Still resolve as the process may have exited
        }
      };

      // Listen for exit event
      child.once('exit', exitHandler);
      child.once('error', errorHandler);

      // Check if already exited
      if (child.exitCode !== null || child.killed) {
        cleanup();
        resolve();
        return;
      }

      // Try graceful shutdown first
      try {
        if (child.send && child.connected) {
          child.send({ type: 'shutdown' });
        }
      } catch (_e) {
        // IPC channel may be closed, continue with SIGTERM
        this.logger.debug({ workerId: this.id }, 'IPC channel closed, proceeding with SIGTERM');
      }

      // Schedule SIGTERM after graceful timeout
      setTimeout(() => {
        if (resolved || child.exitCode !== null || child.killed) return;

        this.logger.debug({ workerId: this.id }, 'Graceful shutdown timeout, sending SIGTERM');
        try {
          child.kill('SIGTERM');
        } catch (_e) {
          // Process may have already exited
        }
      }, GRACEFUL_TIMEOUT);

      // Schedule SIGKILL as last resort
      setTimeout(() => {
        if (resolved || child.exitCode !== null || child.killed) return;

        this.logger.warn({ workerId: this.id }, 'SIGTERM timeout, sending SIGKILL');
        try {
          child.kill('SIGKILL');
        } catch (_e) {
          // Process may have already exited
        }
      }, GRACEFUL_TIMEOUT + SIGTERM_TIMEOUT);

      // Final timeout - resolve even if process didn't exit cleanly
      setTimeout(
        () => {
          if (!resolved) {
            cleanup();
            this.logger.error({ workerId: this.id }, 'Process termination timeout - process may be zombie');
            resolve(); // Resolve anyway to not block shutdown
          }
        },
        GRACEFUL_TIMEOUT + SIGTERM_TIMEOUT + SIGKILL_TIMEOUT
      );
    });
  }

  isAlive(): boolean {
    if (this.isWorkerThread) {
      const _worker = this.worker as Worker;
      return this._status === ProcessStatus.RUNNING;
    } else {
      const child = this.worker as ChildProcess;
      return !child.killed && child.exitCode === null;
    }
  }

  async send(message: any): Promise<void> {
    if (this.isWorkerThread) {
      const worker = this.worker as Worker;
      worker.postMessage(message);
    } else {
      const child = this.worker as ChildProcess;
      if (child.send) {
        child.send(message);
      }
    }
  }

  onMessage(handler: (data: any) => void): void {
    const id = generateUuidV7();
    this.messageHandlers.set(id, handler);
  }

  onLog(handler: (line: string, stream: 'stdout' | 'stderr') => void): void {
    this.logHandlers.add(handler);
  }

  /** @internal */
  emitLog(line: string, stream: 'stdout' | 'stderr'): void {
    for (const handler of this.logHandlers) {
      handler(line, stream);
    }
  }

  private setupMessageHandlers(): void {
    if (this.isWorkerThread) {
      const worker = this.worker as Worker;
      worker.on('message', (data) => {
        if (data && typeof data === 'object' && 'type' in data && data.type === 'ready') {
          this._status = ProcessStatus.RUNNING;
        }
        this.messageHandlers.forEach((handler) => handler(data));
      });

      worker.on('error', (error) => {
        this.logger.error({ error, workerId: this.id }, 'Worker error');
        this._status = ProcessStatus.FAILED;
      });

      worker.on('exit', (code) => {
        this.logger.debug({ workerId: this.id, code }, 'Worker exited');
        this._status = ProcessStatus.STOPPED;
      });
    } else {
      const child = this.worker as ChildProcess;

      child.on('message', (data) => {
        if (data && typeof data === 'object' && 'type' in data && data.type === 'ready') {
          this._status = ProcessStatus.RUNNING;
        }
        this.messageHandlers.forEach((handler) => handler(data));
      });

      child.on('error', (error) => {
        this.logger.error({ error, workerId: this.id }, 'Child process error');
        this._status = ProcessStatus.FAILED;
      });

      child.on('exit', (code, signal) => {
        this.logger.debug({ workerId: this.id, code, signal }, 'Child process exited');
        this._status = ProcessStatus.STOPPED;
      });

      // Capture stdout/stderr for structured log routing
      this.setupLogCapture(child);
    }
  }

  /**
   * Capture child process stdout/stderr line by line.
   * Emits each line to registered log handlers for external consumers.
   */
  private setupLogCapture(child: ChildProcess): void {
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
      rl.on('line', (line: string) => {
        if (line.trim()) this.emitLog(line, 'stdout');
      });
    }
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr, crlfDelay: Infinity });
      rl.on('line', (line: string) => {
        if (line.trim()) this.emitLog(line, 'stderr');
      });
    }
  }

  /**
   * Register default log handler that forwards child process logs to the parent logger.
   * Parses pino JSON format and re-emits at the correct level with child process context.
   */
  private setupDefaultLogForwarding(): void {
    const childLogger = this.logger.child({
      childProcessId: this.id,
      childProcess: this.serviceName,
    });

    this.onLog((line: string, stream: 'stdout' | 'stderr') => {
      try {
        const parsed = JSON.parse(line);
        const level = pinoLevelToName(parsed.level ?? 30);
        const msg = parsed.msg || '';
        const { level: _l, time: _t, pid: _p, hostname: _h, msg: _m, ...data } = parsed;
        if (stream === 'stderr') data.stream = 'stderr';
        (childLogger as any)[level]?.(data, msg);
      } catch {
        if (stream === 'stderr') {
          childLogger.error({ raw: line, stream }, line);
        } else {
          childLogger.info({ raw: line }, line);
        }
      }
    });
  }
}

function pinoLevelToName(level: number): string {
  if (level <= 10) return 'trace';
  if (level <= 20) return 'debug';
  if (level <= 30) return 'info';
  if (level <= 40) return 'warn';
  if (level <= 50) return 'error';
  return 'fatal';
}

/** Strip sensitive env vars from child process environment */
function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  const sensitivePatterns = [
    /SECRET/i, /PASSWORD/i, /PRIVATE.?KEY/i, /TOKEN/i,
    /API.?KEY/i, /CREDENTIAL/i, /AUTH/i,
  ];
  // Keep PATH, NODE_ENV, HOME, USER, and app-specific config vars
  const keepPatterns = [
    /^PATH$/, /^NODE_/, /^HOME$/, /^USER$/, /^LANG$/, /^LC_/, /^TERM$/,
    /^SHELL$/, /^TMPDIR$/, /^XDG_/, /^npm_/, /^TITAN_/,
  ];
  for (const key of Object.keys(result)) {
    if (keepPatterns.some(p => p.test(key))) continue;
    if (sensitivePatterns.some(p => p.test(key))) {
      delete result[key];
    }
  }
  return result;
}

/**
 * Process spawner implementation - File-based architecture
 */
export class ProcessSpawner implements IProcessSpawner {
  private readonly workerRuntimePath: string;
  private readonly forkWorkerPath: string;
  private readonly tempDir: string;

  constructor(
    private readonly logger: ILogger,
    private readonly config: IProcessManagerConfig = {}
  ) {
    // ESM-only: use module-level import.meta.url resolution
    let currentDir = SPAWNER_DIR;

    // If running from source (during tests with ts-jest), redirect to dist
    if (currentDir.includes('/src/') || currentDir.includes('\\src\\')) {
      currentDir = currentDir.replace(/[/\\]src[/\\]/, path.sep + 'dist' + path.sep);
    }

    this.workerRuntimePath = path.join(currentDir, 'worker-runtime.js');
    this.forkWorkerPath = path.join(currentDir, 'fork-worker.js');

    // Setup temp directory for Unix sockets
    this.tempDir = config.advanced?.tempDir || path.join(os.tmpdir(), 'titan-pm');
  }

  /**
   * Spawn a new process from a file path
   *
   * @param processPathOrClass - Path to the process file (compiled JS) or class for backward compatibility
   * @param options - Spawn options
   */
  async spawn<T>(
    processPathOrClass: string | (new (...args: any[]) => T),
    options: ISpawnOptions = {}
  ): Promise<IWorkerHandle> {
    const processId = options.processId || generateUuidV7();

    // Handle both string path and class for backward compatibility
    let processPath: string;
    let serviceName: string;

    if (typeof processPathOrClass === 'string') {
      // New way: file path
      processPath = path.resolve(processPathOrClass);
      serviceName = options.name || path.basename(processPath, '.js');
    } else {
      // Legacy: class constructor (for backward compatibility)
      // In production, you should migrate to file-based approach
      this.logger.warn('Using legacy class-based spawn. Please migrate to file-based approach!');

      // For backward compatibility, we can still support classes
      // by generating a temporary file that imports and exports the class
      processPath = await this.createLegacyModule(processPathOrClass, processId);
      serviceName = options.name || processPathOrClass.name;
    }

    const serviceVersion = options.version || '1.0.0';

    // Verify process file exists
    try {
      await fs.access(processPath);
    } catch (_error) {
      throw Errors.notFound('Process file', processPath);
    }

    // Prepare transport configuration
    const transport = await this.setupTransport(processId, options);

    // Prepare worker context
    const context: IWorkerContext = {
      processId,
      processPath,
      transport,
      options: options as IProcessOptions,
      dependencies: options.dependencies,
    };

    // Determine spawn strategy based on isolation config
    // Force child process when execArgv is set — worker threads don't support execArgv
    const isolation = options.isolation || this.config.isolation || 'worker';
    const useWorkerThreads = isolation === 'worker' && (!options.execArgv || options.execArgv.length === 0);

    let worker: Worker | ChildProcess | undefined;
    let netronClient: NetronClient | null = null;

    try {
      // Spawn based on configuration
      if (isolation === 'vm' || isolation === 'container') {
        // Use child process for stronger isolation
        worker = await this.spawnChildProcess(context, options.execArgv);
      } else if (useWorkerThreads) {
        // Use worker threads for better performance
        worker = await this.spawnWorkerThread(context);
      } else {
        // Default to child process
        worker = await this.spawnChildProcess(context, options.execArgv);
      }

      // Wait for worker to be ready — returns actual service name from the child
      const startupTimeout = options.startupTimeout ?? this.config.resources?.timeout ?? 30_000;
      const readyInfo = await this.waitForReady(worker, useWorkerThreads, startupTimeout);

      // Use the child's reported service name/version (from @Process decorator)
      // if available, falling back to the spawn options
      const actualServiceName = readyInfo.serviceName || serviceName;
      const actualServiceVersion = readyInfo.serviceVersion || serviceVersion;

      // waitForReady() confirmed the child sent 'ready' — process is running.
      // Pass RUNNING as initial status since the message was already consumed.
      if (isolation !== 'none') {
        netronClient = new NetronClient(processId, this.logger);
        await netronClient.start();
        await netronClient.connect(transport.url!);

        // Create service proxy using the child's fully-qualified service name (name@version).
        // Netron registers services with qualified keys — using the bare name fails
        // because queryInterface wildcard resolution may not work across the
        // management plane transport.
        const qualifiedServiceName = actualServiceVersion
          ? `${actualServiceName}@${actualServiceVersion}`
          : actualServiceName;
        const proxyHandler = new ServiceProxyHandler(processId, netronClient, qualifiedServiceName, this.logger);
        const proxy = proxyHandler.createProxy();

        return new WorkerHandle(
          processId,
          worker,
          netronClient,
          transport.url!,
          actualServiceName,
          actualServiceVersion,
          this.logger,
          useWorkerThreads,
          proxy,
          ProcessStatus.RUNNING,
          transport
        );
      } else {
        // Direct communication without Netron
        return new WorkerHandle(
          processId,
          worker,
          null,
          transport.url!,
          actualServiceName,
          actualServiceVersion,
          this.logger,
          useWorkerThreads,
          undefined,
          ProcessStatus.RUNNING,
          transport
        );
      }
    } catch (error) {
      // Cleanup on error — kill the child process to prevent zombies
      try {
        if (!worker) {
          // Worker was never spawned — nothing to clean up
        } else if (useWorkerThreads) {
          await (worker as Worker).terminate();
        } else {
          const child = worker as ChildProcess;
          if (child.pid && !child.killed) {
            child.kill('SIGTERM');
            // Give it 3s to exit gracefully, then force kill
            setTimeout(() => {
              if (!child.killed) {
                child.kill('SIGKILL');
              }
            }, 3000).unref();
          }
        }
      } catch (killError) {
        this.logger.error(
          { error: killError, serviceName, processId },
          'Failed to kill worker process during error cleanup'
        );
      }

      if (netronClient) {
        // Disconnect the Netron client - log errors but don't fail the error flow
        await netronClient.disconnect().catch((disconnectError) => {
          this.logger.error(
            { error: disconnectError, serviceName, processId },
            'Failed to disconnect Netron client during error cleanup'
          );
        });
      }

      throw error;
    }
  }

  /**
   * Cleanup spawner resources
   */
  async cleanup(): Promise<void> {
    // Clean up stale Unix socket files
    try {
      const entries = await fs.readdir(this.tempDir);
      for (const entry of entries) {
        if (entry.endsWith('.sock')) {
          try { await fs.unlink(path.join(this.tempDir, entry)); } catch { /* already gone */ }
        }
      }
    } catch {
      // Directory doesn't exist — nothing to clean
    }

    // Cleanup temp directory if empty
    try {
      await fs.rmdir(this.tempDir);
    } catch {
      // Directory not empty or doesn't exist
    }
  }

  /**
   * Setup transport configuration
   */
  private async setupTransport(processId: string, options: ISpawnOptions): Promise<ITransportConfig> {
    const transportType = options.transport || this.config.transport || 'unix';

    switch (transportType) {
      case 'tcp':
      case 'ws': {
        const port = await getAvailablePort();
        const host = options.host || '127.0.0.1';
        const protocol = transportType === 'ws' ? 'ws' : 'tcp';
        return {
          type: transportType,
          host,
          port,
          url: `${protocol}://${host}:${port}`,
        };
      }

      case 'unix':
      default: {
        await fs.mkdir(this.tempDir, { recursive: true });
        const socketPath = path.join(this.tempDir, `${processId}.sock`);
        return {
          type: 'unix',
          path: socketPath,
          url: `unix://${socketPath}`,
        };
      }
    }
  }

  /**
   * Create a temporary module for legacy class-based spawning
   * This is for backward compatibility only!
   */
  private async createLegacyModule(ProcessClass: new (...args: any[]) => any, processId: string): Promise<string> {
    // This should only be used for backward compatibility
    // In production, use file-based processes

    await fs.mkdir(this.tempDir, { recursive: true });
    const modulePath = path.join(this.tempDir, `legacy-process-${processId}.js`);

    // Create a simple wrapper that exports the class
    const moduleContent = `
      // Auto-generated legacy wrapper - MIGRATE TO FILE-BASED APPROACH!
      import 'reflect-metadata';

      // This is a placeholder - in real implementation,
      // the class should be in its own file
      export default class ${ProcessClass.name} {
        constructor() {
          // Note: Logger not available in legacy wrapper
        }
      }
    `;

    await fs.writeFile(modulePath, moduleContent, 'utf8');

    // Log warning about legacy usage
    this.logger.warn(
      { processClass: ProcessClass.name, processId },
      'Legacy process spawning - please migrate to file-based approach'
    );

    return modulePath;
  }

  /**
   * Spawn worker thread
   */
  private async spawnWorkerThread(context: IWorkerContext): Promise<Worker> {
    // Ensure workerData contains only serializable data
    // Worker threads use structured clone algorithm which doesn't support functions/classes
    const serializableContext = this.makeSerializable(context);

    const worker = new Worker(this.workerRuntimePath, {
      workerData: serializableContext,
      env: sanitizeEnv(process.env),
    });

    return worker;
  }

  /**
   * Make context serializable by removing non-serializable data
   * This ensures Worker threads can clone the data successfully
   */
  private makeSerializable(context: IWorkerContext): IWorkerContext {
    try {
      // Use JSON serialization to strip out non-serializable data
      // This removes functions, classes, symbols, undefined, etc.
      return JSON.parse(JSON.stringify(context));
    } catch (error) {
      // If JSON serialization fails, create a minimal safe context
      this.logger.warn(
        { error, processId: context.processId },
        'Failed to serialize context, using minimal safe context'
      );

      return {
        processId: context.processId,
        processPath: context.processPath,
        transport: context.transport,
        options: {
          name: context.options?.name,
          version: context.options?.version,
        },
        // Omit dependencies if they're not serializable
      };
    }
  }

  /**
   * Spawn child process
   */
  private async spawnChildProcess(context: IWorkerContext, execArgv?: string[]): Promise<ChildProcess> {
    const contextJson = JSON.stringify(context);
    if (contextJson.length > 65536) { // 64KB limit
      throw new Error(`TITAN_WORKER_CONTEXT exceeds 64KB (${contextJson.length} bytes). Reduce dependencies.`);
    }

    const child = fork(this.forkWorkerPath, [], {
      env: {
        ...sanitizeEnv(process.env),
        ...(context.options?.env ?? {}),
        TITAN_WORKER_CONTEXT: contextJson,
      },
      execArgv: execArgv || [],
      silent: true,
      // Use CWD from options if provided (stack flow sets project root)
      ...(context.options?.cwd ? { cwd: context.options.cwd } : {}),
    });

    return child;
  }

  /**
   * Wait for worker to be ready.
   * Returns the ready message data which includes the child's actual
   * serviceName and serviceVersion (from @Process decorator metadata).
   */
  private async waitForReady(
    worker: Worker | ChildProcess,
    isWorkerThread: boolean,
    timeout: number = 5000
  ): Promise<{ serviceName?: string; serviceVersion?: string }> {
    return new Promise((resolve, reject) => {
      // Capture stderr output for diagnostics on timeout
      const stderrChunks: string[] = [];
      if (!isWorkerThread) {
        const child = worker as ChildProcess;
        child.stderr?.on('data', (chunk: Buffer) => {
          const line = chunk.toString().trim();
          if (line) stderrChunks.push(line);
          // Keep only last 20 lines to bound memory
          if (stderrChunks.length > 20) stderrChunks.shift();
        });
      }

      const timer = setTimeout(() => {
        const pid = !isWorkerThread ? (worker as ChildProcess).pid : undefined;
        const pidHint = pid ? ` (pid: ${pid})` : '';
        const stderrHint = stderrChunks.length > 0 ? `. Last stderr: ${stderrChunks.slice(-3).join(' | ')}` : '';
        reject(Errors.timeout(`Worker startup${pidHint}${stderrHint}`, timeout));
      }, timeout);

      const cleanup = () => {
        clearTimeout(timer);
        if (isWorkerThread) {
          (worker as Worker).off('message', messageHandler);
        } else {
          (worker as ChildProcess).off('message', messageHandler);
          (worker as ChildProcess).off('exit', exitHandler);
        }
      };

      const messageHandler = (data: any) => {
        if (data && typeof data === 'object' && 'type' in data) {
          if (data.type === 'ready') {
            cleanup();
            resolve({
              serviceName: data.serviceName,
              serviceVersion: data.serviceVersion,
            });
          } else if (data.type === 'error') {
            cleanup();
            const errMsg = data.error?.message || data.message || 'Worker initialization failed';
            reject(new Error(errMsg));
          }
        }
      };

      const exitHandler = (code: number | null) => {
        cleanup();
        const stderrHint = stderrChunks.length > 0 ? `. Last stderr: ${stderrChunks.slice(-3).join(' | ')}` : '';
        reject(new Error(`Worker exited during startup with code ${code}${stderrHint}`));
      };

      if (isWorkerThread) {
        (worker as Worker).on('message', messageHandler);
      } else {
        (worker as ChildProcess).on('message', messageHandler);
        (worker as ChildProcess).on('exit', exitHandler);
      }
    });
  }
}

/**
 * Factory for creating process spawners
 */
export class ProcessSpawnerFactory {
  /**
   * Create a process spawner based on configuration
   * In test environment, uses real ProcessSpawner.
   * For MockProcessSpawner, import directly from @omnitron-dev/testing/titan
   */
  static create(logger: ILogger, config: IProcessManagerConfig = {}): IProcessSpawner {
    // Allow explicit override of mock spawner setting
    // If useMockSpawner is explicitly set to false, use real spawner even in test environment
    if (config.testing?.useMockSpawner === false) {
      return new ProcessSpawner(logger, config);
    }

    // For mock spawner, users should now import from @omnitron-dev/testing/titan directly:
    // import { MockProcessSpawner } from '@omnitron-dev/testing/titan';
    // And pass it via config or use it directly in tests
    if (config.testing?.useMockSpawner === true) {
      // Check global first (for Jest ESM module isolation compatibility)
      const GlobalMockSpawner = (globalThis as any).__MockProcessSpawnerClass;
      if (GlobalMockSpawner) {
        return new GlobalMockSpawner(logger, config);
      }
      // If MockProcessSpawner was pre-loaded, use it
      if (MockProcessSpawnerClass) {
        return new MockProcessSpawnerClass(logger, config);
      }
      // Dynamic loading requires async — use createAsync() or pre-load via setMockSpawner()
      // Otherwise fall back to real spawner with a warning
      logger.warn(
        'MockProcessSpawner requested but not loaded. ' +
          'Import from @omnitron-dev/testing/titan and call ProcessSpawnerFactory.setMockSpawner() first, ' +
          'or use MockProcessSpawner directly in tests.'
      );
    }

    // Use unified spawner for production and tests
    return new ProcessSpawner(logger, config);
  }

  /**
   * Set the MockProcessSpawner class for use in tests
   * Call this before creating ProcessManager in test setup:
   *
   * @example
   * ```typescript
   * import { MockProcessSpawner } from '@omnitron-dev/testing/titan';
   * import { ProcessSpawnerFactory } from '@omnitron-dev/titan/module/pm';
   *
   * ProcessSpawnerFactory.setMockSpawner(MockProcessSpawner);
   * ```
   */
  static setMockSpawner(MockSpawnerClass: any): void {
    MockProcessSpawnerClass = MockSpawnerClass;
    // Also store in global for Jest compatibility (ESM module isolation workaround)
    (globalThis as any).__MockProcessSpawnerClass = MockSpawnerClass;
  }

  /**
   * Async factory that loads MockProcessSpawner dynamically
   * Use this in test setup when you can't import @omnitron-dev/testing directly
   */
  static async createAsync(logger: ILogger, config: IProcessManagerConfig = {}): Promise<IProcessSpawner> {
    if (config.testing?.useMockSpawner === true && !MockProcessSpawnerClass) {
      try {
        // Use string variable to prevent TypeScript from validating the module path at build time
        const testingModule = '@omnitron-dev/testing/titan';
        const testing = await import(/* webpackIgnore: true */ testingModule);
        MockProcessSpawnerClass = testing.AdvancedMockProcessSpawner || testing.MockProcessSpawner;
      } catch (error) {
        logger.warn({ error }, 'Failed to load MockProcessSpawner from @omnitron-dev/testing');
      }
    }
    return ProcessSpawnerFactory.create(logger, config);
  }
}
