/**
 * Redis Health Indicator
 *
 * Monitors Redis connectivity and performance.
 * Compatible with ioredis and node-redis clients.
 *
 * @module titan/modules/health
 */

import { HealthIndicator } from '../health.indicator.js';
import type { HealthIndicatorResult } from '../health.types.js';

/**
 * Redis health check options
 */
export interface RedisHealthOptions {
  /**
   * Ping latency threshold for degraded status (ms)
   * @default 10
   */
  latencyDegradedThreshold?: number;

  /**
   * Ping latency threshold for unhealthy status (ms)
   * @default 100
   */
  latencyUnhealthyThreshold?: number;

  /**
   * Timeout for health check (ms)
   * @default 5000
   */
  timeout?: number;

  /**
   * Include memory info in health check
   * @default false
   */
  includeMemoryInfo?: boolean;

  /**
   * Memory usage threshold for degraded status (ratio 0-1)
   * @default 0.8 (80%)
   */
  memoryDegradedThreshold?: number;

  /**
   * Memory usage threshold for unhealthy status (ratio 0-1)
   * @default 0.95 (95%)
   */
  memoryUnhealthyThreshold?: number;
}

/**
 * Redis client interface
 * Compatible with ioredis and node-redis
 */
export interface IRedisClient {
  /**
   * Redis PING command
   */
  ping(): Promise<string>;

  /**
   * Redis INFO command (optional, for memory info)
   */
  info?(section?: string): Promise<string>;

  /**
   * Connection status (ioredis)
   */
  status?: string;

  /**
   * Ready state (node-redis)
   */
  isReady?: boolean;
}

/**
 * Default thresholds
 */
const DEFAULT_OPTIONS: Required<RedisHealthOptions> = {
  latencyDegradedThreshold: 10,
  latencyUnhealthyThreshold: 100,
  timeout: 5000,
  includeMemoryInfo: false,
  memoryDegradedThreshold: 0.8,
  memoryUnhealthyThreshold: 0.95,
};

/**
 * Redis Health Indicator
 *
 * Monitors Redis connectivity using PING command.
 * Optionally includes memory usage information.
 *
 * @example
 * ```typescript
 * import Redis from 'ioredis';
 *
 * const redis = new Redis();
 *
 * const indicator = new RedisHealthIndicator(redis, {
 *   latencyDegradedThreshold: 5,
 *   includeMemoryInfo: true,
 * });
 *
 * healthService.registerIndicator(indicator);
 * ```
 */
export class RedisHealthIndicator extends HealthIndicator {
  readonly name = 'redis';

  private readonly options: Required<RedisHealthOptions>;
  private client?: IRedisClient;

  constructor(client?: IRedisClient, options: RedisHealthOptions = {}) {
    super();
    this.client = client;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  /**
   * Set Redis client (for lazy initialization)
   */
  setClient(client: IRedisClient): void {
    this.client = client;
  }

  /**
   * Perform Redis health check
   */
  async check(): Promise<HealthIndicatorResult> {
    if (!this.client) {
      return this.unhealthy('Redis client not configured');
    }

    // Check connection status first (if available)
    if (this.client.status && this.client.status !== 'ready') {
      return this.unhealthy(`Redis not ready: ${this.client.status}`, { status: this.client.status });
    }

    if (this.client.isReady === false) {
      return this.unhealthy('Redis not ready');
    }

    try {
      const start = Date.now();
      await this.withTimeout(() => this.client!.ping(), this.options.timeout);
      const pingLatency = Date.now() - start;

      const details: Record<string, unknown> = {
        latency: pingLatency,
        threshold: {
          degraded: this.options.latencyDegradedThreshold,
          unhealthy: this.options.latencyUnhealthyThreshold,
        },
      };

      // Optionally include memory info
      let memoryStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (this.options.includeMemoryInfo && this.client.info) {
        try {
          const memoryInfo = await this.getMemoryInfo();
          details['memory'] = memoryInfo;

          if (memoryInfo.usedRatio >= this.options.memoryUnhealthyThreshold) {
            memoryStatus = 'unhealthy';
          } else if (memoryInfo.usedRatio >= this.options.memoryDegradedThreshold) {
            memoryStatus = 'degraded';
          }
        } catch {
          // Memory info is optional, don't fail health check
          details['memory'] = { error: 'Failed to retrieve memory info' };
        }
      }

      // Determine overall status
      if (pingLatency >= this.options.latencyUnhealthyThreshold || memoryStatus === 'unhealthy') {
        return this.unhealthy(`Redis issues: latency=${pingLatency}ms, memory=${memoryStatus}`, details);
      }

      if (pingLatency >= this.options.latencyDegradedThreshold || memoryStatus === 'degraded') {
        return this.degraded(`Redis degraded: latency=${pingLatency}ms`, details);
      }

      return this.healthy(`Redis responding in ${pingLatency}ms`, details);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.unhealthy(
        `Redis check failed: ${errorMessage}`,
        undefined,
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }

  /**
   * Get Redis memory info
   */
  private async getMemoryInfo(): Promise<{
    used: number;
    peak: number;
    maxmemory: number;
    usedRatio: number;
  }> {
    if (!this.client?.info) {
      throw new Error('INFO command not available');
    }

    const infoResult = await this.client.info('memory');
    if (!infoResult) {
      throw new Error('INFO command returned empty result');
    }
    const lines = infoResult.split('\r\n');

    const parseValue = (key: string): number => {
      const line = lines.find((l) => l.startsWith(`${key}:`));
      if (!line) return 0;
      const parts = line.split(':');
      const value = parts[1];
      return value ? parseInt(value, 10) || 0 : 0;
    };

    const used = parseValue('used_memory');
    const peak = parseValue('used_memory_peak');
    const maxmemory = parseValue('maxmemory');

    return {
      used,
      peak,
      maxmemory,
      usedRatio: maxmemory > 0 ? used / maxmemory : 0,
    };
  }
}
