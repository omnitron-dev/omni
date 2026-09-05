/**
 * Redis Health Indicator Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RedisHealthIndicator } from '../src/indicators/redis.indicator.js';
import type { IRedisClient } from '../src/indicators/redis.indicator.js';

// Mock Redis client
const createMockRedisClient = (
  options: {
    latency?: number;
    status?: string;
    isReady?: boolean;
    shouldFail?: boolean;
    error?: Error;
    memoryInfo?: {
      used: number;
      peak: number;
      maxmemory: number;
    };
  } = {}
): IRedisClient => {
  const { latency = 0, status = 'ready', isReady = true, shouldFail = false, error, memoryInfo } = options;

  const client: IRedisClient = {
    status,
    isReady,
    ping: async () => {
      // Only sleep when a test is actually about latency. The default used to
      // be 5 ms, which every test paid whether or not it cared: `setTimeout(5)`
      // measures 5.0–6.4 ms on an idle machine, against a default
      // `latencyDegradedThreshold` of 10 — so more than half the margin was
      // spent before the scheduler got involved, and under `turbo test` the
      // rest went too. The tests that failed were the ones about MEMORY and
      // about `status`, which never mentioned latency at all.
      if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
      if (shouldFail) {
        throw error || new Error('Redis connection failed');
      }
      return 'PONG';
    },
  };

  if (memoryInfo) {
    client.info = async (section?: string) => {
      if (section !== 'memory') return '';
      return `used_memory:${memoryInfo.used}\r\nused_memory_peak:${memoryInfo.peak}\r\nmaxmemory:${memoryInfo.maxmemory}\r\n`;
    };
  }

  return client;
};

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;

  beforeEach(() => {
    indicator = new RedisHealthIndicator();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const ind = new RedisHealthIndicator();
      expect(ind.name).toBe('redis');
    });

    it('should create with client', () => {
      const client = createMockRedisClient();
      const ind = new RedisHealthIndicator(client);
      expect(ind.name).toBe('redis');
    });

    it('should create with custom options', () => {
      const ind = new RedisHealthIndicator(undefined, {
        latencyDegradedThreshold: 5,
        latencyUnhealthyThreshold: 50,
        timeout: 3000,
        includeMemoryInfo: true,
      });
      expect(ind.name).toBe('redis');
    });
  });

  /**
 * Threshold for tests that assert `healthy` for a reason other than latency.
 *
 * Scheduling delay only ever moves a measured latency UP, so the cases
 * asserting `degraded` / `unhealthy` are robust by construction and the ones
 * asserting `healthy` are the fragile half. Rather than trimming margins one
 * test at a time — this file already carried one such local workaround — every
 * "healthy for some other reason" case gets a threshold no scheduler crosses.
 * The comparison itself is still tested, from both sides, by the latency cases
 * below.
 */
const NO_LATENCY_BUDGET = { latencyDegradedThreshold: 60_000, latencyUnhealthyThreshold: 60_000 };

