/**
 * Unit tests for ProcessHealthChecker
 *
 * Tests health checks, status reporting, events, and trend analysis
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ProcessHealthChecker } from '../../../../src/modules/pm/process-health.js';
import type { IHealthStatus, ServiceProxy } from '../../../../src/modules/pm/types.js';

// Mock logger
const createMockLogger = () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
});

// Mock service proxy
const createMockProxy = (healthStatus: IHealthStatus['status'] = 'healthy'): ServiceProxy<any> => {
  return {
    __processId: 'test-process',
    __destroy: jest.fn().mockResolvedValue(undefined),
    __getMetrics: jest.fn().mockResolvedValue({ cpu: 50, memory: 512, requests: 100, errors: 0 }),
    __getHealth: jest.fn().mockResolvedValue({
      status: healthStatus,
      checks: [{ name: 'general', status: healthStatus === 'healthy' ? 'pass' : 'fail' }],
      timestamp: Date.now(),
    }),
  } as any;
};

describe('ProcessHealthChecker', () => {
  let checker: ProcessHealthChecker;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockLogger = createMockLogger();
    checker = new ProcessHealthChecker(mockLogger as any);
  });

  afterEach(() => {
    checker.removeAllListeners();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Start Monitoring', () => {
    it('should start health monitoring for a process', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 3 });

      // Initial check happens immediately
      await jest.advanceTimersByTimeAsync(100);
      expect(proxy.__getHealth).toHaveBeenCalled();
    });

    it('should perform checks at specified interval', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 3 });

      await jest.advanceTimersByTimeAsync(3500);

      // Initial + 3 interval checks
      expect(proxy.__getHealth).toHaveBeenCalledTimes(4);
    });

    it('should use default options if not specified', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, {});

      // Default interval is 30000ms
      await jest.advanceTimersByTimeAsync(30100);

      expect(proxy.__getHealth).toHaveBeenCalled();
    });

    it('should not start if already monitoring', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });
      checker.startMonitoring('proc-1', proxy, { interval: 1000 });

      await jest.advanceTimersByTimeAsync(1500);

      // Should only have one monitoring running
      expect((proxy.__getHealth as jest.Mock).mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('should log debug message when starting', () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        { processId: 'proc-1' },
        'Starting health monitoring'
      );
    });
  });

  describe('Stop Monitoring', () => {
    it('should stop health monitoring', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });
      await jest.advanceTimersByTimeAsync(2500);

      const callsBefore = (proxy.__getHealth as jest.Mock).mock.calls.length;

      checker.stopMonitoring('proc-1');

      await jest.advanceTimersByTimeAsync(2000);

      expect(proxy.__getHealth).toHaveBeenCalledTimes(callsBefore);
    });

    it('should clear health history on stop', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });
      await jest.advanceTimersByTimeAsync(1500);

      checker.stopMonitoring('proc-1');

      expect(checker.getHealth('proc-1')).toBeNull();
      expect(checker.getHealthHistory('proc-1')).toEqual([]);
    });

    it('should handle stopping non-existent monitoring', () => {
      // Should not throw
      checker.stopMonitoring('non-existent');
    });

    it('should log debug message when stopping', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });
      checker.stopMonitoring('proc-1');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        { processId: 'proc-1' },
        'Stopped health monitoring'
      );
    });
  });

  describe('Get Health Status', () => {
    it('should return current health status', async () => {
      const proxy = createMockProxy('healthy');

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });
      await jest.advanceTimersByTimeAsync(100);

      const health = checker.getHealth('proc-1');

      expect(health?.status).toBe('healthy');
    });

    it('should return null if no health recorded', () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });

      // Without advancing time, no health check has completed
      // Note: Initial check starts async, so might be null
      // Let's check without any time advancement
      const healthBefore = checker.getHealthHistory('proc-1');
      expect(healthBefore.length).toBe(0);
    });

    it('should return null for unknown process', () => {
      expect(checker.getHealth('unknown')).toBeNull();
    });
  });

  describe('Get Health History', () => {
    it('should return health history', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });
      await jest.advanceTimersByTimeAsync(3500);

      const history = checker.getHealthHistory('proc-1');

      expect(history.length).toBeGreaterThanOrEqual(3);
    });

    it('should return empty array for unknown process', () => {
      expect(checker.getHealthHistory('unknown')).toEqual([]);
    });

    it('should limit history to 100 entries', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 10 });

      // Collect more than 100 entries
      await jest.advanceTimersByTimeAsync(1500);

      const history = checker.getHealthHistory('proc-1');
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('isHealthy', () => {
    it('should return true for healthy process', async () => {
      const proxy = createMockProxy('healthy');

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });
      await jest.advanceTimersByTimeAsync(100);

      expect(checker.isHealthy('proc-1')).toBe(true);
    });

    it('should return false for unhealthy process', async () => {
      const proxy = createMockProxy('unhealthy');

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });
      await jest.advanceTimersByTimeAsync(100);

      expect(checker.isHealthy('proc-1')).toBe(false);
    });

    it('should return false for degraded process', async () => {
      const proxy = createMockProxy('degraded');

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });
      await jest.advanceTimersByTimeAsync(100);

      expect(checker.isHealthy('proc-1')).toBe(false);
    });

    it('should return false for unknown process', () => {
      expect(checker.isHealthy('unknown')).toBe(false);
    });
  });

  describe('Health Check with Retries', () => {
    it('should retry on health check failure', async () => {
      const proxy = createMockProxy();
      let attempts = 0;
      (proxy.__getHealth as jest.Mock).mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return { status: 'healthy', checks: [], timestamp: Date.now() };
      });

      checker.startMonitoring('proc-1', proxy, { interval: 5000, timeout: 1000, retries: 3 });

      // Wait for initial check with retries (each retry has 1000ms delay)
      await jest.advanceTimersByTimeAsync(3500);

      expect(attempts).toBe(3);
      expect(checker.isHealthy('proc-1')).toBe(true);
    });

    it('should mark unhealthy after retries exhausted', async () => {
      const proxy = createMockProxy();
      (proxy.__getHealth as jest.Mock).mockRejectedValue(new Error('Persistent failure'));

      checker.startMonitoring('proc-1', proxy, { interval: 5000, timeout: 1000, retries: 2 });

      await jest.advanceTimersByTimeAsync(3500);

      expect(checker.isHealthy('proc-1')).toBe(false);
    });
  });

  describe('Health Check Timeout', () => {
    it('should timeout slow health checks', async () => {
      const proxy = createMockProxy();
      (proxy.__getHealth as jest.Mock).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return { status: 'healthy', checks: [], timestamp: Date.now() };
      });

      checker.startMonitoring('proc-1', proxy, { interval: 5000, timeout: 100, retries: 1 });

      await jest.advanceTimersByTimeAsync(2000);

      expect(checker.isHealthy('proc-1')).toBe(false);
    });
  });

  describe('Fallback Health Check', () => {
    it('should use basic health check when __getHealth not available', async () => {
      const proxy = {
        __processId: 'test-process',
        __destroy: jest.fn(),
        __getMetrics: jest.fn().mockResolvedValue({ cpu: 50, memory: 512 }),
      } as any;

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 1 });

      await jest.advanceTimersByTimeAsync(100);

      // Should use basic connectivity check
      expect(proxy.__getMetrics).toHaveBeenCalled();
    });

    it('should return healthy when basic check passes', async () => {
      const proxy = {
        __processId: 'test-process',
        __destroy: jest.fn(),
        __getMetrics: jest.fn().mockResolvedValue({ cpu: 50, memory: 512 }),
      } as any;

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 1 });

      await jest.advanceTimersByTimeAsync(100);

      const health = checker.getHealth('proc-1');
      expect(health?.status).toBe('healthy');
      expect(health?.checks[0].name).toBe('connectivity');
      expect(health?.checks[0].status).toBe('pass');
    });

    it('should return unhealthy when basic check fails', async () => {
      const proxy = {
        __processId: 'test-process',
        __destroy: jest.fn(),
        __getMetrics: jest.fn().mockRejectedValue(new Error('Connection failed')),
      } as any;

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 1 });

      await jest.advanceTimersByTimeAsync(100);

      const health = checker.getHealth('proc-1');
      expect(health?.status).toBe('unhealthy');
      expect(health?.checks[0].status).toBe('fail');
    });
  });

  describe('Health Change Events', () => {
    it('should emit health:change on status transition', async () => {
      const proxy = createMockProxy('healthy');
      let currentStatus: IHealthStatus['status'] = 'healthy';

      (proxy.__getHealth as jest.Mock).mockImplementation(async () => ({
        status: currentStatus,
        checks: [],
        timestamp: Date.now(),
      }));

      const handler = jest.fn();
      checker.on('health:change', handler);

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 1 });

      await jest.advanceTimersByTimeAsync(100);

      // Change to unhealthy
      currentStatus = 'unhealthy';
      await jest.advanceTimersByTimeAsync(1100);

      expect(handler).toHaveBeenCalledWith(
        'proc-1',
        expect.objectContaining({ status: 'unhealthy' })
      );
    });

    it('should not emit event when status unchanged', async () => {
      const proxy = createMockProxy('healthy');

      const handler = jest.fn();
      checker.on('health:change', handler);

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 1 });

      await jest.advanceTimersByTimeAsync(3500);

      // Status stays healthy, no change events
      expect(handler).not.toHaveBeenCalled();
    });

    it('should log status change', async () => {
      const proxy = createMockProxy('healthy');
      let currentStatus: IHealthStatus['status'] = 'healthy';

      (proxy.__getHealth as jest.Mock).mockImplementation(async () => ({
        status: currentStatus,
        checks: [],
        timestamp: Date.now(),
      }));

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 1 });

      await jest.advanceTimersByTimeAsync(100);

      currentStatus = 'unhealthy';
      await jest.advanceTimersByTimeAsync(1100);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          processId: 'proc-1',
          oldStatus: 'healthy',
          newStatus: 'unhealthy',
        }),
        'Process health status changed'
      );
    });
  });

  describe('Critical Health Events', () => {
    it('should emit health:critical after consecutive failures', async () => {
      const proxy = createMockProxy('unhealthy');

      const handler = jest.fn();
      checker.on('health:critical', handler);

      checker.startMonitoring('proc-1', proxy, { interval: 100, timeout: 50, retries: 1 });

      // Wait for more than 5 consecutive failures
      await jest.advanceTimersByTimeAsync(800);

      expect(handler).toHaveBeenCalled();
    });

    it('should reset failure count on healthy check', async () => {
      const proxy = createMockProxy('unhealthy');
      let currentStatus: IHealthStatus['status'] = 'unhealthy';

      (proxy.__getHealth as jest.Mock).mockImplementation(async () => ({
        status: currentStatus,
        checks: [],
        timestamp: Date.now(),
      }));

      const handler = jest.fn();
      checker.on('health:critical', handler);

      checker.startMonitoring('proc-1', proxy, { interval: 100, timeout: 50, retries: 1 });

      // 3 failures
      await jest.advanceTimersByTimeAsync(350);

      // Recover
      currentStatus = 'healthy';
      await jest.advanceTimersByTimeAsync(150);

      // 3 more failures
      currentStatus = 'unhealthy';
      await jest.advanceTimersByTimeAsync(350);

      // Should not have emitted critical because count was reset
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Analyze Trends', () => {
    it('should analyze stable trends', async () => {
      const proxy = createMockProxy('healthy');

      checker.startMonitoring('proc-1', proxy, { interval: 100 });

      await jest.advanceTimersByTimeAsync(2500);

      const analysis = checker.analyzeTrends('proc-1');

      expect(analysis.trend).toBe('stable');
      expect(analysis.availability).toBe(1);
    });

    it('should analyze improving trends', async () => {
      const proxy = createMockProxy('healthy');
      let checkCount = 0;

      (proxy.__getHealth as jest.Mock).mockImplementation(async () => {
        checkCount++;
        // First 10 are mostly unhealthy, last 10 are healthy
        const status = checkCount <= 10 ? (checkCount <= 8 ? 'unhealthy' : 'healthy') : 'healthy';
        return { status, checks: [], timestamp: Date.now() };
      });

      checker.startMonitoring('proc-1', proxy, { interval: 100 });

      await jest.advanceTimersByTimeAsync(2500);

      const analysis = checker.analyzeTrends('proc-1');

      expect(analysis.trend).toBe('improving');
    });

    it('should analyze degrading trends', async () => {
      const proxy = createMockProxy('healthy');
      let checkCount = 0;

      (proxy.__getHealth as jest.Mock).mockImplementation(async () => {
        checkCount++;
        // First 10 (older history) should be mostly healthy
        // Last 10 (recent history) should be mostly unhealthy
        // olderHistory is slice(-20, -10), recentHistory is slice(-10)
        // So with 20 checks: checks 1-10 are older (healthy), checks 11-20 are recent (unhealthy)
        const status = checkCount <= 10 ? 'healthy' : 'unhealthy';
        return { status, checks: [], timestamp: Date.now() };
      });

      checker.startMonitoring('proc-1', proxy, { interval: 100 });

      // Need at least 20 checks: 10 for older, 10 for recent
      await jest.advanceTimersByTimeAsync(2200);

      const analysis = checker.analyzeTrends('proc-1');

      expect(analysis.trend).toBe('degrading');
    });

    it('should return stable for insufficient history', () => {
      const proxy = createMockProxy('healthy');

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });

      // Only 1 check
      const analysis = checker.analyzeTrends('proc-1');

      expect(analysis.trend).toBe('stable');
    });

    it('should return stable for unknown process', () => {
      const analysis = checker.analyzeTrends('unknown');

      expect(analysis.trend).toBe('stable');
      expect(analysis.availability).toBe(0);
    });

    it('should calculate availability correctly', async () => {
      const proxy = createMockProxy('healthy');
      let checkCount = 0;

      (proxy.__getHealth as jest.Mock).mockImplementation(async () => {
        checkCount++;
        // Alternate between healthy and unhealthy
        const status = checkCount % 2 === 0 ? 'unhealthy' : 'healthy';
        return { status, checks: [], timestamp: Date.now() };
      });

      checker.startMonitoring('proc-1', proxy, { interval: 100 });

      await jest.advanceTimersByTimeAsync(1100);

      const analysis = checker.analyzeTrends('proc-1');

      expect(analysis.availability).toBeCloseTo(0.5, 1);
    });
  });

  describe('Error Handling', () => {
    it('should handle health check errors gracefully', async () => {
      const proxy = createMockProxy();
      (proxy.__getHealth as jest.Mock).mockRejectedValue(new Error('Network error'));

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 1 });

      await jest.advanceTimersByTimeAsync(1500);

      expect(mockLogger.error).toHaveBeenCalled();
      expect(checker.isHealthy('proc-1')).toBe(false);
    });

    it('should record error health status', async () => {
      const proxy = createMockProxy();
      (proxy.__getHealth as jest.Mock).mockRejectedValue(new Error('Check failed'));

      checker.startMonitoring('proc-1', proxy, { interval: 1000, timeout: 5000, retries: 1 });

      await jest.advanceTimersByTimeAsync(1500);

      const health = checker.getHealth('proc-1');
      expect(health?.status).toBe('unhealthy');
      expect(health?.checks[0].status).toBe('fail');
      expect(health?.checks[0].message).toContain('Check failed');
    });
  });

  describe('Multiple Processes', () => {
    it('should monitor multiple processes independently', async () => {
      const proxy1 = createMockProxy('healthy');
      const proxy2 = createMockProxy('unhealthy');

      checker.startMonitoring('proc-1', proxy1, { interval: 1000 });
      checker.startMonitoring('proc-2', proxy2, { interval: 1000 });

      await jest.advanceTimersByTimeAsync(100);

      expect(checker.isHealthy('proc-1')).toBe(true);
      expect(checker.isHealthy('proc-2')).toBe(false);
    });

    it('should stop monitoring independently', async () => {
      const proxy1 = createMockProxy();
      const proxy2 = createMockProxy();

      checker.startMonitoring('proc-1', proxy1, { interval: 1000 });
      checker.startMonitoring('proc-2', proxy2, { interval: 1000 });

      await jest.advanceTimersByTimeAsync(100);

      checker.stopMonitoring('proc-1');

      await jest.advanceTimersByTimeAsync(1500);

      expect(checker.getHealth('proc-1')).toBeNull();
      expect(checker.getHealth('proc-2')).not.toBeNull();
    });
  });

  describe('Health Status Timestamp', () => {
    it('should include timestamp in health status', async () => {
      const proxy = createMockProxy();

      checker.startMonitoring('proc-1', proxy, { interval: 1000 });

      await jest.advanceTimersByTimeAsync(100);

      const health = checker.getHealth('proc-1');
      expect(health?.timestamp).toBeDefined();
      expect(typeof health?.timestamp).toBe('number');
    });
  });
});
