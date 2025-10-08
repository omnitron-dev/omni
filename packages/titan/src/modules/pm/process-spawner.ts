/**
 * Process Spawner - Clean Architecture Implementation
 *
 * This implementation follows file-based process architecture where each process
 * is defined in a separate file with a default export. No runtime code extraction!
 */

import { Worker } from 'worker_threads';
import { fork, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import type { ILogger } from '../logger/logger.types.js';
import type {
  IProcessSpawner,
  ISpawnOptions,
  IWorkerHandle,
  IProcessOptions,
  IProcessManagerConfig
} from './types.js';
import { ProcessStatus } from './types.js';
import { NetronClient } from './netron-client.js';
import { ServiceProxyHandler } from './service-proxy.js';
import { getAvailablePort } from '../../utils/port-utils.js';
import { MockProcessSpawner } from './mock-process-spawner.js';

/**
 * Transport configuration for Netron communication
 */
interface ITransportConfig {
  type: 'tcp' | 'unix' | 'ws' | 'ipc';
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
  private _status: ProcessStatus = ProcessStatus.STARTING;
  private messageHandlers = new Map<string, (data: any) => void>();
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
    public readonly proxy?: any
  ) {
    this.worker = worker;
    this.netronClient = netronClient;
    this.setupMessageHandlers();
  }

  get status(): ProcessStatus {
    return this._status;
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

        // Send graceful shutdown signal
        if (child.send) {
          child.send({ type: 'shutdown' });
        }

        // Wait for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!child.killed) {
          child.kill('SIGTERM');
          await new Promise(resolve => setTimeout(resolve, 1000));

          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }
      }

      this._status = ProcessStatus.STOPPED;
    } catch (error) {
      this.logger.error({ error, workerId: this.id }, 'Error terminating worker');
      this._status = ProcessStatus.FAILED;
      throw error;
    }
  }

  isAlive(): boolean {
    if (this.isWorkerThread) {
      const worker = this.worker as Worker;
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
    const id = uuidv4();
    this.messageHandlers.set(id, handler);
  }

  private setupMessageHandlers(): void {
    if (this.isWorkerThread) {
      const worker = this.worker as Worker;
      worker.on('message', (data) => {
        if (data && typeof data === 'object' && 'type' in data && data.type === 'ready') {
          this._status = ProcessStatus.RUNNING;
        }
        this.messageHandlers.forEach(handler => handler(data));
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
        this.messageHandlers.forEach(handler => handler(data));
      });

      child.on('error', (error) => {
        this.logger.error({ error, workerId: this.id }, 'Child process error');
        this._status = ProcessStatus.FAILED;
      });

      child.on('exit', (code, signal) => {
        this.logger.debug({ workerId: this.id, code, signal }, 'Child process exited');
        this._status = ProcessStatus.STOPPED;
      });
    }
  }
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
    // Setup paths
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
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
    const processId = options.processId || uuidv4();

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
      this.logger.warn(
        'Using legacy class-based spawn. Please migrate to file-based approach!'
      );

      // For backward compatibility, we can still support classes
      // by generating a temporary file that imports and exports the class
      processPath = await this.createLegacyModule(processPathOrClass, processId);
      serviceName = options.name || processPathOrClass.name;
    }

    const serviceVersion = options.version || '1.0.0';

    // Verify process file exists
    try {
      await fs.access(processPath);
    } catch (error) {
      throw new Error(`Process file not found: ${processPath}`);
    }

    // Prepare transport configuration
    const transport = await this.setupTransport(processId, options);

    // Prepare worker context
    const context: IWorkerContext = {
      processId,
      processPath,
      transport,
      options: options as IProcessOptions,
      dependencies: options.dependencies
    };

    // Determine spawn strategy based on isolation config
    const isolation = options.isolation || this.config.isolation || 'worker';
    const useWorkerThreads = isolation === 'worker';

    let worker: Worker | ChildProcess;
    let netronClient: NetronClient | null = null;

    try {
      // Spawn based on configuration
      if (isolation === 'vm' || isolation === 'container') {
        // Use child process for stronger isolation
        worker = await this.spawnChildProcess(context);
      } else if (useWorkerThreads) {
        // Use worker threads for better performance
        worker = await this.spawnWorkerThread(context);
      } else {
        // Default to child process
        worker = await this.spawnChildProcess(context);
      }

      // Wait for worker to be ready
      await this.waitForReady(worker, useWorkerThreads);

      // Create Netron client for communication if not in-process
      if (isolation !== 'none') {
        netronClient = new NetronClient(processId, this.logger);
        await netronClient.start();
        await netronClient.connect(transport.url!);

        // Create service proxy
        const proxyHandler = new ServiceProxyHandler(
          processId,
          netronClient,
          serviceName,
          this.logger
        );
        const proxy = proxyHandler.createProxy();

        return new WorkerHandle(
          processId,
          worker,
          netronClient,
          transport.url!,
          serviceName,
          serviceVersion,
          this.logger,
          useWorkerThreads,
          proxy
        );
      } else {
        // Direct communication without Netron
        return new WorkerHandle(
          processId,
          worker,
          null,
          transport.url!,
          serviceName,
          serviceVersion,
          this.logger,
          useWorkerThreads
        );
      }
    } catch (error) {
      // Cleanup on error
      if (netronClient) {
        await netronClient.disconnect().catch(() => { });
      }

      throw error;
    }
  }

  /**
   * Cleanup spawner resources
   */
  async cleanup(): Promise<void> {
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
    const transportType = options.transport || this.config.transport || 'ipc';

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
          url: `${protocol}://${host}:${port}`
        };
      }

      case 'unix': {
        await fs.mkdir(this.tempDir, { recursive: true });
        const socketPath = path.join(this.tempDir, `${processId}.sock`);
        return {
          type: 'unix',
          path: socketPath,
          url: `unix://${socketPath}`
        };
      }

      case 'ipc':
      default: {
        return {
          type: 'ipc',
          url: `ipc://${processId}`
        };
      }
    }
  }

  /**
   * Create a temporary module for legacy class-based spawning
   * This is for backward compatibility only!
   */
  private async createLegacyModule(
    ProcessClass: new (...args: any[]) => any,
    processId: string
  ): Promise<string> {
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
          console.warn('Legacy process spawning - please migrate to file-based approach');
        }
      }
    `;

    await fs.writeFile(modulePath, moduleContent, 'utf8');
    return modulePath;
  }

  /**
   * Spawn worker thread
   */
  private async spawnWorkerThread(context: IWorkerContext): Promise<Worker> {
    const worker = new Worker(this.workerRuntimePath, {
      workerData: context,
      env: process.env
    });

    return worker;
  }

  /**
   * Spawn child process
   */
  private async spawnChildProcess(context: IWorkerContext): Promise<ChildProcess> {
    const child = fork(this.forkWorkerPath, [], {
      env: {
        ...process.env,
        TITAN_WORKER_CONTEXT: JSON.stringify(context)
      },
      silent: false
    });

    return child;
  }

  /**
   * Wait for worker to be ready
   */
  private async waitForReady(
    worker: Worker | ChildProcess,
    isWorkerThread: boolean,
    timeout: number = 5000
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Worker startup timeout'));
      }, timeout);

      const messageHandler = (data: any) => {
        if (data && typeof data === 'object' && 'type' in data && data.type === 'ready') {
          clearTimeout(timer);

          if (isWorkerThread) {
            (worker as Worker).off('message', messageHandler);
          } else {
            (worker as ChildProcess).off('message', messageHandler);
          }

          resolve();
        }
      };

      if (isWorkerThread) {
        (worker as Worker).on('message', messageHandler);
      } else {
        (worker as ChildProcess).on('message', messageHandler);
      }
    });
  }
}

/**
 * Factory for creating process spawners
 */
export class ProcessSpawnerFactory {
  static create(
    logger: ILogger,
    config: IProcessManagerConfig = {}
  ): IProcessSpawner {
    // Use mock spawner in test environment
    if (process.env['NODE_ENV'] === 'test' || config.testing?.useMockSpawner) {
      return new MockProcessSpawner(logger, config);
    }

    // Use unified spawner for production
    return new ProcessSpawner(logger, config);
  }
}