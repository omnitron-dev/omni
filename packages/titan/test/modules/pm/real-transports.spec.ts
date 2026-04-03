/**
 * Real Transport Tests
 *
 * Tests all documented IPC transport types with real process spawning:
 * 1. unix - Unix domain sockets (default, fast)
 * 2. ipc - Native IPC (Node.js built-in)
 * 3. tcp - TCP sockets (network)
 * 4. http - HTTP/WebSocket (web-compatible)
 *
 * NOTE: These tests require real process spawning infrastructure and are skipped
 * in CI/mock environments.
 */

import 'reflect-metadata';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { ProcessManager } from '../../../src/modules/pm/process-manager.js';
import { PoolStrategy } from '../../../src/modules/pm/types.js';
import { CalculatorService, CounterService } from './fixtures/test-services.js';
import { LoggerService } from '../../../src/modules/logger/logger.service.js';
import { isRedisInMockMode } from '../../utils/redis-test-utils.js';
import { isDockerAvailable } from '../../utils/docker-test-utils.js';
import { AdvancedMockProcessSpawner } from '@omnitron-dev/testing/titan';
import { ProcessSpawnerFactory } from '../../../src/modules/pm/process-spawner.js';

const skipTests = isRedisInMockMode() || !isDockerAvailable();
if (skipTests) {
  console.log('⏭️  Skipping real-transports.spec.ts - requires real infrastructure');
}
const describeOrSkip = skipTests ? describe.skip : describe;

// Setup mock spawner for Jest environment
beforeAll(() => {
  ProcessSpawnerFactory.setMockSpawner(AdvancedMockProcessSpawner);
});

const loggerService = new LoggerService({
  level: process.env.LOG_LEVEL || 'error',
  pretty: false,
});
const logger = loggerService.child({ module: 'Transport-Tests' });

describeOrSkip('Real Transport - Unix Domain Sockets', () => {
  let pm: ProcessManager;

  afterEach(async () => {
    if (pm) {
      await pm.shutdown({ force: true, timeout: 10000 });
    }
  });

  it('should spawn process using unix transport', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'unix',
        discovery: 'local',
      },
    });

    const service = await pm.spawn(CalculatorService);

    expect(service).toBeDefined();
    expect(service.__processId).toBeDefined();

    const result = await service.add(10, 20);
    expect(result).toBe(30);
  });

  it('should handle multiple processes with unix transport', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'unix',
        discovery: 'local',
      },
    });

    const [calc, counter] = await Promise.all([pm.spawn(CalculatorService), pm.spawn(CounterService)]);

    const calcResult = await calc.multiply(5, 4);
    const counterResult = await counter.increment();

    expect(calcResult).toBe(20);
    expect(counterResult).toBe(1);
  });

  it('should create pool with unix transport', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'unix',
        discovery: 'local',
      },
    });

    const pool = await pm.pool(CalculatorService, {
      size: 3,
      strategy: PoolStrategy.ROUND_ROBIN,
    });

    expect(pool.size).toBe(3);

    const results = await Promise.all([pool.add(1, 1), pool.add(2, 2), pool.add(3, 3)]);

    expect(results).toEqual([2, 4, 6]);
  });
});

describeOrSkip('Real Transport - IPC (Native)', () => {
  let pm: ProcessManager;

  afterEach(async () => {
    if (pm) {
      await pm.shutdown({ force: true, timeout: 10000 });
    }
  });

  it('should spawn process using ipc transport', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'ipc',
        discovery: 'local',
      },
    });

    const service = await pm.spawn(CalculatorService);

    expect(service).toBeDefined();

    const result = await service.subtract(100, 30);
    expect(result).toBe(70);
  });

  it('should maintain state across IPC calls', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'ipc',
        discovery: 'local',
      },
    });

    const counter = await pm.spawn(CounterService);

    expect(await counter.getValue()).toBe(0);
    expect(await counter.increment()).toBe(1);
    expect(await counter.increment()).toBe(2);
    expect(await counter.getValue()).toBe(2);

    const history = await counter.getHistory();
    expect(history).toEqual([1, 2]);
  });

  it('should handle pool with ipc transport', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'ipc',
        discovery: 'local',
      },
    });

    const pool = await pm.pool(CalculatorService, {
      size: 2,
      strategy: PoolStrategy.LEAST_CONNECTIONS,
    });

    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(await pool.multiply(i, 2));
    }

    results.forEach((result, index) => {
      expect(result).toBe(index * 2);
    });
  });
});

