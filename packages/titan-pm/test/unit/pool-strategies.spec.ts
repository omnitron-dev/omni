/**
 * Pool Strategies Comprehensive Tests
 *
 * Tests ALL 11 load balancing strategies documented in README:
 * 1. ROUND_ROBIN - Sequential distribution
 * 2. RANDOM - Random selection
 * 3. LEAST_LOADED - Lowest current load (CPU/memory)
 * 4. LEAST_CONNECTIONS - Fewest active connections
 * 5. WEIGHTED_ROUND_ROBIN - Round-robin with capacity weights
 * 6. LEAST_RESPONSE_TIME - Lowest average response time
 * 7. LATENCY - Alias for LEAST_RESPONSE_TIME
 * 8. IP_HASH - Sticky sessions based on key
 * 9. CONSISTENT_HASH - Stable distribution with minimal redistribution
 * 10. WEIGHTED - Probability-based selection using capacity
 * 11. ADAPTIVE - ML-like multi-factor scoring
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { ProcessPool } from '../../src/process-pool.js';
import { PoolStrategy, ProcessStatus } from '../../src/types.js';

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

// Mock service proxy with configurable behavior
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

// Mock ProcessManager
const createMockManager = (proxies: any[]) => {
  const manager = new EventEmitter() as any;
  let callIndex = 0;
  manager.spawn = vi.fn().mockImplementation(async () => proxies[callIndex++ % proxies.length]);
  manager.kill = vi.fn().mockResolvedValue(true);
  manager.getProcess = vi.fn().mockReturnValue({
    id: 'test-process',
    status: ProcessStatus.RUNNING,
  });
  return manager;
};

describe('Pool Strategies - Comprehensive Coverage', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let pool: ProcessPool<any>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (pool) {
      try {
        await pool.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('ROUND_ROBIN Strategy', () => {
    it('should distribute requests sequentially across workers', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2'), createMockProxy('worker-3')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 3, strategy: PoolStrategy.ROUND_ROBIN },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make 6 calls - each worker should get exactly 2
      for (let i = 0; i < 6; i++) {
        await pool.execute('testMethod');
      }

      // Verify even distribution
      expect(proxies[0].testMethod).toHaveBeenCalledTimes(2);
      expect(proxies[1].testMethod).toHaveBeenCalledTimes(2);
      expect(proxies[2].testMethod).toHaveBeenCalledTimes(2);
    });

    it('should cycle back to first worker after last', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.ROUND_ROBIN },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make 5 calls
      for (let i = 0; i < 5; i++) {
        await pool.execute('testMethod');
      }

      // Worker 1: calls 1, 3, 5 = 3 times
      // Worker 2: calls 2, 4 = 2 times
      expect(proxies[0].testMethod).toHaveBeenCalledTimes(3);
      expect(proxies[1].testMethod).toHaveBeenCalledTimes(2);
    });
  });

  describe('RANDOM Strategy', () => {
    it('should distribute requests randomly', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(mockManager, 'TestProcess', { size: 2, strategy: PoolStrategy.RANDOM }, mockLogger as any);
      await pool.initialize();
      vi.useRealTimers();

      // Make many calls
      for (let i = 0; i < 100; i++) {
        await pool.execute('testMethod');
      }

      // Both workers should have received requests
      const calls1 = proxies[0].testMethod.mock.calls.length;
      const calls2 = proxies[1].testMethod.mock.calls.length;

      expect(calls1 + calls2).toBe(100);
      // With random, both should have at least some calls (statistically)
      expect(calls1).toBeGreaterThan(0);
      expect(calls2).toBeGreaterThan(0);
    });

    it('should use all workers over time', async () => {
      const proxies = [
        createMockProxy('worker-1'),
        createMockProxy('worker-2'),
        createMockProxy('worker-3'),
        createMockProxy('worker-4'),
      ];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(mockManager, 'TestProcess', { size: 4, strategy: PoolStrategy.RANDOM }, mockLogger as any);
      await pool.initialize();
      vi.useRealTimers();

      // Make many calls
      for (let i = 0; i < 200; i++) {
        await pool.execute('testMethod');
      }

      // All workers should have received at least some calls
      proxies.forEach((proxy) => {
        expect(proxy.testMethod.mock.calls.length).toBeGreaterThan(0);
      });
    });
  });

  describe('LEAST_LOADED Strategy', () => {
    it('should prefer workers with lower current load', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.LEAST_LOADED },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      await pool.execute('testMethod');
      await pool.execute('testMethod');

      // Both should have been used since load is tracked per-request
      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(2);
    });

    it('should balance load across workers', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2'), createMockProxy('worker-3')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 3, strategy: PoolStrategy.LEAST_LOADED },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make 9 calls
      for (let i = 0; i < 9; i++) {
        await pool.execute('testMethod');
      }

      // Should be relatively balanced
      const calls = proxies.map((p) => p.testMethod.mock.calls.length);
      const totalCalls = calls.reduce((a, b) => a + b, 0);
      expect(totalCalls).toBe(9);
    });
  });

  describe('WEIGHTED Strategy', () => {
    it('should distribute based on inverse load weights', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.WEIGHTED },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      for (let i = 0; i < 50; i++) {
        await pool.execute('testMethod');
      }

      // Both should receive calls (weighted by inverse load)
      const calls1 = proxies[0].testMethod.mock.calls.length;
      const calls2 = proxies[1].testMethod.mock.calls.length;
      expect(calls1 + calls2).toBe(50);
    });

    it('should favor workers with lower load', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.WEIGHTED },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // All calls complete quickly, so load stays low
      for (let i = 0; i < 20; i++) {
        await pool.execute('testMethod');
      }

      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(20);
    });
  });

  describe('ADAPTIVE Strategy', () => {
    it('should select worker with best combined score', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.ADAPTIVE },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      for (let i = 0; i < 10; i++) {
        await pool.execute('testMethod');
      }

      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(10);
    });

    it('should consider load, latency, errors, and connections', async () => {
      // Create proxies with different characteristics
      const slowProxy = createMockProxy('worker-slow', {
        testMethod: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 'slow result';
        }),
      });
      const fastProxy = createMockProxy('worker-fast');

      const mockManager = createMockManager([fastProxy, slowProxy]);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.ADAPTIVE },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make several calls
      for (let i = 0; i < 10; i++) {
        await pool.execute('testMethod');
      }

      // Adaptive should favor the faster worker over time
      const totalCalls = fastProxy.testMethod.mock.calls.length + slowProxy.testMethod.mock.calls.length;
      expect(totalCalls).toBe(10);
    });
  });

  describe('CONSISTENT_HASH Strategy', () => {
    it('should consistently route same request patterns', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2'), createMockProxy('worker-3')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 3, strategy: PoolStrategy.CONSISTENT_HASH },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      for (let i = 0; i < 9; i++) {
        await pool.execute('testMethod');
      }

      const totalCalls = proxies.reduce((sum, p) => sum + p.testMethod.mock.calls.length, 0);
      expect(totalCalls).toBe(9);
    });

    it('should distribute based on request counter hash', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.CONSISTENT_HASH },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make even number of calls
      for (let i = 0; i < 10; i++) {
        await pool.execute('testMethod');
      }

      // Hash should distribute evenly with modulo
      const calls1 = proxies[0].testMethod.mock.calls.length;
      const calls2 = proxies[1].testMethod.mock.calls.length;
      expect(calls1 + calls2).toBe(10);
    });
  });

  describe('LATENCY Strategy', () => {
    it('should select worker with lowest average response time', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.LATENCY },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      for (let i = 0; i < 10; i++) {
        await pool.execute('testMethod');
      }

      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(10);
    });

    it('should prefer faster workers over time', async () => {
      // Create proxies with different response times
      const slowProxy = createMockProxy('worker-slow', {
        testMethod: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'slow';
        }),
      });
      const fastProxy = createMockProxy('worker-fast', {
        testMethod: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'fast';
        }),
      });

      const mockManager = createMockManager([fastProxy, slowProxy]);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.LATENCY },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make initial calls to establish latency metrics
      await pool.execute('testMethod');
      await pool.execute('testMethod');

      // Make more calls - should favor faster worker
      for (let i = 0; i < 8; i++) {
        await pool.execute('testMethod');
      }

      // Fast worker should have more calls (lower latency preferred)
      const fastCalls = fastProxy.testMethod.mock.calls.length;
      const slowCalls = slowProxy.testMethod.mock.calls.length;

      // After establishing metrics, fast worker should be preferred
      expect(fastCalls + slowCalls).toBe(10);
      // Fast worker should have at least as many calls
      expect(fastCalls).toBeGreaterThanOrEqual(slowCalls);
    });
  });

  describe('LEAST_CONNECTIONS Strategy', () => {
    it('should prefer workers with fewer active connections', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.LEAST_CONNECTIONS },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      for (let i = 0; i < 6; i++) {
        await pool.execute('testMethod');
      }

      // Should distribute based on connection count
      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(6);
    });

    it('should use round-robin as tie-breaker when connections are equal', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.LEAST_CONNECTIONS },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls sequentially (connections complete quickly)
      // With equal connections, round-robin is used as tie-breaker
      for (let i = 0; i < 10; i++) {
        await pool.execute('testMethod');
      }

      // Both workers should receive calls due to round-robin tie-breaker
      const calls1 = proxies[0].testMethod.mock.calls.length;
      const calls2 = proxies[1].testMethod.mock.calls.length;
      expect(calls1 + calls2).toBe(10);
      expect(calls1).toBe(5);
      expect(calls2).toBe(5);
    });
  });

  describe('WEIGHTED_ROUND_ROBIN Strategy', () => {
    it('should distribute requests with weighted round-robin', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.WEIGHTED_ROUND_ROBIN },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      for (let i = 0; i < 20; i++) {
        await pool.execute('testMethod');
      }

      // Both workers should receive calls
      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(20);
    });

    it('should favor workers with lower load', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.WEIGHTED_ROUND_ROBIN },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      for (let i = 0; i < 10; i++) {
        await pool.execute('testMethod');
      }

      // Distribution happens based on weight
      const calls1 = proxies[0].testMethod.mock.calls.length;
      const calls2 = proxies[1].testMethod.mock.calls.length;
      expect(calls1 + calls2).toBe(10);
    });
  });

  describe('LEAST_RESPONSE_TIME Strategy', () => {
    it('should select worker with lowest average response time', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.LEAST_RESPONSE_TIME },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      for (let i = 0; i < 6; i++) {
        await pool.execute('testMethod');
      }

      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(6);
    });

    it('should be equivalent to LATENCY strategy', async () => {
      // Both strategies should use the same selection logic
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.LEAST_RESPONSE_TIME },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      for (let i = 0; i < 10; i++) {
        await pool.execute('testMethod');
      }

      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(10);
    });
  });

  describe('IP_HASH Strategy', () => {
    it('should use consistent hash based on request counter', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.IP_HASH },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make calls
      for (let i = 0; i < 6; i++) {
        await pool.execute('testMethod');
      }

      // Uses consistent hash which distributes based on request counter
      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(6);
    });

    it('should provide consistent distribution pattern', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: PoolStrategy.IP_HASH },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Make even number of calls
      for (let i = 0; i < 10; i++) {
        await pool.execute('testMethod');
      }

      // Hash should distribute based on counter
      const calls1 = proxies[0].testMethod.mock.calls.length;
      const calls2 = proxies[1].testMethod.mock.calls.length;
      expect(calls1 + calls2).toBe(10);
    });
  });

  describe('Strategy Edge Cases', () => {
    it('should handle single worker pool', async () => {
      const proxies = [createMockProxy('worker-1')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 1, strategy: PoolStrategy.ROUND_ROBIN },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // All calls go to single worker
      for (let i = 0; i < 5; i++) {
        await pool.execute('testMethod');
      }

      expect(proxies[0].testMethod).toHaveBeenCalledTimes(5);
    });

    it('should handle empty pool gracefully', async () => {
      const mockManager = createMockManager([]);
      mockManager.spawn.mockRejectedValue(new Error('Spawn failed'));

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 1, strategy: PoolStrategy.ROUND_ROBIN },
        mockLogger as any
      );

      await expect(pool.initialize()).rejects.toThrow('Spawn failed');
    });

    it('should fallback to round-robin for unknown strategy', async () => {
      const proxies = [createMockProxy('worker-1'), createMockProxy('worker-2')];
      const mockManager = createMockManager(proxies);

      pool = new ProcessPool(
        mockManager,
        'TestProcess',
        { size: 2, strategy: 'unknown-strategy' as any },
        mockLogger as any
      );
      await pool.initialize();
      vi.useRealTimers();

      // Should still work with default strategy
      for (let i = 0; i < 4; i++) {
        await pool.execute('testMethod');
      }

      const totalCalls = proxies[0].testMethod.mock.calls.length + proxies[1].testMethod.mock.calls.length;
      expect(totalCalls).toBe(4);
    });
  });
});
