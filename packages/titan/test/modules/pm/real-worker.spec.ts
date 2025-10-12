/**
 * Tests for real worker thread spawning
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ProcessManager } from '../../../src/modules/pm/process-manager.js';
import { Process, Public } from '../../../src/modules/pm/decorators.js';
import { ProcessStatus } from '../../../src/modules/pm/types.js';
import { LoggerService } from '../../../src/modules/logger/logger.service.js';

// Create logger
const loggerService = new LoggerService({
  level: process.env.LOG_LEVEL || 'error',
  pretty: false,
});
const logger = loggerService.child({ module: 'RealWorker-Tests' });

/**
 * Simple test service for real worker tests
 */
@Process({ name: 'real-worker-test' })
class RealWorkerService {
  private counter = 0;
  private data: Map<string, any> = new Map();

  @Public()
  async increment(): Promise<number> {
    this.counter++;
    return this.counter;
  }

  @Public()
  async getCounter(): Promise<number> {
    return this.counter;
  }

  @Public()
  async setData(key: string, value: any): Promise<void> {
    this.data.set(key, value);
  }

  @Public()
  async getData(key: string): Promise<any> {
    return this.data.get(key);
  }

  @Public()
  async compute(n: number): Promise<number> {
    // CPU intensive operation
    let result = 0;
    for (let i = 0; i < n; i++) {
      result += Math.sqrt(i);
    }
    return result;
  }

  @Public()
  async throwError(message: string): Promise<void> {
    throw new Error(message);
  }
}

describe('Real Worker Thread Spawning', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager(logger, {
      useRealProcesses: true,
      useWorkerThreads: true,
      useMockSpawner: false,
    });
  });

  afterEach(async () => {
    await pm.shutdown({ force: true, timeout: 5000 });
  });

  it('should spawn a real worker thread', async () => {
    const service = await pm.spawn(RealWorkerService);

    expect(service).toBeDefined();
    expect(service.__processId).toBeDefined();

    const processInfo = pm.getProcess(service.__processId);
    expect(processInfo).toBeDefined();
    expect(processInfo?.status).toBe(ProcessStatus.RUNNING);
  });

  it('should execute methods in worker thread', async () => {
    const service = await pm.spawn(RealWorkerService);

    // Test increment
    const result1 = await service.increment();
    expect(result1).toBe(1);

    const result2 = await service.increment();
    expect(result2).toBe(2);

    const counter = await service.getCounter();
    expect(counter).toBe(2);
  });

  it('should maintain state in worker thread', async () => {
    const service = await pm.spawn(RealWorkerService);

    // Set data
    await service.setData('key1', 'value1');
    await service.setData('key2', { nested: 'object' });

    // Get data
    const value1 = await service.getData('key1');
    expect(value1).toBe('value1');

    const value2 = await service.getData('key2');
    expect(value2).toEqual({ nested: 'object' });

    const value3 = await service.getData('nonexistent');
    expect(value3).toBeUndefined();
  });

  it('should handle CPU intensive operations', async () => {
    const service = await pm.spawn(RealWorkerService);

    const result = await service.compute(100000);
    expect(result).toBeGreaterThan(0);
    expect(typeof result).toBe('number');
  });

  it('should propagate errors from worker thread', async () => {
    const service = await pm.spawn(RealWorkerService);

    await expect(service.throwError('Test error')).rejects.toThrow('Test error');

    // Worker should still be alive after error
    const counter = await service.getCounter();
    expect(counter).toBe(0);
  });

  it('should spawn multiple worker threads', async () => {
    const service1 = await pm.spawn(RealWorkerService);
    const service2 = await pm.spawn(RealWorkerService);

    // Services should be independent
    await service1.increment();
    await service1.increment();

    await service2.increment();

    const counter1 = await service1.getCounter();
    const counter2 = await service2.getCounter();

    expect(counter1).toBe(2);
    expect(counter2).toBe(1);
  });

  it('should terminate worker thread on kill', async () => {
    const service = await pm.spawn(RealWorkerService);
    const processId = service.__processId;

    // Use the worker
    await service.increment();

    // Kill the process
    const killed = await pm.kill(processId);
    expect(killed).toBe(true);

    // Process should be stopped
    const processInfo = pm.getProcess(processId);
    expect(processInfo?.status).toBe(ProcessStatus.STOPPED);
  });
});

describe('Real Worker Thread Pools', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager(logger, {
      useRealProcesses: true,
      useWorkerThreads: true,
      useMockSpawner: false,
    });
  });

  afterEach(async () => {
    await pm.shutdown({ force: true, timeout: 5000 });
  });

  it('should create a pool of real worker threads', async () => {
    const pool = await pm.pool(RealWorkerService, {
      size: 2,
    });

    expect(pool).toBeDefined();
    expect(pool.size).toBe(2);

    // Pool should work like a service
    const result1 = await pool.increment();
    const result2 = await pool.increment();

    // Results should come from different workers
    expect([result1, result2]).toContain(1);
  });

  it('should distribute load across pool workers', async () => {
    const pool = await pm.pool(RealWorkerService, {
      size: 3,
      strategy: 'round-robin' as any,
    });

    // Make multiple calls
    const results = await Promise.all([
      pool.increment(),
      pool.increment(),
      pool.increment(),
      pool.increment(),
      pool.increment(),
      pool.increment(),
    ]);

    // Each worker should have been called twice (round-robin with 3 workers)
    const counts = results.reduce(
      (acc, val) => {
        acc[val] = (acc[val] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>
    );

    // We should see values 1 and 2 from each worker
    expect(Object.keys(counts).length).toBeLessThanOrEqual(3);
  });
});
