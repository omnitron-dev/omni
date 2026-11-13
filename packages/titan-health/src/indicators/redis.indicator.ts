/**
 * Redis Health Indicator
 *
 * Monitors Redis connectivity and performance.
 * Compatible with ioredis and node-redis clients.
 *
 * @module titan/modules/health
 */

import { HealthIndicator } from '../health.indicator.js';
import type { HealthIndicatorResult, IRedisClient, RedisIndicatorOptions } from '../health.types.js';

/**
 * Default thresholds
 */
const DEFAULT_OPTIONS: Required<RedisIndicatorOptions> = {
  latencyDegradedThreshold: 10,
  latencyUnhealthyThreshold: 100,
  timeout: 5000,
  includeMemoryInfo: false,
  memoryDegradedThreshold: 0.8,
  memoryUnhealthyThreshold: 0.95,
};

const PING_TIMEOUT = new Error('Redis PING timed out');
const CONNECTION_STATES = new Set(['wait', 'connecting', 'connect', 'reconnecting', 'close', 'end']);

function parseMemoryInfo(info: string) {
  const lines = info.split('\r\n');
  const bytes = (key: string): number => {
    const prefix = key + ':';
    const value = lines.find(line => line.startsWith(prefix))?.slice(prefix.length);
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error('Invalid Redis memory statistics');
    }
    return Number(value);
  };

  const used = bytes('used_memory');
  const peak = bytes('used_memory_peak');
  const maxmemory = bytes('maxmemory');
  return { used, peak, maxmemory, usedRatio: maxmemory > 0 ? used / maxmemory : 0 };
}

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

  private readonly options: Required<RedisIndicatorOptions>;
  private client?: IRedisClient;

  constructor(client?: IRedisClient, options: RedisIndicatorOptions = {}) {
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
    const client = this.client;
    if (!client) return this.unhealthy('Redis client not configured');

    try {
      const { status, isReady } = client;
      if (status !== undefined && status !== 'ready') {
        const details = CONNECTION_STATES.has(status) ? { status } : undefined;
        return this.unhealthy('Redis not ready', details);
      }
      if (isReady !== undefined && isReady !== true) return this.unhealthy('Redis not ready');

      const start = performance.now();
      const reply = await this.withTimeout(() => client.ping(), this.options.timeout, PING_TIMEOUT);
      const pingLatency = Math.floor(performance.now() - start);
      if (reply !== 'PONG') return this.unhealthy('Redis PING returned an unexpected reply');

      const details: Record<string, unknown> = {
        latency: pingLatency,
        threshold: {
          degraded: this.options.latencyDegradedThreshold,
          unhealthy: this.options.latencyUnhealthyThreshold,
        },
      };

      // Optionally include memory info
      let memoryStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (this.options.includeMemoryInfo && client.info) {
        try {
          const remaining = this.options.timeout - (performance.now() - start);
          if (remaining <= 0) throw new Error('Redis INFO timed out');
          const info = await this.withTimeout(() => client.info!('memory'), remaining);
          const memoryInfo = parseMemoryInfo(info);
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
        const memory = memoryStatus === 'degraded' ? ', memory=degraded' : '';
        return this.degraded(`Redis degraded: latency=${pingLatency}ms${memory}`, details);
      }

      return this.healthy(`Redis responding in ${pingLatency}ms`, details);
    } catch (error) {
      // Driver messages and errors may contain connection or request data.
      return this.unhealthy(error === PING_TIMEOUT ? 'Redis PING timed out' : 'Redis PING failed');
    }
  }
}
