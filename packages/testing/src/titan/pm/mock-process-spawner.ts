/**
 * Mock Process Spawner for Testing
 *
 * Optimized mock spawner that runs processes in the same thread for fast testing.
 * Implements the same interface as the real spawner for seamless switching.
 */

import { EventEmitter } from 'events';
import path from 'path';
import { generateUuidV7 } from '@omnitron-dev/titan/utils';
import { Errors } from '@omnitron-dev/titan/errors';
import type { ProcessMethod } from '@omnitron-dev/titan-pm';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type {
  IProcessSpawner,
  ISpawnOptions,
  IWorkerHandle,
  IProcessManagerConfig,
  IProcessMetrics,
  IHealthStatus,
} from '@omnitron-dev/titan-pm';
import { ProcessStatus } from '@omnitron-dev/titan-pm';
import { PROCESS_METHOD_METADATA_KEY } from '@omnitron-dev/titan-pm';

/**
 * Mock worker that runs in the same thread
 */
export class MockWorker extends EventEmitter {
  public readonly threadId = Math.floor(Math.random() * 10000);
  public readonly pid = process.pid;
  private instance: any;
  private publicMethods = new Map<string, ProcessMethod>();
  private _status: ProcessStatus = ProcessStatus.STARTING;
  private metrics: IProcessMetrics = {
    cpu: 0,
    memory: 0,
    requests: 0,
    errors: 0,
  };

  constructor(
    public readonly id: string,
    ProcessClass: new (...args: any[]) => any,
    private readonly options: ISpawnOptions = {}
  ) {
    super();

    // Create instance with options
    try {
      this.instance = new ProcessClass(options.config || {});
    } catch (_error) {
      // If instantiation fails, create a simple object
      this.instance = {};
    }

    // Extract and bind public methods
    if (ProcessClass && ProcessClass.prototype) {
      this.extractPublicMethods(ProcessClass);
    }

    // Setup internal methods
    this.setupInternalMethods();

    // Don't emit ready here - let the spawner call notifyReady() after setup
    this._status = ProcessStatus.STARTING;
  }

