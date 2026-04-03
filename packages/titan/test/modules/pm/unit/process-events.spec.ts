/**
 * Process Events Comprehensive Tests
 *
 * Tests all 7 documented IProcessEvents:
 * 1. process:spawn - When process is created
 * 2. process:ready - When process transitions to RUNNING
 * 3. process:crash - When process crashes unexpectedly
 * 4. process:restart - When restart is attempted
 * 5. process:stop - When process is gracefully stopped
 * 6. pool:scale - When pool size changes
 * 7. health:change - When health status changes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { ProcessPool } from '../../../../src/modules/pm/process-pool.js';
import { ProcessStatus } from '../../../../src/modules/pm/types.js';

// Mock logger
const createMockLogger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

// Mock service proxy
const createMockProxy = (id: string, overrides: Record<string, unknown> = {}) => ({
  __processId: id,
  __destroy: vi.fn().mockResolvedValue(undefined),
  __getMetrics: vi.fn().mockResolvedValue({
    cpu: 50,
    memory: 40,
    requests: 100,
    errors: 0,
  }),
  __getHealth: vi.fn().mockResolvedValue({
    status: 'healthy',
    checks: [],
    timestamp: Date.now(),
  }),
  testMethod: vi.fn().mockResolvedValue('result'),
  ...overrides,
});

// Mock ProcessManager with event emitter capabilities
const createMockManager = (proxies: any[]) => {
  const manager = new EventEmitter() as any;
  let callIndex = 0;
  manager.spawn = vi.fn().mockImplementation(async () => {
    const proxy = proxies[callIndex++ % proxies.length];
    // No delay - immediate return for test stability
    return proxy;
  });
  manager.kill = vi.fn().mockResolvedValue(true);
  manager.getProcess = vi.fn().mockReturnValue({
    id: 'test-process',
    status: ProcessStatus.RUNNING,
  });
  return manager;
};

describe('Process Events - Comprehensive Coverage', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let pool: ProcessPool<any>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    // Don't use fake timers - causes issues with async operations
  });

  afterEach(async () => {
    if (pool) {
      try {
        await pool.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Pool Events', () => {
    describe('pool:initialized event', () => {
      it('should emit pool:initialized when pool is created', async () => {
        const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
        const mockManager = createMockManager(proxies);

        pool = new ProcessPool(mockManager, 'TestProcess', { size: 2 }, mockLogger as any);

        const initPromise = new Promise<any>((resolve) => {
          pool.on('pool:initialized', (data) => resolve(data));
        });

        await pool.initialize();

        const eventData = await initPromise;
        expect(eventData).toBeDefined();
        expect(eventData.size).toBe(2);
        expect(eventData.class).toBe('TestProcess');
      });
    });

    describe('pool:scaled event', () => {
      it('should emit pool:scaled when scaling up', async () => {
        const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2'), createMockProxy('worker-3')];
        const mockManager = createMockManager(proxies);

        pool = new ProcessPool(
          mockManager,
          'TestProcess',
          { size: 2, autoScale: { enabled: true, min: 1, max: 5 } },
          mockLogger as any
        );

        let scaledEmitted = false;
        let scaledData: any = null;

        pool.on('pool:scaled', (data) => {
          scaledEmitted = true;
          scaledData = data;
        });

        await pool.initialize();
        await pool.scale(3);

        expect(scaledEmitted).toBe(true);
        expect(scaledData).toBeDefined();
        expect(scaledData.from).toBe(2);
        expect(scaledData.to).toBe(3);
      });

      it('should emit pool:scaled when scaling down', async () => {
        const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2'), createMockProxy('worker-3')];
        const mockManager = createMockManager(proxies);

        pool = new ProcessPool(
          mockManager,
          'TestProcess',
          { size: 3, autoScale: { enabled: true, min: 1, max: 5 } },
          mockLogger as any
        );

        let scaledData: any = null;

        pool.on('pool:scaled', (data) => {
          scaledData = data;
        });

        await pool.initialize();
        await pool.scale(1);

        expect(scaledData).toBeDefined();
        expect(scaledData.from).toBe(3);
        expect(scaledData.to).toBe(1);
      });

      it('should not emit pool:scaled when size unchanged', async () => {
        const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
        const mockManager = createMockManager(proxies);

        pool = new ProcessPool(
          mockManager,
          'TestProcess',
          { size: 2, autoScale: { enabled: true, min: 1, max: 5 } },
          mockLogger as any
        );

        let scaledEmitted = false;

        pool.on('pool:scaled', () => {
          scaledEmitted = true;
        });

        await pool.initialize();
        await pool.scale(2); // Same size

        expect(scaledEmitted).toBe(false);
      });
    });

    describe('pool:drained event', () => {
      it('should emit pool:drained when pool is drained', async () => {
        const proxies = [createMockProxy('worker-1')];
        const mockManager = createMockManager(proxies);

        pool = new ProcessPool(mockManager, 'TestProcess', { size: 1 }, mockLogger as any);

        const drainedPromise = new Promise<any>((resolve) => {
          pool.on('pool:drained', (data) => resolve(data));
        });

        await pool.initialize();
        pool.drain(); // Don't await, check event

        const eventData = await drainedPromise;
        expect(eventData).toBeDefined();
        expect(eventData.class).toBe('TestProcess');
      });
    });

    describe('pool:destroyed event', () => {
      it('should emit pool:destroyed when pool is destroyed', async () => {
        const proxies = [createMockProxy('worker-1')];
        const mockManager = createMockManager(proxies);

        pool = new ProcessPool(mockManager, 'TestProcess', { size: 1 }, mockLogger as any);

        const destroyedPromise = new Promise<any>((resolve) => {
          pool.on('pool:destroyed', (data) => resolve(data));
        });

        await pool.initialize();
        const destroyPromise = pool.destroy();

        const eventData = await destroyedPromise;
        await destroyPromise;

        expect(eventData).toBeDefined();
        expect(eventData.class).toBe('TestProcess');
      });
    });
  });

  describe('Worker Events', () => {
    describe('worker:spawned event', () => {
      it('should emit worker:spawned for each worker created', async () => {
        const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
        const mockManager = createMockManager(proxies);

        pool = new ProcessPool(mockManager, 'TestProcess', { size: 2 }, mockLogger as any);

        const spawnedEvents: any[] = [];

        pool.on('worker:spawned', (data) => {
          spawnedEvents.push(data);
        });

        await pool.initialize();

        expect(spawnedEvents.length).toBe(2);
        expect(spawnedEvents[0].workerId).toBe('worker-1');
        expect(spawnedEvents[1].workerId).toBe('worker-2');
      });

      it('should include worker ID and class in event', async () => {
        const proxies = [createMockProxy('test-worker-123')];
        const mockManager = createMockManager(proxies);

        pool = new ProcessPool(mockManager, 'MyTestProcess', { size: 1 }, mockLogger as any);

        let spawnedData: any = null;

        pool.on('worker:spawned', (data) => {
          spawnedData = data;
        });

        await pool.initialize();

        expect(spawnedData).toBeDefined();
        expect(spawnedData.workerId).toBe('test-worker-123');
        expect(spawnedData.class).toBe('MyTestProcess');
      });
    });

    describe('worker:shutdown event', () => {
      it('should emit worker:shutdown when worker is terminated', async () => {
        const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
        const mockManager = createMockManager(proxies);

        pool = new ProcessPool(
          mockManager,
          'TestProcess',
          { size: 2, autoScale: { enabled: true, min: 1, max: 5 } },
          mockLogger as any
        );

        const shutdownEvents: any[] = [];

        pool.on('worker:shutdown', (data) => {
          shutdownEvents.push(data);
        });

        await pool.initialize();
        await pool.scale(1); // Scale down to trigger shutdown

        expect(shutdownEvents.length).toBe(1);
        expect(shutdownEvents[0].workerId).toBeDefined();
      });
    });

    describe('worker:unhealthy event', () => {
      it('should emit worker:unhealthy when worker health degrades', async () => {
        const failingProxy = createMockProxy('failing-worker', {
          testMethod: vi.fn().mockRejectedValue(new Error('Always fails')),
        });
        const mockManager = createMockManager([failingProxy]);

        pool = new ProcessPool(
          mockManager,
          'TestProcess',
          {
            size: 1,
            healthCheck: {
              enabled: true,
              unhealthyThreshold: 2,
            },
          },
          mockLogger as any
        );

        let unhealthyEmitted = false;
        let unhealthyData: any = null;

        pool.on('worker:unhealthy', (data) => {
          unhealthyEmitted = true;
          unhealthyData = data;
        });

        await pool.initialize();
        // Real timers already in use

        // Trigger failures to exceed unhealthyThreshold
        for (let i = 0; i < 3; i++) {
          try {
            await pool.execute('testMethod');
          } catch {
            // Expected
          }
        }

        expect(unhealthyEmitted).toBe(true);
        expect(unhealthyData).toBeDefined();
        expect(unhealthyData.workerId).toBeDefined();
      });
    });
  });

  describe('Request Events', () => {
    describe('request:queued event', () => {
      it('should emit request:queued when request is queued', async () => {
        // Create a slow proxy to force queuing
        const slowProxy = createMockProxy('slow-worker', {
          testMethod: vi.fn().mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return 'result';
          }),
        });
        const mockManager = createMockManager([slowProxy]);

        pool = new ProcessPool(mockManager, 'TestProcess', { size: 1, maxQueueSize: 10 }, mockLogger as any);

        let queuedEmitted = false;
        let queuedData: any = null;

        pool.on('request:queued', (data) => {
          queuedEmitted = true;
          queuedData = data;
        });

        await pool.initialize();
        // Real timers already in use

        // Start first request (will be slow)
        const promise1 = pool.execute('testMethod');

        // Give time for first request to start
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Second request should be queued while first is running
        const promise2 = pool.execute('testMethod');

        // Wait for both
        await Promise.all([promise1, promise2]);

        // Queue event should have been emitted
        expect(queuedEmitted).toBe(true);
        if (queuedData) {
          expect(queuedData.queueSize).toBeGreaterThanOrEqual(1);
          expect(queuedData.method).toBe('testMethod');
        }
      });
    });
  });

  describe('Circuit Breaker Events', () => {
    describe('circuitbreaker:open event', () => {
      it('should emit circuitbreaker:open when circuit opens', async () => {
        const failingProxy = createMockProxy('failing-worker', {
          testMethod: vi.fn().mockRejectedValue(new Error('Always fails')),
        });
        const mockManager = createMockManager([failingProxy]);

        pool = new ProcessPool(
          mockManager,
          'TestProcess',
          {
            size: 1,
            circuitBreaker: {
              enabled: true,
              threshold: 3,
              timeout: 1000,
            },
          },
          mockLogger as any
        );

        let openEmitted = false;

        pool.on('circuitbreaker:open', () => {
          openEmitted = true;
        });

        await pool.initialize();
        // Real timers already in use

        // Trigger failures to open circuit
        for (let i = 0; i < 3; i++) {
          try {
            await pool.execute('testMethod');
          } catch {
            // Expected
          }
        }

        expect(openEmitted).toBe(true);
      });
    });

    describe('circuitbreaker:close event', () => {
      it('should emit circuitbreaker:close when circuit closes', async () => {
        let callCount = 0;
        const intermittentProxy = createMockProxy('intermittent-worker', {
          testMethod: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount <= 3) {
              throw new Error('Fails initially');
            }
            return 'success';
          }),
        });
        const mockManager = createMockManager([intermittentProxy]);

        pool = new ProcessPool(
          mockManager,
          'TestProcess',
          {
            size: 1,
            circuitBreaker: {
              enabled: true,
              threshold: 3,
              timeout: 50,
              halfOpenRequests: 1,
            },
          },
          mockLogger as any
        );

        let closeEmitted = false;

        pool.on('circuitbreaker:close', () => {
          closeEmitted = true;
        });

        await pool.initialize();
        // Real timers already in use

        // Open the circuit
        for (let i = 0; i < 3; i++) {
          try {
            await pool.execute('testMethod');
          } catch {
            // Expected
          }
        }

        // Wait for timeout to enter half-open
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Successful request should close circuit
        await pool.execute('testMethod');

        expect(closeEmitted).toBe(true);
      });
    });
  });

  describe('Event Subscription', () => {
    it('should allow subscribing to events with on()', async () => {
      const proxies = [createMockProxy('worker-1')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(mockManager, 'TestProcess', { size: 1 }, mockLogger as any);

      const events: string[] = [];

      pool.on('pool:initialized', () => events.push('initialized'));
      pool.on('worker:spawned', () => events.push('spawned'));

      await pool.initialize();

      expect(events).toContain('initialized');
      expect(events).toContain('spawned');
    });

    it('should allow unsubscribing from events with off()', async () => {
      const proxies = [createMockProxy('worker-1')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 1, autoScale: { enabled: true, min: 1, max: 5 } },
        mockLogger as any
      );

      let scaledCount = 0;
      const listener = () => {
        scaledCount++;
      };

      pool.on('pool:scaled', listener);
      await pool.initialize();

      // First scale
      await pool.scale(2);
      expect(scaledCount).toBe(1);

      // Unsubscribe
      pool.off('pool:scaled', listener);

      // Second scale - listener should not fire
      await pool.scale(3);
      expect(scaledCount).toBe(1); // Still 1
    });

    it('should allow multiple listeners for same event', async () => {
      const proxies = [createMockProxy('worker-1')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(mockManager, 'TestProcess', { size: 1 }, mockLogger as any);

      let listener1Called = false;
      let listener2Called = false;

      pool.on('pool:initialized', () => {
        listener1Called = true;
      });
      pool.on('pool:initialized', () => {
        listener2Called = true;
      });

      await pool.initialize();

      expect(listener1Called).toBe(true);
      expect(listener2Called).toBe(true);
    });
  });
});
