/**
 * Process Manager Tests
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Process, Public, RateLimit, HealthCheck } from '../../../src/modules/pm/decorators.js';
import { ProcessManager } from '../../../src/modules/pm/process-manager.js';
import { ProcessPool } from '../../../src/modules/pm/process-pool.js';
import { ProcessStatus } from '../../../src/modules/pm/types.js';
import type { ServiceProxy } from '../../../src/modules/pm/types.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(() => mockLogger)
} as any;

// Test process class
@Process({
  name: 'test-service',
  version: '1.0.0'
})
class TestService {
  private counter = 0;

  @Public()
  async increment(): Promise<number> {
    return ++this.counter;
  }

  @Public()
  async getCount(): Promise<number> {
    return this.counter;
  }

  @Public()
  @RateLimit({ rps: 10 })
  async limitedMethod(): Promise<string> {
    return 'limited';
  }

  @HealthCheck()
  async checkHealth() {
    return {
      status: 'healthy' as const,
      checks: [{
        name: 'test',
        status: 'pass' as const
      }]
    };
  }
}

// Test process with streaming
@Process()
class StreamingService {
  @Public()
  async *generateNumbers(max: number): AsyncGenerator<number> {
    for (let i = 0; i < max; i++) {
      yield i;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

describe('ProcessManager', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager(mockLogger as any, {
      useMockSpawner: true,  // Force mock spawner for tests
      netron: {
        transport: 'unix',
        discovery: 'local'
      }
    });
  });

  afterEach(async () => {
    await pm.shutdown({ force: true });
  });

  describe('Process Spawning', () => {
    it('should spawn a process as a service', async () => {
      const service = await pm.spawn(TestService);

      expect(service).toBeDefined();
      expect(service.__processId).toBeDefined();
      expect(typeof service.increment).toBe('function');
      expect(typeof service.getCount).toBe('function');
    });

    it('should handle method calls via proxy', async () => {
      const service = await pm.spawn(TestService);

      const result1 = await service.increment();
      expect(result1).toBe(1);

      const result2 = await service.increment();
      expect(result2).toBe(2);

      const count = await service.getCount();
      expect(count).toBe(2);
    });

    it('should track process information', async () => {
      const service = await pm.spawn(TestService);
      const processId = service.__processId;

      const processInfo = pm.getProcess(processId);
      expect(processInfo).toBeDefined();
      expect(processInfo?.status).toBe(ProcessStatus.RUNNING);
      expect(processInfo?.name).toBe('test-service');
    });

    it('should list all processes', async () => {
      const service1 = await pm.spawn(TestService);
      const service2 = await pm.spawn(TestService);

      const processes = pm.listProcesses();
      expect(processes.length).toBeGreaterThanOrEqual(2);
      expect(processes.some(p => p.id === service1.__processId)).toBe(true);
      expect(processes.some(p => p.id === service2.__processId)).toBe(true);
    });
  });

  describe('Process Lifecycle', () => {
    it('should kill a process', async () => {
      const service = await pm.spawn(TestService);
      const processId = service.__processId;

      const killed = await pm.kill(processId);
      expect(killed).toBe(true);

      const processInfo = pm.getProcess(processId);
      expect(processInfo?.status).toBe(ProcessStatus.STOPPED);
    });

    it('should handle graceful shutdown', async () => {
      const service1 = await pm.spawn(TestService);
      const service2 = await pm.spawn(TestService);

      await pm.shutdown();

      const processes = pm.listProcesses();
      expect(processes.every(p => p.status === ProcessStatus.STOPPED)).toBe(true);
    });

    it('should handle forced shutdown', async () => {
      const service = await pm.spawn(TestService);

      await pm.shutdown({ force: true, timeout: 1000 });

      const processes = pm.listProcesses();
      expect(processes.every(p => p.status === ProcessStatus.STOPPED)).toBe(true);
    });
  });

  describe('Health Monitoring', () => {
    it('should get health status', async () => {
      const service = await pm.spawn(TestService, {
        health: { enabled: true, interval: 1000 }
      });

      const health = await pm.getHealth(service.__processId);
      expect(health).toBeDefined();
      expect(health?.status).toBe('healthy');
      expect(health?.checks).toHaveLength(1);
    });

    it('should get metrics', async () => {
      const service = await pm.spawn(TestService, {
        observability: { metrics: true }
      });

      const metrics = await pm.getMetrics(service.__processId);
      expect(metrics).toBeDefined();
      expect(metrics?.cpu).toBeGreaterThanOrEqual(0);
      expect(metrics?.memory).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Service Discovery', () => {
    it('should discover services by name', async () => {
      const service = await pm.spawn(TestService, {
        name: 'discoverable-service'
      });

      const discovered = await pm.discover<TestService>('discoverable-service');
      expect(discovered).toBeDefined();
      expect(discovered?.__processId).toBe(service.__processId);
    });

    it('should return null for non-existent services', async () => {
      const discovered = await pm.discover('non-existent');
      expect(discovered).toBeNull();
    });
  });
});

describe('ProcessPool', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager(mockLogger as any, {
      useMockSpawner: true  // Force mock spawner for tests
    });
  });

  afterEach(async () => {
    await pm.shutdown({ force: true });
  });

  describe('Pool Creation', () => {
    it('should create a process pool', async () => {
      const pool = await pm.pool(TestService, { size: 2 });

      expect(pool).toBeDefined();
      expect(pool.size).toBe(2);
      expect(pool.metrics).toBeDefined();
    });

    it('should handle pool method calls', async () => {
      const pool = await pm.pool(TestService, { size: 2 });

      const results = await Promise.all([
        pool.increment(),
        pool.increment(),
        pool.increment()
      ]);

      // Results should come from different workers
      expect(results).toContain(1);
      expect(results.filter(r => r === 1).length).toBeGreaterThan(0);
    });

    it('should scale pool up', async () => {
      const pool = await pm.pool(TestService, { size: 2 });
      expect(pool.size).toBe(2);

      await pool.scale(4);
      expect(pool.size).toBe(4);
    });

    it('should scale pool down', async () => {
      const pool = await pm.pool(TestService, { size: 4 });
      expect(pool.size).toBe(4);

      await pool.scale(2);
      expect(pool.size).toBe(2);
    });

    it('should auto-size pool based on CPU cores', async () => {
      const pool = await pm.pool(TestService, { size: 'auto' });
      expect(pool.size).toBeGreaterThan(0);
    });
  });

  describe('Load Balancing', () => {
    it('should use round-robin strategy', async () => {
      const pool = await pm.pool(TestService, {
        size: 2,
        strategy: 'round-robin' as any
      });

      const results = [];
      for (let i = 0; i < 4; i++) {
        results.push(await pool.getCount());
      }

      // Should alternate between workers
      expect(new Set(results).size).toBeGreaterThan(1);
    });

    it('should track pool metrics', async () => {
      const pool = await pm.pool(TestService, {
        size: 2,
        metrics: true
      });

      await Promise.all([
        pool.increment(),
        pool.increment()
      ]);

      const metrics = pool.metrics;
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(2);
      expect(metrics.activeWorkers).toBeGreaterThan(0);
    });
  });

  describe('Pool Lifecycle', () => {
    it('should drain pool', async () => {
      const pool = await pm.pool(TestService, { size: 2 });

      await pool.drain();
      // Pool should stop accepting new requests
      expect(pool).toBeDefined();
    });

    it('should destroy pool', async () => {
      const pool = await pm.pool(TestService, { size: 2 });

      await pool.destroy();
      expect(pool.size).toBe(0);
    });
  });
});

describe('Streaming', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager(mockLogger as any, {
      useMockSpawner: true  // Force mock spawner for tests
    });
  });

  afterEach(async () => {
    await pm.shutdown({ force: true });
  });

  it('should handle streaming methods', async () => {
    const service = await pm.spawn(StreamingService);

    const results = [];
    for await (const value of service.generateNumbers(5)) {
      results.push(value);
    }

    expect(results).toEqual([0, 1, 2, 3, 4]);
  });
});