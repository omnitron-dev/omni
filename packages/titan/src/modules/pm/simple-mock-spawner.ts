/**
 * Simple Mock Process Spawner for Testing
 *
 * This is a simplified mock spawner that doesn't use Netron at all.
 * It runs processes in the same thread for testing purposes.
 */

import { EventEmitter } from 'events';
import type { ILogger } from '../logger/logger.types.js';
import type { IProcessOptions, IProcessManagerConfig } from './types.js';
import { PROCESS_METHOD_METADATA_KEY } from './decorators.js';

/**
 * Simple mock worker that runs in the same thread
 */
export class SimpleMockWorker extends EventEmitter {
  public threadId = Math.floor(Math.random() * 10000);
  public pid = process.pid;
  private instance: any;
  public publicMethods: Map<string, Function> = new Map();

  constructor(ProcessClass: new (...args: any[]) => any) {
    super();

    // Create instance of the process class
    this.instance = new ProcessClass();

    // Extract public methods from metadata
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

    // Add health check method if it exists
    if (typeof this.instance.checkHealth === 'function') {
      this.publicMethods.set('checkHealth', this.instance.checkHealth.bind(this.instance));
    }

    // Add internal methods
    this.publicMethods.set('__getProcessMetrics', async () => ({
      cpu: 0.1,
      memory: process.memoryUsage().heapUsed,
      requests: 0,
      errors: 0,
      uptime: process.uptime()
    }));

    this.publicMethods.set('__getProcessHealth', async () => {
      if (typeof this.instance.checkHealth === 'function') {
        return await this.instance.checkHealth();
      }
      return {
        status: 'healthy' as const,
        checks: [],
        timestamp: Date.now()
      };
    });

    // Emit ready immediately
    setImmediate(() => {
      this.emit('message', { type: 'ready' });
    });
  }

  async callMethod(methodName: string, args: any[]): Promise<any> {
    const method = this.publicMethods.get(methodName);
    if (!method) {
      throw new Error(`Method ${methodName} not found or not public`);
    }
    return await method(...args);
  }

  postMessage(message: any): void {
    if (message.type === 'shutdown') {
      this.emit('exit', 0);
    }
  }

  terminate(): Promise<number> {
    this.emit('exit', 0);
    return Promise.resolve(0);
  }
}

/**
 * Simple Mock NetronClient for testing
 */
export class SimpleMockNetronClient {
  private worker: SimpleMockWorker;
  private connected = false;

  constructor(
    public processId: string,
    public logger: ILogger,
    worker: SimpleMockWorker
  ) {
    this.worker = worker;

    // Add mockCall for compatibility with ServiceProxy
    (this as any).mockCall = async (methodName: string, args: any[]) => {
      return worker.callMethod(methodName, args);
    };
  }

  async start(): Promise<void> {
    // Mock start
  }

  async connect(transportUrl: string): Promise<void> {
    this.connected = true;
  }

  async queryInterface<T>(serviceName: string): Promise<T | null> {
    // Return an object with all public methods
    const serviceStub: any = {};
    for (const [methodName, method] of this.worker.publicMethods) {
      serviceStub[methodName] = method;
    }
    return serviceStub as T;
  }

  async call(serviceName: string, methodName: string, args: any[]): Promise<any> {
    return this.worker.callMethod(methodName, args);
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
}

/**
 * Simple Mock Process Spawner for testing
 */
export class SimpleMockProcessSpawner {
  private mockWorkers = new Map<string, SimpleMockWorker>();

  constructor(
    private readonly logger: ILogger,
    private readonly config: IProcessManagerConfig = {}
  ) {}

  /**
   * Spawn a mock process (runs in same thread)
   */
  async spawn(
    ProcessClass: new (...args: any[]) => any,
    processId: string,
    options: IProcessOptions
  ): Promise<{ worker: SimpleMockWorker; netron: SimpleMockNetronClient; transportUrl: string }> {
    // Create mock worker
    const worker = new SimpleMockWorker(ProcessClass);
    this.mockWorkers.set(processId, worker);

    // Create mock NetronClient that directly calls the worker
    const netron = new SimpleMockNetronClient(processId, this.logger, worker);
    await netron.start();
    await netron.connect(`mock://${processId}`);

    const transportUrl = `mock://${processId}`;

    return { worker, netron, transportUrl };
  }

  /**
   * Clean up mock process
   */
  async cleanup(processId: string): Promise<void> {
    const worker = this.mockWorkers.get(processId);
    if (worker) {
      await worker.terminate();
      this.mockWorkers.delete(processId);
    }
  }
}