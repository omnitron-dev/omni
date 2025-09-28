/**
 * Unified Process Spawner
 *
 * Combines the best features from process-spawner.ts and real-process-spawner.ts
 * into a single, well-architected implementation following SOLID principles.
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
import { getAvailablePort } from '../../netron/transport/utils.js';
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
  className: string;
  modulePath: string;
  transport: ITransportConfig;
  options: IProcessOptions;
}

/**
 * Unified worker handle implementation
 */
export class UnifiedWorkerHandle implements IWorkerHandle {
  private _status: ProcessStatus = ProcessStatus.STARTING;
  private messageHandlers = new Map<string, (data: any) => void>();
  public readonly worker: Worker | ChildProcess; // Make worker public for interface compliance
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
 * Unified process spawner implementation
 */
export class UnifiedProcessSpawner implements IProcessSpawner {
  private readonly tempDir: string;
  private readonly workerRuntimePath: string;
  private readonly forkWorkerPath: string;
  private tempModules = new Map<string, string>();

  constructor(
    private readonly logger: ILogger,
    private readonly config: IProcessManagerConfig = {}
  ) {
    // Setup paths
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    this.workerRuntimePath = path.join(currentDir, 'worker-runtime.js');
    this.forkWorkerPath = path.join(currentDir, 'fork-worker.js');

    // Setup temp directory
    this.tempDir = config.tempDir || path.join(os.tmpdir(), 'titan-pm');
  }

  /**
   * Spawn a new process with the specified class
   */
  async spawn<T>(
    ProcessClass: new (...args: any[]) => T,
    options: ISpawnOptions = {}
  ): Promise<IWorkerHandle> {
    const processId = options.processId || uuidv4();
    const serviceName = options.name || ProcessClass.name;
    const serviceVersion = options.version || '1.0.0';

    // Prepare transport configuration
    const transport = await this.setupTransport(processId, options);

    // Create temporary module for the process class
    const modulePath = await this.createTemporaryModule(ProcessClass, processId);

    // Prepare worker context
    const context: IWorkerContext = {
      processId,
      className: ProcessClass.name,
      modulePath,
      transport,
      options: options as IProcessOptions
    };

    // Determine spawn strategy
    const useWorkerThreads = this.config.useWorkerThreads ?? true;
    const isolation = options.isolation || 'none';

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

      // Create Netron client for communication
      if (this.config.netron) {
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

        // Wait for worker to be ready
        await this.waitForReady(worker, useWorkerThreads);

        return new UnifiedWorkerHandle(
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
        return new UnifiedWorkerHandle(
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
      await this.cleanupTemporaryModule(processId);

      if (netronClient) {
        await netronClient.disconnect().catch(() => {});
      }

      throw error;
    }
  }

  /**
   * Cleanup spawner resources
   */
  async cleanup(): Promise<void> {
    // Cleanup all temporary modules
    for (const [processId, modulePath] of this.tempModules) {
      await this.cleanupTemporaryModule(processId);
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
    const transportType = options.transport || this.config.netron?.transport || 'unix';

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
   * Create temporary module for the process class
   */
  private async createTemporaryModule(
    ProcessClass: new (...args: any[]) => any,
    processId: string
  ): Promise<string> {
    // Ensure temp directory exists
    await fs.mkdir(this.tempDir, { recursive: true });

    // Generate module content
    const modulePath = path.join(this.tempDir, `process-${processId}.js`);
    const moduleContent = `
      // Auto-generated temporary module for ${ProcessClass.name}
      import 'reflect-metadata';

      export class ${ProcessClass.name} {
        ${this.extractClassMethods(ProcessClass)}
      }

      export default ${ProcessClass.name};
    `;

    await fs.writeFile(modulePath, moduleContent, 'utf8');
    this.tempModules.set(processId, modulePath);

    return modulePath;
  }

  /**
   * Extract class methods as string
   */
  private extractClassMethods(ProcessClass: any): string {
    // This is a simplified version - in production, you'd serialize the actual class
    // For now, we'll just create a placeholder
    return `
      constructor() {
        // Process initialization
      }

      async start() {
        // Process start logic
      }

      async stop() {
        // Process stop logic
      }
    `;
  }

  /**
   * Cleanup temporary module
   */
  private async cleanupTemporaryModule(processId: string): Promise<void> {
    const modulePath = this.tempModules.get(processId);
    if (modulePath) {
      await fs.unlink(modulePath).catch(() => {});
      this.tempModules.delete(processId);
    }
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
    if (process.env['NODE_ENV'] === 'test' || config.useMockSpawner) {
      return new MockProcessSpawner(logger, config);
    }

    // Use unified spawner for production
    return new UnifiedProcessSpawner(logger, config);
  }
}