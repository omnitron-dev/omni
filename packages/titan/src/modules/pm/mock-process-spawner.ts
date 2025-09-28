/**
 * Mock Process Spawner for Testing
 *
 * Optimized mock spawner that runs processes in the same thread for fast testing.
 * Implements the same interface as the real spawner for seamless switching.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { ILogger } from '../logger/logger.types.js';
import type {
  IProcessSpawner,
  ISpawnOptions,
  IWorkerHandle,
  IProcessManagerConfig,
  IProcessMetrics,
  IHealthStatus
} from './types.js';
import { ProcessStatus } from './types.js';
import { PROCESS_METHOD_METADATA_KEY } from './decorators.js';

/**
 * Mock worker that runs in the same thread
 */
export class MockWorker extends EventEmitter {
  public readonly threadId = Math.floor(Math.random() * 10000);
  public readonly pid = process.pid;
  private instance: any;
  private publicMethods = new Map<string, Function>();
  private _status: ProcessStatus = ProcessStatus.STARTING;
  private metrics: IProcessMetrics = {
    cpu: 0,
    memory: 0,
    requests: 0,
    errors: 0
  };

  constructor(
    public readonly id: string,
    ProcessClass: new (...args: any[]) => any,
    private readonly options: ISpawnOptions = {}
  ) {
    super();

    // Create instance with options
    this.instance = new ProcessClass(options.config || {});

    // Extract and bind public methods
    this.extractPublicMethods(ProcessClass);

    // Setup internal methods
    this.setupInternalMethods();

    // Emit ready immediately
    setImmediate(() => {
      this._status = ProcessStatus.RUNNING;
      this.emit('message', { type: 'ready' });
    });
  }

  get status(): ProcessStatus {
    return this._status;
  }

  /**
   * Extract public methods from the process class
   */
  private extractPublicMethods(ProcessClass: new (...args: any[]) => any): void {
    const prototype = ProcessClass.prototype;
    const propertyNames = Object.getOwnPropertyNames(prototype);

    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      // Check if method is marked as public
      const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
      if (metadata?.public) {
        this.publicMethods.set(propertyName, descriptor.value.bind(this.instance));
      }
    }

    // Add special methods if they exist
    const specialMethods = ['checkHealth', 'onShutdown', 'getMetrics'];
    for (const method of specialMethods) {
      if (typeof this.instance[method] === 'function') {
        this.publicMethods.set(method, this.instance[method]!.bind(this.instance));
      }
    }
  }

  /**
   * Setup internal process management methods
   */
  private setupInternalMethods(): void {
    const self = this; // Capture this for use in async functions

    this.publicMethods.set('__getProcessMetrics', async (): Promise<IProcessMetrics> => {
      if (self.metrics) self.metrics.requests = (self.metrics.requests || 0) + 1;
      return {
        ...(self.metrics || { cpu: 0, memory: 0, requests: 0, errors: 0 }),
        cpu: Math.random() * 100,
        memory: process.memoryUsage().heapUsed
      };
    });

    this.publicMethods.set('__getProcessHealth', async (): Promise<IHealthStatus> => {
      if (self.publicMethods.has('checkHealth')) {
        return await self.publicMethods.get('checkHealth')!();
      }

      return {
        status: self._status === ProcessStatus.RUNNING ? 'healthy' : 'unhealthy',
        checks: [{
          name: 'mock',
          status: 'pass'
        }],
        timestamp: Date.now()
      };
    });

    this.publicMethods.set('__destroy', async (): Promise<void> => {
      await self.terminate();
    });
  }

  /**
   * Call a method on the mock worker
   */
  async callMethod(methodName: string, args: any[]): Promise<any> {
    const method = this.publicMethods.get(methodName);
    if (!method) {
      if (this.metrics) this.metrics.errors = (this.metrics.errors || 0) + 1;
      throw new Error(`Method ${methodName} not found or not public`);
    }

    try {
      if (this.metrics) this.metrics.requests = (this.metrics.requests || 0) + 1;
      return await method(...args);
    } catch (error) {
      if (this.metrics) this.metrics.errors = (this.metrics.errors || 0) + 1;
      throw error;
    }
  }

  /**
   * Send message to the mock worker
   */
  postMessage(message: any): void {
    setImmediate(() => {
      if (message.type === 'shutdown') {
        this.terminate();
      } else {
        this.emit('message', { type: 'response', data: message });
      }
    });
  }

  /**
   * Terminate the mock worker
   */
  async terminate(): Promise<void> {
    this._status = ProcessStatus.STOPPING;

    // Call onShutdown if available
    if (this.publicMethods.has('onShutdown')) {
      try {
        await this.publicMethods.get('onShutdown')!();
      } catch (error) {
        // Ignore shutdown errors
      }
    }

    this._status = ProcessStatus.STOPPED;
    this.emit('exit', 0);
  }
}

