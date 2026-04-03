/**
 * Cache Health Indicators
 *
 * Health check implementations for cache monitoring:
 * - Memory usage tracking
 * - Hit rate monitoring
 * - Latency measurements
 * - Connection status for L2 caches
 *
 * @module titan/modules/cache
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import type { ICacheService, ICacheStats, ICacheHealthIndicator } from './cache.types.js';
import { CACHE_SERVICE_TOKEN } from './cache.tokens.js';

/**
 * Health check result
 */
export interface CacheHealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Health check thresholds configuration
 */
export interface CacheHealthThresholds {
  /** Minimum acceptable hit rate (0-1, default: 0.5) */
  minHitRate?: number;
  /** Maximum acceptable memory usage in bytes */
  maxMemoryUsage?: number;
  /** Maximum acceptable get latency in microseconds (default: 10000 = 10ms) */
  maxGetLatency?: number;
  /** Maximum acceptable set latency in microseconds (default: 50000 = 50ms) */
  maxSetLatency?: number;
  /** Maximum acceptable eviction rate (evictions per minute, default: 100) */
  maxEvictionRate?: number;
  /** Minimum operations before health check applies (default: 100) */
  minOperations?: number;
}

/**
 * Default health thresholds
 */
const DEFAULT_THRESHOLDS: Required<CacheHealthThresholds> = {
  minHitRate: 0.5,
  maxMemoryUsage: 512 * 1024 * 1024, // 512MB
  maxGetLatency: 10000, // 10ms
  maxSetLatency: 50000, // 50ms
  maxEvictionRate: 100,
  minOperations: 100,
};

/**
 * Cache Health Indicator
 *
 * Monitors cache health and reports status.
 *
 * @example
 * ```typescript
 * const healthIndicator = new CacheHealthIndicator(cacheService, {
 *   minHitRate: 0.6,
 *   maxGetLatency: 5000,
 * });
 *
 * const result = await healthIndicator.check();
 * console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
 * ```
 */
@Injectable()
export class CacheHealthIndicator implements ICacheHealthIndicator {
  readonly name = 'cache';

  private readonly thresholds: Required<CacheHealthThresholds>;
  private lastEvictionCount: number = 0;
  private lastCheckTime: number = Date.now();

