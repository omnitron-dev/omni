/**
 * Priceverse - Metrics Service
 * Collects and tracks application metrics
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import { Interval, Schedulable } from '@omnitron-dev/titan/module/scheduler';
import type { SupportedExchange } from '../../shared/types.js';

export interface MetricsSnapshot {
  priceUpdates: number;
  dbQueries: number;
  dbQueryTime: number;
  redisOps: number;
  cacheHits: number;
  cacheMisses: number;
  exchangeStatus: Record<string, boolean>;
  system: {
    memoryUsage: number;
    memoryTotal: number;
    cpuUsage: number;
  };
  timestamp: string;
}

@Injectable()
@Schedulable()
export class MetricsService {
  // Counters
  private priceUpdates = 0;
  private dbQueries = 0;
  private dbQueryTimeTotal = 0;
  private redisOps = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  // Exchange status
  private exchangeStatus: Record<string, boolean> = {};

  // System metrics
  private systemMetrics = {
    memoryUsage: 0,
    memoryTotal: 0,
    cpuUsage: 0,
  };

  // Previous CPU usage for delta calculation
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastCpuTime = 0;

  /**
   * Get current metrics snapshot
   */
  getMetrics(): MetricsSnapshot {
    return {
      priceUpdates: this.priceUpdates,
      dbQueries: this.dbQueries,
      dbQueryTime: this.dbQueries > 0 ? this.dbQueryTimeTotal / this.dbQueries : 0,
      redisOps: this.redisOps,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      exchangeStatus: { ...this.exchangeStatus },
      system: { ...this.systemMetrics },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Record a price update
   */
  recordPriceUpdate(): void {
    this.priceUpdates++;
  }

  /**
   * Record a database query with execution time
   */
  recordDbQuery(durationMs: number): void {
    this.dbQueries++;
    this.dbQueryTimeTotal += durationMs;
  }

  /**
   * Record a Redis operation
   */
  recordRedisOp(): void {
    this.redisOps++;
  }

  /**
   * Record a cache hit
   */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Record a cache miss
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Set exchange connection status
   */
  setExchangeStatus(exchange: SupportedExchange, connected: boolean): void {
    this.exchangeStatus[exchange] = connected;
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total > 0 ? this.cacheHits / total : 0;
  }

  /**
   * Reset all counters (useful for testing or periodic resets)
   */
  reset(): void {
    this.priceUpdates = 0;
    this.dbQueries = 0;
    this.dbQueryTimeTotal = 0;
    this.redisOps = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.exchangeStatus = {};
  }

  /**
   * Collect system metrics - called every second by scheduler
   * Can also be called manually to force an update
   */
  @Interval(1000)
  collectSystemMetrics(): void {
    // Memory metrics
    const memUsage = process.memoryUsage();
    this.systemMetrics.memoryUsage = memUsage.heapUsed;
    this.systemMetrics.memoryTotal = memUsage.heapTotal;

    // CPU metrics - calculate actual utilization percentage
    const currentTime = Date.now();
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage ?? undefined);

    if (this.lastCpuUsage !== null && this.lastCpuTime > 0) {
      // Calculate elapsed time in microseconds
      const elapsedMs = currentTime - this.lastCpuTime;
      const elapsedMicros = elapsedMs * 1000;

      // Total CPU time used (user + system) in microseconds
      const totalCpuMicros = currentCpuUsage.user + currentCpuUsage.system;

      // Calculate CPU percentage (capped at 100% per core)
      // Note: Can exceed 100% on multi-core systems
      this.systemMetrics.cpuUsage = (totalCpuMicros / elapsedMicros) * 100;
    }

    // Store for next calculation
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = currentTime;
  }
}