  /**
   * Notify that the worker is ready (called by spawner after listener is attached)
   */
  notifyReady(): void {
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
    if (!ProcessClass || !ProcessClass.prototype) {
      return;
    }

    const prototype = ProcessClass.prototype;
    const propertyNames = Object.getOwnPropertyNames(prototype);

    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      // Check if method is marked as public (supports both PM decorators and core @Method decorator)
      const pmMetadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
      const corePublic = Reflect.getMetadata('public', prototype, propertyName);

      if (pmMetadata?.public || corePublic) {
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
    this.publicMethods.set('__getProcessMetrics', async (): Promise<IProcessMetrics> => {
      if (this.metrics) this.metrics.requests = (this.metrics.requests || 0) + 1;
      return {
        ...(this.metrics || { cpu: 0, memory: 0, requests: 0, errors: 0 }),
        cpu: Math.random() * 100,
        memory: process.memoryUsage().heapUsed,
      };
    });

    this.publicMethods.set('__getProcessHealth', async (): Promise<IHealthStatus> => {
      if (this.publicMethods.has('checkHealth')) {
        const result = await this.publicMethods.get('checkHealth')!();
        // Normalize the result to IHealthStatus format
        if (result && typeof result === 'object') {
          const healthResult = result as any;
          // If it already has the correct format, return as-is
          if ('status' in healthResult && 'checks' in healthResult && 'timestamp' in healthResult) {
            return healthResult as IHealthStatus;
          }
          // Convert from test format to IHealthStatus
          const status = healthResult.status || (this._status === ProcessStatus.RUNNING ? 'healthy' : 'unhealthy');
          return {
            status: status as 'healthy' | 'degraded' | 'unhealthy',
            checks: healthResult.checks || [
              {
                name: 'checkHealth',
                status: status === 'healthy' ? 'pass' : 'fail',
                message: healthResult.message,
                details: healthResult.details,
              },
            ],
            timestamp: healthResult.timestamp || Date.now(),
          };
        }
      }

      return {
        status: this._status === ProcessStatus.RUNNING ? 'healthy' : 'unhealthy',
        checks: [
          {
            name: 'mock',
            status: 'pass',
          },
        ],
        timestamp: Date.now(),
      };
    });

    this.publicMethods.set('__destroy', async (): Promise<void> => {
      await this.terminate();
    });
  }

  /**
   * Call a method on the mock worker
   * Note: This method returns Promise<unknown> but for async generators,
   * it returns the generator directly (not wrapped in a promise)
   */
  callMethod(methodName: string, args: unknown[]): unknown {
    const method = this.publicMethods.get(methodName);
    if (!method) {
      if (this.metrics) this.metrics.errors = (this.metrics.errors || 0) + 1;
      throw Errors.notFound('Method', methodName);
    }

    try {
      if (this.metrics) this.metrics.requests = (this.metrics.requests || 0) + 1;
      const result = method(...args);

      // Check for async generator FIRST - it has Symbol.asyncIterator
      // AsyncGenerators are thenable but we should NOT await them
      if (result && typeof result === 'object' && typeof (result as any)[Symbol.asyncIterator] === 'function') {
        return result;
      }

      // If the method returns a promise (but NOT an async generator), await it
      if (
        result &&
        typeof result === 'object' &&
        'then' in result &&
        typeof (result as Promise<unknown>).then === 'function'
      ) {
        return result as Promise<unknown>;
      }

      // Return as-is for sync values
      return result;
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
      } catch (_error) {
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
    this.proxy = new Proxy(
      {},
      {
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

          // Convert property to string
          const methodName = String(property);

          // Check if this should be a streaming method
          // Methods that include 'Stream' or start with 'stream' may return AsyncIterables
          const isStreamMethod = methodName.startsWith('stream') || methodName.toLowerCase().includes('stream');

          if (isStreamMethod) {
            const workerInstance = this.worker;
            // For streaming methods, we need to detect if the result is actually an async generator
            // Some methods like "processStream" contain "stream" but return Promise<T>, not AsyncGenerator

            return (...args: any[]): any => {
              // Call the method
              const result = workerInstance.callMethod(methodName, args);

              const anyResult = result as any;

              // If result is already an async iterable (AsyncGenerator), return it directly
              if (anyResult && typeof anyResult[Symbol.asyncIterator] === 'function') {
                return anyResult;
              }

              // If result is a sync iterable (but NOT a Promise), convert to async generator
              if (
                anyResult &&
                typeof anyResult[Symbol.iterator] === 'function' &&
                typeof anyResult.then !== 'function'
              ) {
                // eslint-disable-next-line func-names
                return (async function* () {
                  yield* anyResult;
                })();
              }

              // If it's a Promise, we need to check what it resolves to
              if (anyResult && typeof anyResult.then === 'function') {
                // Return a Promise that resolves to the actual value
                // If the resolved value is an async iterable, wrap it properly
                return (async () => {
                  const resolved = await anyResult;
                  // If resolved is an async iterable, we can't return it directly from an async function
                  // because the caller expects to iterate over the result of the original call
                  // For methods that return Promise<AsyncIterable>, this is a limitation
                  // But for methods that return Promise<T> (like processStream -> Promise<number[]>),
                  // we just return the resolved value
                  if (resolved && typeof resolved[Symbol.asyncIterator] === 'function') {
                    // Can't properly handle Promise<AsyncIterable> in mock - return as-is
                    return resolved;
                  }
                  return resolved;
                })();
              }

              // Otherwise return as-is
              return result;
            };
          }

          // Return async method wrapper
          return async (...args: any[]) => this.worker.callMethod(methodName, args);
        },

        has: (target, property) => {
          // Report that we have the special control methods
          const controlMethods = ['__processId', '__destroy', '__getMetrics', '__getHealth'];
          if (typeof property === 'string' && controlMethods.includes(property)) {
            return true;
          }
          // All other methods are assumed to be available
          return typeof property === 'string';
        },
      }
    );
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
    processPathOrClass: string | (new (...args: any[]) => T),
    options: ISpawnOptions = {}
  ): Promise<IWorkerHandle> {
    const processId = options.processId || generateUuidV7();

    let ProcessClass: new (...args: any[]) => T;
    let serviceName: string;

    if (typeof processPathOrClass === 'string') {
      // For file paths, we need to load the module
      // In mock spawner, we'll try to import it dynamically
      try {
        const module = await import(processPathOrClass);
        if (module.default) {
          ProcessClass = module.default;
        } else {
          const keys = Object.keys(module);
          const firstKey = keys[0];
          if (firstKey && module[firstKey]) {
            ProcessClass = module[firstKey];
          } else {
            throw Errors.notFound('Default export', 'process file');
          }
        }
        serviceName = options.name || path.basename(processPathOrClass, '.js');
      } catch (_error) {
        // If import fails in test, create a simple mock class
        ProcessClass = class MockProcess {
          constructor() {}
        } as any;
        serviceName = options.name || 'MockProcess';
      }
    } else {
      ProcessClass = processPathOrClass;
      serviceName = options.name || ProcessClass.name;
    }

    const serviceVersion = options.version || '1.0.0';
    const transportUrl = `mock://${processId}`;

    // Create mock worker
    const worker = new MockWorker(processId, ProcessClass, options);
    this.workers.set(processId, worker);

    // Create handle
    const handle = new MockWorkerHandle(processId, worker, transportUrl, serviceName, serviceVersion, this.logger);

    // Wait for ready - set up listener FIRST, then trigger ready
    const readyPromise = new Promise<void>((resolve) => {
      worker.once('message', (data) => {
        if (data.type === 'ready') {
          resolve();
        }
      });
    });

    // Now trigger the ready event (after listener is attached)
    worker.notifyReady();

    await readyPromise;
    return handle;
  }

  /**
   * Cleanup spawner resources
   */
  async cleanup(): Promise<void> {
    // Terminate all workers
    for (const [_id, worker] of this.workers) {
      await worker.terminate();
    }
    this.workers.clear();
  }
}

/**
 * Export the old name for backward compatibility
 */
export { MockProcessSpawner as SimpleMockProcessSpawner };