describe('setClient', () => {
    it('should set client for lazy initialization', async () => {
      const ind = new RedisHealthIndicator(undefined, NO_LATENCY_BUDGET);
      ind.setClient(createMockRedisClient());

      const result = await ind.check();

      expect(result.status).toBe('healthy');
    });
  });

  describe('check', () => {
    it('should return unhealthy when client not configured', async () => {
      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('not configured');
    });

    it('should return unhealthy when status is not ready', async () => {
      indicator.setClient(createMockRedisClient({ status: 'connecting' }));
      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('not ready');
    });

    it('should return unhealthy when isReady is false', async () => {
      const client = createMockRedisClient({ isReady: false });
      // Remove status to test isReady path
      delete client.status;
      indicator.setClient(client);
      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('not ready');
    });

    it('should return healthy for fast response', async () => {
      // The claim is "measured latency below the threshold ⇒ healthy", and it
      // is asserted as that relationship rather than as an absolute time, so a
      // busy scheduler cannot turn it into a failure.
      indicator = new RedisHealthIndicator(createMockRedisClient({ latency: 2 }), NO_LATENCY_BUDGET);
      const result = await indicator.check();
      expect(result.status).toBe('healthy');
      expect(result.details?.latency).toBeTypeOf('number');
      expect(result.details?.latency as number).toBeLessThan(NO_LATENCY_BUDGET.latencyDegradedThreshold);
    });

    it('should return degraded for slow response', async () => {
      indicator = new RedisHealthIndicator(createMockRedisClient({ latency: 20 }), {
        latencyDegradedThreshold: 10,
        latencyUnhealthyThreshold: 100,
      });

      const result = await indicator.check();
      expect(result.status).toBe('degraded');
      expect(result.message).toContain('degraded');
    });

    it('should return unhealthy for very slow response', async () => {
      indicator = new RedisHealthIndicator(createMockRedisClient({ latency: 150 }), {
        latencyDegradedThreshold: 10,
        latencyUnhealthyThreshold: 100,
      });

      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('issues');
    });

    it('should return unhealthy on ping error', async () => {
      indicator.setClient(
        createMockRedisClient({
          shouldFail: true,
          error: new Error('Connection reset'),
        })
      );

      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Connection reset');
    });

    it('should handle timeout', async () => {
      indicator = new RedisHealthIndicator(createMockRedisClient({ latency: 200 }), {
        timeout: 50,
      });

      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('timed out');
    });

    it('should include threshold info in details', async () => {
      indicator = new RedisHealthIndicator(createMockRedisClient(), {
        latencyDegradedThreshold: 5,
        latencyUnhealthyThreshold: 50,
      });

      const result = await indicator.check();
      expect(result.details?.threshold).toEqual({
        degraded: 5,
        unhealthy: 50,
      });
    });
  });

  describe('memory info', () => {
    it('should not include memory info by default', async () => {
      indicator.setClient(
        createMockRedisClient({
          memoryInfo: { used: 1000, peak: 2000, maxmemory: 10000 },
        })
      );

      const result = await indicator.check();
      expect(result.details?.['memory']).toBeUndefined();
    });

    it('should include memory info when enabled', async () => {
      indicator = new RedisHealthIndicator(
        createMockRedisClient({
          memoryInfo: { used: 1000, peak: 2000, maxmemory: 10000 },
        }),
        { includeMemoryInfo: true }
      );

      const result = await indicator.check();
      expect(result.details?.['memory']).toBeDefined();
      const memory = result.details?.['memory'] as any;
      expect(memory.used).toBe(1000);
      expect(memory.peak).toBe(2000);
      expect(memory.maxmemory).toBe(10000);
      expect(memory.usedRatio).toBe(0.1);
    });

    it('should return degraded when memory usage is high', async () => {
      indicator = new RedisHealthIndicator(
        createMockRedisClient({
          memoryInfo: { used: 8500, peak: 9000, maxmemory: 10000 },
        }),
        {
          includeMemoryInfo: true,
          memoryDegradedThreshold: 0.8,
          memoryUnhealthyThreshold: 0.95,
        }
      );

      const result = await indicator.check();
      expect(result.status).toBe('degraded');
    });

    it('should return unhealthy when memory usage is critical', async () => {
      indicator = new RedisHealthIndicator(
        createMockRedisClient({
          memoryInfo: { used: 9700, peak: 9800, maxmemory: 10000 },
        }),
        {
          includeMemoryInfo: true,
          memoryDegradedThreshold: 0.8,
          memoryUnhealthyThreshold: 0.95,
        }
      );

      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
    });

    it('should handle memory info error gracefully', async () => {
      const client = createMockRedisClient();
      client.info = async () => {
        throw new Error('INFO command not supported');
      };

      indicator = new RedisHealthIndicator(client, { includeMemoryInfo: true, ...NO_LATENCY_BUDGET });
      const result = await indicator.check();

      // Should still be healthy since ping succeeded
      expect(result.status).toBe('healthy');
      expect((result.details?.['memory'] as any)?.error).toContain('Failed to retrieve');
    });

    it('should handle zero maxmemory (unlimited)', async () => {
      indicator = new RedisHealthIndicator(
        createMockRedisClient({
          memoryInfo: { used: 5000, peak: 6000, maxmemory: 0 },
        }),
        { includeMemoryInfo: true, ...NO_LATENCY_BUDGET }
      );

      const result = await indicator.check();
      expect(result.status).toBe('healthy');
      const memory = result.details?.['memory'] as any;
      expect(memory.usedRatio).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined status property', async () => {
      const client = createMockRedisClient();
      delete client.status;
      delete client.isReady;
      indicator = new RedisHealthIndicator(client, NO_LATENCY_BUDGET);

      const result = await indicator.check();
      expect(result.status).toBe('healthy');
    });
  });
});