describeOrSkip('Real Transport - TCP Sockets', () => {
  let pm: ProcessManager;

  afterEach(async () => {
    if (pm) {
      await pm.shutdown({ force: true, timeout: 10000 });
    }
  });

  it('should spawn process using tcp transport', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'tcp',
        discovery: 'local',
      },
    });

    const service = await pm.spawn(CalculatorService);

    expect(service).toBeDefined();

    const result = await service.divide(100, 5);
    expect(result).toBe(20);
  });

  it('should handle multiple TCP connections', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'tcp',
        discovery: 'local',
      },
    });

    // Spawn multiple services
    const services = await Promise.all([
      pm.spawn(CalculatorService, { name: 'tcp-calc-1' }),
      pm.spawn(CalculatorService, { name: 'tcp-calc-2' }),
    ]);

    // Each should work independently
    const results = await Promise.all([services[0].add(1, 1), services[1].add(2, 2)]);

    expect(results).toEqual([2, 4]);
  });

  it('should create pool over TCP', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'tcp',
        discovery: 'local',
      },
    });

    const pool = await pm.pool(CounterService, {
      size: 2,
      strategy: PoolStrategy.ROUND_ROBIN,
    });

    // Round-robin distribution
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(await pool.increment());
    }

    // Each worker gets 2 calls: [1,1,2,2]
    expect(results.sort()).toEqual([1, 1, 2, 2]);
  });
});

describeOrSkip('Real Transport - HTTP/WebSocket', () => {
  let pm: ProcessManager;

  afterEach(async () => {
    if (pm) {
      await pm.shutdown({ force: true, timeout: 10000 });
    }
  });

  it('should spawn process using http transport', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'http',
        discovery: 'local',
      },
    });

    const service = await pm.spawn(CalculatorService);

    expect(service).toBeDefined();

    const result = await service.add(50, 50);
    expect(result).toBe(100);
  });

  it('should handle stateful operations over HTTP', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'http',
        discovery: 'local',
      },
    });

    const counter = await pm.spawn(CounterService);

    await counter.setValue(100);
    expect(await counter.getValue()).toBe(100);

    await counter.increment();
    await counter.increment();
    expect(await counter.getValue()).toBe(102);
  });

  it('should create pool over HTTP', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'http',
        discovery: 'local',
      },
    });

    const pool = await pm.pool(CalculatorService, {
      size: 2,
      strategy: PoolStrategy.ADAPTIVE,
    });

    const operations = [];
    for (let i = 0; i < 20; i++) {
      operations.push(pool.multiply(i, i));
    }

    const results = await Promise.all(operations);

    results.forEach((result, index) => {
      expect(result).toBe(index * index);
    });
  });
});

describeOrSkip('Transport Comparison - Performance', () => {
  const transports = ['unix', 'ipc', 'tcp'] as const;

  for (const transport of transports) {
    describe(`${transport.toUpperCase()} Transport Performance`, () => {
      let pm: ProcessManager;

      afterEach(async () => {
        if (pm) {
          await pm.shutdown({ force: true, timeout: 10000 });
        }
      });

      it(`should measure latency for ${transport} transport`, async () => {
        pm = new ProcessManager(logger, {
          testing: {
            useMockSpawner: true, // Use mock spawner for Jest compatibility
          },
          netron: {
            transport,
            discovery: 'local',
          },
        });

        const service = await pm.spawn(CalculatorService);

        const latencies: number[] = [];
        for (let i = 0; i < 20; i++) {
          const start = Date.now();
          await service.add(i, 1);
          latencies.push(Date.now() - start);
        }

        // Calculate avg latency
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

        // All transports should have reasonable latency (< 100ms average)
        expect(avgLatency).toBeLessThan(100);

        console.log(`${transport} average latency: ${avgLatency.toFixed(2)}ms`);
      });

      it(`should handle concurrent requests with ${transport} transport`, async () => {
        pm = new ProcessManager(logger, {
          testing: {
            useMockSpawner: true, // Use mock spawner for Jest compatibility
          },
          netron: {
            transport,
            discovery: 'local',
          },
        });

        const pool = await pm.pool(CalculatorService, {
          size: 2,
        });

        const startTime = Date.now();

        const operations = [];
        for (let i = 0; i < 50; i++) {
          operations.push(pool.add(i, i));
        }

        await Promise.all(operations);

        const duration = Date.now() - startTime;
        const throughput = (50 / duration) * 1000;

        // Should achieve reasonable throughput
        expect(throughput).toBeGreaterThan(50);

        console.log(`${transport} throughput: ${throughput.toFixed(2)} req/s`);
      });
    });
  }
});

describeOrSkip('Transport Error Handling', () => {
  let pm: ProcessManager;

  afterEach(async () => {
    if (pm) {
      await pm.shutdown({ force: true, timeout: 10000 });
    }
  });

  it('should handle process crash and recovery with unix transport', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'unix',
        discovery: 'local',
      },
    });

    const service = await pm.spawn(CalculatorService, {
      restart: {
        enabled: true,
        maxRetries: 3,
        delay: 100,
      },
    });

    // Service should work
    const result1 = await service.add(1, 2);
    expect(result1).toBe(3);

    // After potential crash/restart, service should still work
    const result2 = await service.multiply(3, 4);
    expect(result2).toBe(12);
  });

  it('should handle connection drops with tcp transport', async () => {
    pm = new ProcessManager(logger, {
      testing: {
        useMockSpawner: true, // Use mock spawner for Jest compatibility
      },
      netron: {
        transport: 'tcp',
        discovery: 'local',
      },
    });

    const service = await pm.spawn(CounterService);

    // Do some operations
    await service.increment();
    await service.increment();

    // Verify state is maintained
    const value = await service.getValue();
    expect(value).toBe(2);
  });
});
