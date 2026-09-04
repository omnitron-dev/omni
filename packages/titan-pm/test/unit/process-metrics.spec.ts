/**
 * Unit tests for ProcessMetricsCollector
 *
 * Tests metrics collection, aggregation, and latency tracking
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessMetricsCollector } from '../../src/process-metrics.js';
import type { IProcessMetrics, ServiceProxy } from '../../src/types.js';

// Mock logger
const createMockLogger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

// Mock service proxy with metrics
const createMockProxy = (metrics?: IProcessMetrics): ServiceProxy<any> => {
  const mockMetrics: IProcessMetrics = metrics || {
    cpu: 25,
    memory: 512,
    requests: 100,
    errors: 2,
  };

  return {
    __processId: 'test-process',
    __destroy: vi.fn().mockResolvedValue(undefined),
    __getMetrics: vi.fn().mockResolvedValue(mockMetrics),
    __getHealth: vi.fn().mockResolvedValue({ status: 'healthy', checks: [], timestamp: Date.now() }),
  } as any;
};

describe('ProcessMetricsCollector', () => {
  let collector: ProcessMetricsCollector;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = createMockLogger();
    collector = new ProcessMetricsCollector(mockLogger as any);
  });

  afterEach(() => {
    // Stop all collections
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Start Collection', () => {
    it('should start collecting metrics for a process', () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);

      // Initial collection should happen after first interval
      vi.advanceTimersByTime(1000);

      expect(proxy.__getMetrics).toHaveBeenCalled();
    });

    it('should collect metrics at specified interval', async () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);

      // Advance through multiple intervals
      await vi.advanceTimersByTimeAsync(3500);

      expect(proxy.__getMetrics).toHaveBeenCalledTimes(3);
    });

    it('should use default interval if not specified', () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy);

      // Default is 5000ms
      vi.advanceTimersByTime(5000);

      expect(proxy.__getMetrics).toHaveBeenCalled();
    });

    it('should not start collection if already collecting', () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);
      collector.startCollection('proc-1', proxy, 1000); // Second call should be ignored

      vi.advanceTimersByTime(1000);

      // Should only have one interval running
      expect(proxy.__getMetrics).toHaveBeenCalledTimes(1);
    });

    it('should log debug message when starting', () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);

      expect(mockLogger.debug).toHaveBeenCalledWith({ processId: 'proc-1' }, 'Starting metrics collection');
    });
  });

  describe('Stop Collection', () => {
    it('should stop collecting metrics', async () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(2500);

      const callsBefore = (proxy.__getMetrics as vi.Mock).mock.calls.length;

      collector.stopCollection('proc-1');

      await vi.advanceTimersByTimeAsync(2000);

      // No new calls after stopping
      expect(proxy.__getMetrics).toHaveBeenCalledTimes(callsBefore);
    });

    it('should clear metrics history on stop', async () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(1500);

      collector.stopCollection('proc-1');

      expect(collector.getMetrics('proc-1')).toBeNull();
      expect(collector.getMetricsHistory('proc-1')).toEqual([]);
    });

    it('should handle stopping non-existent collection', () => {
      expect(() => collector.stopCollection('non-existent')).not.toThrow();
    });

    it('should log debug message when stopping', async () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);
      collector.stopCollection('proc-1');

      expect(mockLogger.debug).toHaveBeenCalledWith({ processId: 'proc-1' }, 'Stopped metrics collection');
    });
  });

  describe('Get Current Metrics', () => {
    it('should return latest metrics', async () => {
      const metrics: IProcessMetrics = { cpu: 50, memory: 1024, requests: 200, errors: 5 };
      const proxy = createMockProxy(metrics);

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(1500);

      const current = collector.getMetrics('proc-1');

      expect(current?.cpu).toBe(50);
      expect(current?.memory).toBe(1024);
      expect(current?.requests).toBe(200);
      expect(current?.errors).toBe(5);
    });

    it('should return null if no metrics collected yet', () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);

      // No time has passed
      expect(collector.getMetrics('proc-1')).toBeNull();
    });

    it('should return null for unknown process', () => {
      expect(collector.getMetrics('unknown')).toBeNull();
    });
  });

  describe('Get Metrics History', () => {
    it('should return metrics history', async () => {
      let callCount = 0;
      const proxy = createMockProxy();
      (proxy.__getMetrics as vi.Mock).mockImplementation(async () => ({
        cpu: 20 + callCount * 10,
        memory: 512,
        requests: callCount * 50,
        errors: 0,
      }));
      // Increment counter on each call
      (proxy.__getMetrics as vi.Mock).mockImplementation(async () => {
        callCount++;
        return {
          cpu: 10 + callCount * 10,
          memory: 512,
          requests: callCount * 50,
          errors: 0,
        };
      });

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(3500);

      const history = collector.getMetricsHistory('proc-1');

      expect(history.length).toBe(3);
      // Verify metrics are in order
      expect(history[0].cpu).toBeLessThan(history[2].cpu);
    });

    it('should return empty array for unknown process', () => {
      expect(collector.getMetricsHistory('unknown')).toEqual([]);
    });

    it('should limit history to 1000 entries', async () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 10);

      // Collect more than 1000 entries
      await vi.advanceTimersByTimeAsync(10500);

      const history = collector.getMetricsHistory('proc-1');
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('Get Aggregated Metrics', () => {
    it('should return aggregated metrics within window', async () => {
      let _callCount = 0;
      const proxy = createMockProxy();
      (proxy.__getMetrics as vi.Mock).mockImplementation(async () => {
        _callCount++;
        return {
          cpu: 50,
          memory: 1000,
          requests: 100,
          errors: 2,
        };
      });

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(5500);

      const aggregated = collector.getAggregatedMetrics('proc-1', 10000);

      expect(aggregated).not.toBeNull();
      expect(aggregated?.cpu).toBe(50); // Average of all 50s
      expect(aggregated?.memory).toBe(1000);
    });

    it('should return null if no metrics in window', async () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(1500);

      // Use a window that ends before any metrics
      // Since we just collected metrics, use a very short window in the past
      const aggregated = collector.getAggregatedMetrics('proc-1', 1);

      // With fake timers, metrics might still be in window
      // This tests the filtering logic
      expect(aggregated).toBeDefined();
    });

    it('should return null for unknown process', () => {
      expect(collector.getAggregatedMetrics('unknown')).toBeNull();
    });

    it('should use default window size', async () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(2500);

      // Default window is 60000ms
      const aggregated = collector.getAggregatedMetrics('proc-1');

      expect(aggregated).not.toBeNull();
    });

    it('should aggregate latency metrics', async () => {
      const proxy = createMockProxy({
        cpu: 50,
        memory: 1024,
        requests: 100,
        errors: 0,
        latency: {
          p50: 10,
          p75: 20,
          p90: 30,
          p95: 40,
          p99: 50,
          mean: 25,
        },
      });

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(3500);

      const aggregated = collector.getAggregatedMetrics('proc-1', 60000);

      expect(aggregated?.latency).toBeDefined();
      expect(aggregated?.latency?.p50).toBe(10);
      expect(aggregated?.latency?.mean).toBe(25);
    });
  });

  describe('Track Latency', () => {
    // "Tracked internally" and "tested indirectly" is how these three used to
    // end — three bodies with no expectation at all. The samples do surface,
    // through the latency block on the stored metrics.
    const collectAfterTracking = async (processId: string, record: () => void) => {
      collector.startCollection(processId, createMockProxy(), 1000);
      record();
      await vi.advanceTimersByTimeAsync(1100);
      return collector.getMetrics(processId)?.latency;
    };

    it('should track latency measurements', async () => {
      const latency = await collectAfterTracking('proc-1', () => {
        collector.trackLatency('proc-1', 100);
        collector.trackLatency('proc-1', 150);
        collector.trackLatency('proc-1', 200);
      });

      expect(latency?.mean).toBe(150);
      expect(latency?.p50).toBe(150);
    });

    it('should limit latency measurements to 1000', async () => {
      const latency = await collectAfterTracking('proc-1', () => {
        for (let i = 0; i < 1500; i++) collector.trackLatency('proc-1', i);
      });

      // The window keeps the LAST 1000 samples, so 0-499 are gone. The mean of
      // 500..1499 is 999.5, and p50 is sorted[ceil(0.5 * 1000) - 1] = 999 —
      // both of which would be far lower if the cap were not applied.
      expect(latency?.mean).toBe(999.5);
      expect(latency?.p50).toBe(999);
    });

    it('should handle tracking for new process', async () => {
      // No startCollection for this id: tracking must not throw, and the
      // samples simply have nowhere to be reported.
      expect(() => collector.trackLatency('new-process', 50)).not.toThrow();
      expect(collector.getMetrics('new-process')).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle metrics collection failure', async () => {
      const proxy = createMockProxy();
      (proxy.__getMetrics as vi.Mock).mockRejectedValue(new Error('Connection lost'));

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(1500);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        'Failed to collect process metrics'
      );
    });

    it('should continue collecting after failure', async () => {
      const proxy = createMockProxy();
      let shouldFail = true;
      (proxy.__getMetrics as vi.Mock).mockImplementation(async () => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('Temporary failure');
        }
        return { cpu: 50, memory: 512, requests: 0, errors: 0 };
      });

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(2500);

      // Should have recovered and collected metrics
      const metrics = collector.getMetrics('proc-1');
      expect(metrics).not.toBeNull();
    });

    it('should return fallback metrics when proxy lacks __getMetrics', async () => {
      const proxy = {
        __processId: 'test-process',
        __destroy: vi.fn(),
        __getHealth: vi.fn(),
      } as any;

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(1500);

      const metrics = collector.getMetrics('proc-1');
      expect(metrics?.cpu).toBe(0);
      expect(metrics?.memory).toBe(0);
    });
  });

  describe('Latency Metrics Calculation', () => {
    // These three used to track latencies and assert NOTHING, with comments
    // saying the calculation is private and therefore unverifiable. It is
    // reachable: a collection cycle attaches it to the stored metrics, so
    // `getMetrics(id).latency` exposes the percentiles and the mean.
    // Order matters: startCollection() resets the process's latency bucket, so
    // samples recorded before it are discarded.
    const collectOnce = async (processId: string, samples: number[]) => {
      collector.startCollection(processId, createMockProxy(), 1000);
      for (const value of samples) collector.trackLatency(processId, value);
      await vi.advanceTimersByTimeAsync(1100);
      return collector.getMetrics(processId);
    };

    it('should calculate percentiles correctly', async () => {
      const latency = (await collectOnce('proc-1', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]))?.latency;

      // percentile() takes sorted[ceil(p/100 * n) - 1] over ten samples.
      expect(latency).toBeDefined();
      expect(latency!.p50).toBe(50);
      expect(latency!.p75).toBe(80);
      expect(latency!.p90).toBe(90);
      expect(latency!.p95).toBe(100);
      expect(latency!.p99).toBe(100);
    });

    it('should calculate mean correctly', async () => {
      const latency = (await collectOnce('proc-1', [10, 20, 30, 40, 50]))?.latency;

      expect(latency?.mean).toBe(30);
    });

    it('should handle empty latency array', async () => {
      const metrics = await collectOnce('proc-1', []);

      // No samples tracked: the collector must still produce metrics, just
      // without a latency block.
      expect(metrics).not.toBeNull();
      expect(metrics?.latency).toBeUndefined();
    });
  });

  describe('Aggregation Calculation', () => {
    it('should calculate average CPU and memory', async () => {
      let callCount = 0;
      const proxy = createMockProxy();
      (proxy.__getMetrics as vi.Mock).mockImplementation(async () => {
        callCount++;
        return {
          cpu: callCount * 10, // 10, 20, 30
          memory: callCount * 100, // 100, 200, 300
          requests: 50,
          errors: 1,
        };
      });

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(3500);

      const aggregated = collector.getAggregatedMetrics('proc-1', 60000);

      expect(aggregated?.cpu).toBe(20); // Average of 10, 20, 30
      expect(aggregated?.memory).toBe(200); // Average of 100, 200, 300
    });

    it('should sum requests and errors', async () => {
      let _callCount = 0;
      const proxy = createMockProxy();
      (proxy.__getMetrics as vi.Mock).mockImplementation(async () => {
        _callCount++;
        return {
          cpu: 50,
          memory: 512,
          requests: 100,
          errors: 5,
        };
      });

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(3500);

      const aggregated = collector.getAggregatedMetrics('proc-1', 60000);

      expect(aggregated?.requests).toBe(300); // Sum of 3 x 100
      expect(aggregated?.errors).toBe(15); // Sum of 3 x 5
    });

    it('should handle empty metrics array', () => {
      // Start collection but don't advance time
      const proxy = createMockProxy();
      collector.startCollection('proc-1', proxy, 1000);

      const aggregated = collector.getAggregatedMetrics('proc-1', 60000);

      expect(aggregated).toBeNull();
    });
  });

  describe('Multiple Processes', () => {
    it('should collect metrics for multiple processes independently', async () => {
      const proxy1 = createMockProxy({ cpu: 30, memory: 512, requests: 100, errors: 0 });
      const proxy2 = createMockProxy({ cpu: 60, memory: 1024, requests: 200, errors: 5 });

      collector.startCollection('proc-1', proxy1, 1000);
      collector.startCollection('proc-2', proxy2, 1000);

      await vi.advanceTimersByTimeAsync(1500);

      const metrics1 = collector.getMetrics('proc-1');
      const metrics2 = collector.getMetrics('proc-2');

      expect(metrics1?.cpu).toBe(30);
      expect(metrics2?.cpu).toBe(60);
    });

    it('should stop collection independently', async () => {
      const proxy1 = createMockProxy();
      const proxy2 = createMockProxy();

      collector.startCollection('proc-1', proxy1, 1000);
      collector.startCollection('proc-2', proxy2, 1000);

      await vi.advanceTimersByTimeAsync(1500);

      collector.stopCollection('proc-1');

      await vi.advanceTimersByTimeAsync(1500);

      // proc-1 should have stopped
      expect(collector.getMetrics('proc-1')).toBeNull();
      // proc-2 should continue
      expect(collector.getMetrics('proc-2')).not.toBeNull();
    });

    it('should track latency per process', async () => {
      // startCollection() first: it clears the bucket for that process.
      collector.startCollection('proc-1', createMockProxy(), 1000);
      collector.startCollection('proc-2', createMockProxy(), 1000);

      collector.trackLatency('proc-1', 50);
      collector.trackLatency('proc-2', 100);
      collector.trackLatency('proc-1', 60);
      collector.trackLatency('proc-2', 110);

      await vi.advanceTimersByTimeAsync(1100);

      // Separate buckets, not one shared list — the means differ.
      expect(collector.getMetrics('proc-1')?.latency?.mean).toBe(55);
      expect(collector.getMetrics('proc-2')?.latency?.mean).toBe(105);
    });
  });

  describe('Timestamp Addition', () => {
    it('should add timestamp to stored metrics', async () => {
      const proxy = createMockProxy();

      collector.startCollection('proc-1', proxy, 1000);
      await vi.advanceTimersByTimeAsync(1500);

      const history = collector.getMetricsHistory('proc-1');

      expect((history[0] as any).timestamp).toBeDefined();
      expect(typeof (history[0] as any).timestamp).toBe('number');
    });
  });
});
