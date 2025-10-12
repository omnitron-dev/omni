/**
 * Mock Process Spawner for Testing
 *
 * This spawner runs processes in the same thread for testing purposes.
 * It maintains the same interface but doesn't actually spawn separate processes.
 */

import { EventEmitter } from 'events';
import { Netron } from '../../netron/index.js';
import { Errors } from '../../errors/index.js';
import type { ProcessMethod } from './common-types.js';
import type { ILogger } from '../logger/logger.types.js';
import type { IProcessOptions, IProcessManagerConfig } from './types.js';
import { PROCESS_METHOD_METADATA_KEY } from './decorators.js';

/**
 * Mock worker that runs in the same thread
 */
class MockWorker extends EventEmitter {
  public threadId = Math.floor(Math.random() * 10000);
  public pid = process.pid;
  private instance: any;
  private publicMethods: Map<string, ProcessMethod> = new Map();

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
      uptime: process.uptime(),
    }));

    this.publicMethods.set('__getProcessHealth', async () => {
      if (typeof this.instance.checkHealth === 'function') {
        return await this.instance.checkHealth();
      }
      return {
        status: 'healthy' as const,
        checks: [],
        timestamp: Date.now(),
      };
    });

    // Emit ready after a small delay
    setImmediate(() => {
      this.emit('message', { type: 'ready' });
    });
  }

  async callMethod(methodName: string, args: any[]): Promise<any> {
    const method = this.publicMethods.get(methodName);
    if (!method) {
      throw Errors.notFound('Method', methodName);
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
 * Mock Process Spawner for testing
 */
export class MockProcessSpawner {
  private mockWorkers = new Map<string, MockWorker>();

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
  ): Promise<{ worker: MockWorker; netron: Netron; transportUrl: string }> {
    // Create mock worker
    const worker = new MockWorker(ProcessClass);
    this.mockWorkers.set(processId, worker);

    // Create mock Netron that directly calls the worker
    const netron = new Netron(this.logger as any, {
      id: `mock-${processId}`,
    });

    // Override Netron's call method to directly call the worker
    (netron as any).mockCall = async (methodName: string, args: any[]) => worker.callMethod(methodName, args);

    // Create a mock peer
    (netron as any).peer = {
      call: async (serviceName: string, methodName: string, args: any[]) => worker.callMethod(methodName, args),
      expose: async () => {},
      start: async () => {},
      stop: async () => {},
      connect: async () => {},
      disconnect: async () => {},
      listen: async () => {},
    };

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