/**
 * Mock Netron client for testing
 */
export class MockNetronClient {
  private connected = false;
  private worker: MockWorker;

  constructor(
    public readonly processId: string,
    public readonly logger: ILogger,
    worker: MockWorker
  ) {
    this.worker = worker;
  }

  async start(): Promise<void> {
    // Mock start
  }

  async connect(url: string): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async stop(): Promise<void> {
    await this.disconnect();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async call(service: string, method: string, args: any[]): Promise<any> {
    return this.worker.callMethod(method, args);
  }

  // Add mockCall for compatibility
  async mockCall(method: string, args: any[]): Promise<any> {
    return this.worker.callMethod(method, args);
  }
}

/**
 * Mock worker handle implementation
 */
export class MockWorkerHandle implements IWorkerHandle {
  public readonly proxy: any;
  public readonly netronClient: MockNetronClient;
  public readonly worker: MockWorker;

  constructor(
    public readonly id: string,
    worker: MockWorker,
    public readonly transportUrl: string,
    public readonly serviceName: string,
    public readonly serviceVersion: string,
    private readonly logger: ILogger
  ) {
    this.worker = worker;
    // Create mock Netron client
    this.netronClient = new MockNetronClient(id, logger, worker);

    // Create proxy for method calls
    this.proxy = new Proxy({}, {
      get: (target, property: string | symbol) => {
        // Handle control methods
        if (property === '__processId') {
          return this.id;
        }

        if (property === '__destroy') {
          return () => this.terminate();
        }

        if (property === '__getMetrics') {
          return () => this.worker.callMethod('__getProcessMetrics', []);
        }

        if (property === '__getHealth') {
          return () => this.worker.callMethod('__getProcessHealth', []);
        }

        // Handle Promise-like properties
        if (property === 'then' || property === 'catch' || property === 'finally') {
          return undefined;
        }

        // Handle symbols
        if (typeof property === 'symbol') {
          return undefined;
        }

        // Return async method wrapper
        return async (...args: any[]) => {
          return this.worker.callMethod(String(property), args);
        };
      }
    });
  }

  get status(): ProcessStatus {
    return this.worker.status;
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }

  isAlive(): boolean {
    return this.worker.status === ProcessStatus.RUNNING;
  }

  async send(message: any): Promise<void> {
    this.worker.postMessage(message);
  }

  onMessage(handler: (data: any) => void): void {
    this.worker.on('message', handler);
  }
}

/**
 * Mock process spawner for testing
 */
export class MockProcessSpawner implements IProcessSpawner {
  private workers = new Map<string, MockWorker>();

  constructor(
    private readonly logger: ILogger,
    private readonly config: IProcessManagerConfig = {}
  ) {}

  /**
   * Spawn a mock process
   */
  async spawn<T>(
    ProcessClass: new (...args: any[]) => T,
    options: ISpawnOptions = {}
  ): Promise<IWorkerHandle> {
    const processId = options.processId || uuidv4();
    const serviceName = options.name || ProcessClass.name;
    const serviceVersion = options.version || '1.0.0';
    const transportUrl = `mock://${processId}`;

    // Create mock worker
    const worker = new MockWorker(processId, ProcessClass, options);
    this.workers.set(processId, worker);

    // Create handle
    const handle = new MockWorkerHandle(
      processId,
      worker,
      transportUrl,
      serviceName,
      serviceVersion,
      this.logger
    );

    // Wait for ready
    await new Promise<void>((resolve) => {
      worker.once('message', (data) => {
        if (data.type === 'ready') {
          resolve();
        }
      });
    });

    return handle;
  }

  /**
   * Cleanup spawner resources
   */
  async cleanup(): Promise<void> {
    // Terminate all workers
    for (const [id, worker] of this.workers) {
      await worker.terminate();
    }
    this.workers.clear();
  }
}

/**
 * Export the old name for backward compatibility
 */
export { MockProcessSpawner as SimpleMockProcessSpawner };