  constructor(
    @Inject(CACHE_SERVICE_TOKEN) private readonly cacheService: ICacheService,
    thresholds: CacheHealthThresholds = {}
  ) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Perform health check
   */
  async check(): Promise<CacheHealthCheckResult> {
    try {
      const stats = this.cacheService.getGlobalStats();
      const issues: string[] = [];
      const warnings: string[] = [];

      const totalOps = stats.hits + stats.misses;
      const now = Date.now();
      const timeSinceLastCheck = (now - this.lastCheckTime) / 1000 / 60; // minutes
      const evictionRate = timeSinceLastCheck > 0 ? (stats.evictions - this.lastEvictionCount) / timeSinceLastCheck : 0;

      // Update tracking
      this.lastEvictionCount = stats.evictions;
      this.lastCheckTime = now;

      // Only check thresholds if we have enough operations
      if (totalOps >= this.thresholds.minOperations) {
        // Check hit rate
        if (stats.hitRate < this.thresholds.minHitRate) {
          const severity = stats.hitRate < this.thresholds.minHitRate * 0.5 ? 'critical' : 'warning';
          const message = `Low hit rate: ${(stats.hitRate * 100).toFixed(1)}% (threshold: ${(this.thresholds.minHitRate * 100).toFixed(1)}%)`;
          if (severity === 'critical') {
            issues.push(message);
          } else {
            warnings.push(message);
          }
        }

        // Check get latency
        if (stats.avgGetLatency > this.thresholds.maxGetLatency) {
          const severity = stats.avgGetLatency > this.thresholds.maxGetLatency * 2 ? 'critical' : 'warning';
          const message = `High get latency: ${(stats.avgGetLatency / 1000).toFixed(2)}ms (threshold: ${(this.thresholds.maxGetLatency / 1000).toFixed(2)}ms)`;
          if (severity === 'critical') {
            issues.push(message);
          } else {
            warnings.push(message);
          }
        }

        // Check set latency
        if (stats.avgSetLatency > this.thresholds.maxSetLatency) {
          const severity = stats.avgSetLatency > this.thresholds.maxSetLatency * 2 ? 'critical' : 'warning';
          const message = `High set latency: ${(stats.avgSetLatency / 1000).toFixed(2)}ms (threshold: ${(this.thresholds.maxSetLatency / 1000).toFixed(2)}ms)`;
          if (severity === 'critical') {
            issues.push(message);
          } else {
            warnings.push(message);
          }
        }
      }

      // Check memory usage (always)
      if (stats.memoryUsage > this.thresholds.maxMemoryUsage) {
        const severity = stats.memoryUsage > this.thresholds.maxMemoryUsage * 1.5 ? 'critical' : 'warning';
        const message = `High memory usage: ${this.formatBytes(stats.memoryUsage)} (threshold: ${this.formatBytes(this.thresholds.maxMemoryUsage)})`;
        if (severity === 'critical') {
          issues.push(message);
        } else {
          warnings.push(message);
        }
      }

      // Check eviction rate
      if (evictionRate > this.thresholds.maxEvictionRate) {
        warnings.push(
          `High eviction rate: ${evictionRate.toFixed(1)}/min (threshold: ${this.thresholds.maxEvictionRate}/min)`
        );
      }

      // Determine status
      let status: 'healthy' | 'degraded' | 'unhealthy';
      let message: string;

      if (issues.length > 0) {
        status = 'unhealthy';
        message = issues.join('; ');
      } else if (warnings.length > 0) {
        status = 'degraded';
        message = warnings.join('; ');
      } else {
        status = 'healthy';
        message = `Cache operating normally. Hit rate: ${(stats.hitRate * 100).toFixed(1)}%, Size: ${stats.size} entries`;
      }

      return {
        status,
        message,
        details: {
          caches: this.cacheService.listCaches(),
          totalEntries: stats.size,
          memoryUsage: stats.memoryUsage,
          memoryUsageFormatted: this.formatBytes(stats.memoryUsage),
          hitRate: stats.hitRate,
          hitRateFormatted: `${(stats.hitRate * 100).toFixed(1)}%`,
          hits: stats.hits,
          misses: stats.misses,
          evictions: stats.evictions,
          expirations: stats.expirations,
          evictionRate,
          avgGetLatencyMs: stats.avgGetLatency / 1000,
          avgSetLatencyMs: stats.avgSetLatency / 1000,
          uptime: Date.now() - stats.createdAt.getTime(),
          lastAccess: stats.lastAccessAt.toISOString(),
          thresholds: this.thresholds,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Cache health check failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { error: String(error) },
      };
    }
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

/**
 * Multi-tier cache health indicator
 *
 * Extended health checks for multi-tier caches with L1/L2 monitoring.
 */
@Injectable()
export class MultiTierCacheHealthIndicator implements ICacheHealthIndicator {
  readonly name = 'cache:multi-tier';

  private readonly thresholds: Required<CacheHealthThresholds>;
  private readonly l2PingTimeout: number;

  constructor(
    @Inject(CACHE_SERVICE_TOKEN) private readonly cacheService: ICacheService,
    thresholds: CacheHealthThresholds = {},
    l2PingTimeout: number = 5000
  ) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.l2PingTimeout = l2PingTimeout;
  }

  /**
   * Perform comprehensive health check for multi-tier cache
   */
  async check(): Promise<CacheHealthCheckResult> {
    try {
      const stats = this.cacheService.getGlobalStats();
      const issues: string[] = [];
      const warnings: string[] = [];

      // Check L1 stats
      if (stats.l1) {
        const l1Issues = this.checkTierStats('L1', stats.l1);
        issues.push(...l1Issues.issues);
        warnings.push(...l1Issues.warnings);
      }

      // Check L2 stats
      if (stats.l2) {
        const l2Issues = this.checkTierStats('L2', stats.l2);
        issues.push(...l2Issues.issues);
        warnings.push(...l2Issues.warnings);
      }

      // Check overall hit rate
      const totalOps = stats.hits + stats.misses;
      if (totalOps >= this.thresholds.minOperations && stats.hitRate < this.thresholds.minHitRate) {
        warnings.push(`Overall hit rate low: ${(stats.hitRate * 100).toFixed(1)}%`);
      }

      // Determine status
      let status: 'healthy' | 'degraded' | 'unhealthy';
      let message: string;

      if (issues.length > 0) {
        status = 'unhealthy';
        message = issues.join('; ');
      } else if (warnings.length > 0) {
        status = 'degraded';
        message = warnings.join('; ');
      } else {
        status = 'healthy';
        message = 'Multi-tier cache operating normally';
      }

      return {
        status,
        message,
        details: {
          caches: this.cacheService.listCaches(),
          overall: {
            hitRate: stats.hitRate,
            size: stats.size,
            memoryUsage: stats.memoryUsage,
          },
          l1: stats.l1
            ? {
                hitRate: stats.l1.hitRate,
                size: stats.l1.size,
                memoryUsage: stats.l1.memoryUsage,
                avgGetLatencyMs: stats.l1.avgGetLatency / 1000,
              }
            : null,
          l2: stats.l2
            ? {
                hitRate: stats.l2.hitRate,
                size: stats.l2.size,
                avgGetLatencyMs: stats.l2.avgGetLatency / 1000,
              }
            : null,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Multi-tier cache health check failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { error: String(error) },
      };
    }
  }

  /**
   * Check stats for a specific tier
   */
  private checkTierStats(tier: string, stats: ICacheStats): { issues: string[]; warnings: string[] } {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check latency
    if (stats.avgGetLatency > this.thresholds.maxGetLatency) {
      if (stats.avgGetLatency > this.thresholds.maxGetLatency * 3) {
        issues.push(`${tier} get latency critical: ${(stats.avgGetLatency / 1000).toFixed(2)}ms`);
      } else {
        warnings.push(`${tier} get latency high: ${(stats.avgGetLatency / 1000).toFixed(2)}ms`);
      }
    }

    // L1-specific checks
    if (tier === 'L1') {
      // L1 should have high hit rate
      const totalOps = stats.hits + stats.misses;
      if (totalOps >= this.thresholds.minOperations && stats.hitRate < 0.7) {
        warnings.push(`${tier} hit rate low: ${(stats.hitRate * 100).toFixed(1)}% (consider increasing L1 size)`);
      }
    }

    // L2-specific checks
    if (tier === 'L2') {
      // L2 latency should still be reasonable
      if (stats.avgGetLatency > 50000) {
        // 50ms
        warnings.push(`${tier} latency high: ${(stats.avgGetLatency / 1000).toFixed(2)}ms (check Redis connection)`);
      }
    }

    return { issues, warnings };
  }
}

/**
 * Create a cache health indicator with custom thresholds
 */
export function createCacheHealthIndicator(
  cacheService: ICacheService,
  thresholds?: CacheHealthThresholds
): CacheHealthIndicator {
  return new CacheHealthIndicator(cacheService, thresholds);
}

/**
 * Create a multi-tier cache health indicator
 */
export function createMultiTierCacheHealthIndicator(
  cacheService: ICacheService,
  thresholds?: CacheHealthThresholds,
  l2PingTimeout?: number
): MultiTierCacheHealthIndicator {
  return new MultiTierCacheHealthIndicator(cacheService, thresholds, l2PingTimeout);
}
