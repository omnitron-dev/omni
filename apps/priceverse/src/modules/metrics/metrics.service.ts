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

    // CPU metrics (basic approximation using process.cpuUsage())
    const cpuUsage = process.cpuUsage();
    const totalCpu = cpuUsage.user + cpuUsage.system;
    // Convert microseconds to percentage (rough estimate)
    this.systemMetrics.cpuUsage = totalCpu / 10000; // Normalized value
  }
}
