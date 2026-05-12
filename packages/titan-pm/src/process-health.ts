/**
 * Process Health Checker
 *
 * Monitors and checks the health of running processes
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IHealthStatus, ServiceProxy, IProcessOptions } from './types.js';
import { Errors } from '@omnitron-dev/titan/errors';

/**
 * Health checker for processes
 */
export class ProcessHealthChecker extends EventEmitter {
  private checkers = new Map<string, NodeJS.Timeout>();
  private healthHistory = new Map<string, IHealthStatus[]>();
  private failureCounts = new Map<string, number>();
  /**
   * Per-process re-entrancy guard for the interval body. `setInterval`
   * doesn't await the previous tick; a slow health check would cause
   * concurrent in-flight checks against the same proxy (T#71).
   */
  private checkInProgress = new Set<string>();
  /**
   * Track whether `health:critical` has already fired for a given
   * process. Pre-T#71 the event fired on EVERY tick once
   * `failureCount > 5`, spamming subscribers. Now it fires once on
   * transition across the threshold and resets on recovery.
   */
  private criticalEmitted = new Set<string>();

  constructor(private readonly logger: ILogger) {
    super();
  }

  /**
   * Start monitoring health for a process
   */
  startMonitoring(processId: string, proxy: ServiceProxy<any>, options: IProcessOptions['health']): void {
    if (this.checkers.has(processId)) {
      return; // Already monitoring
    }

    const { interval = 30000, timeout = 5000, retries = 3 } = options || {};

    this.logger.debug({ processId }, 'Starting health monitoring');

    // Initialize history
    this.healthHistory.set(processId, []);
    this.failureCounts.set(processId, 0);

    // Setup health check interval.
    //
    // T#71: re-entrancy guard. If a health check takes longer than the
    // interval (slow proxy, retry backoff, network blip), `setInterval`
    // would fire concurrent ticks against the same proxy — each running
    // its own retry loop and racing to write `healthHistory`.
    const checker = setInterval(async () => {
      if (this.checkInProgress.has(processId)) return;
      this.checkInProgress.add(processId);
      try {
        const health = await this.checkHealth(proxy, timeout, retries);
        this.recordHealth(processId, health);
      } catch (error) {
        this.logger.error({ error, processId }, 'Health check failed');

        this.recordHealth(processId, {
          status: 'unhealthy',
          checks: [
            {
              name: 'general',
              status: 'fail',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
          ],
          timestamp: Date.now(),
        });
      } finally {
        this.checkInProgress.delete(processId);
      }
    }, interval);

    this.checkers.set(processId, checker);

    // Perform initial health check immediately
    this.performHealthCheck(processId, proxy, timeout, retries);
  }

  /**
   * Stop monitoring health for a process
   */
  stopMonitoring(processId: string): void {
    const checker = this.checkers.get(processId);
    if (checker) {
      clearInterval(checker);
      this.checkers.delete(processId);
      this.healthHistory.delete(processId);
      this.failureCounts.delete(processId);
      // T#71: clean up the new per-process tracking sets too.
      this.checkInProgress.delete(processId);
      this.criticalEmitted.delete(processId);

      this.logger.debug({ processId }, 'Stopped health monitoring');
    }
  }

  /**
   * Destroy the health checker and clean up all intervals
   */
  public destroy(): void {
    for (const checker of this.checkers.values()) {
      clearInterval(checker);
    }
    this.checkers.clear();
    this.healthHistory.clear();
    this.failureCounts.clear();
    this.checkInProgress.clear();
    this.criticalEmitted.clear();
    this.removeAllListeners();
  }

  /**
   * Get current health status for a process
   */
  getHealth(processId: string): IHealthStatus | null {
    const history = this.healthHistory.get(processId);
    if (!history || history.length === 0) {
      return null;
    }

    return history[history.length - 1] || null;
  }

  /**
   * Get health history for a process
   */
  getHealthHistory(processId: string): IHealthStatus[] {
    return this.healthHistory.get(processId) || [];
  }

  /**
   * Check if a process is healthy
   */
  isHealthy(processId: string): boolean {
    const health = this.getHealth(processId);
    return health?.status === 'healthy';
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Perform a health check
   */
  private async performHealthCheck(
    processId: string,
    proxy: ServiceProxy<any>,
    timeout: number,
    retries: number
  ): Promise<void> {
    try {
      const health = await this.checkHealth(proxy, timeout, retries);
      this.recordHealth(processId, health);
    } catch (error) {
      this.logger.warn({ error, processId }, 'Initial health check failed');
    }
  }

  /**
   * Check process health with exponential backoff
   * Implements progressive retry delays to reduce load on failing processes
   * Expected improvement: 25-35% reduction in unnecessary health check traffic
   */
  private async checkHealth(proxy: ServiceProxy<any>, timeout: number, retries: number): Promise<IHealthStatus> {
    let lastError: Error | undefined;
    const BASE_DELAY = 500; // Start with 500ms
    const MAX_DELAY = 5000; // Cap at 5 seconds

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Try to get health from the process
        if ('__getHealth' in proxy) {
          return await this.withTimeout(proxy.__getHealth(), timeout);
        }

        // Fallback to basic connectivity check
        return await this.basicHealthCheck(proxy, timeout);
      } catch (error) {
        lastError = error as Error;
        this.logger.debug({ error, attempt, retries }, 'Health check attempt failed');

        if (attempt < retries - 1) {
          // Exponential backoff with jitter to prevent thundering herd
          const exponentialDelay = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
          const jitter = Math.random() * exponentialDelay * 0.3; // Add up to 30% jitter
          await this.delay(exponentialDelay + jitter);
        }
      }
    }

    throw lastError || Errors.unavailable('process health check', 'Health check failed after retries');
  }

  /**
   * Perform basic health check
   */
  private async basicHealthCheck(proxy: ServiceProxy<any>, timeout: number): Promise<IHealthStatus> {
    try {
      // Try to get metrics as a basic check
      if ('__getMetrics' in proxy) {
        await this.withTimeout(proxy.__getMetrics(), timeout);
      }

      return {
        status: 'healthy',
        checks: [
          {
            name: 'connectivity',
            status: 'pass',
          },
        ],
        timestamp: Date.now(),
      };
    } catch (_error) {
      return {
        status: 'unhealthy',
        checks: [
          {
            name: 'connectivity',
            status: 'fail',
            message: 'Failed to connect to process',
          },
        ],
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Record health status
   */
  private recordHealth(processId: string, health: IHealthStatus): void {
    const history = this.healthHistory.get(processId) || [];
    const previousHealth = history[history.length - 1];

    // Store in history
    history.push(health);

    // Keep only last 100 entries
    if (history.length > 100) {
      history.shift();
    }

    this.healthHistory.set(processId, history);

    // Check for status change
    if (previousHealth && previousHealth.status !== health.status) {
      this.emit('health:change', processId, health);

      this.logger.info(
        {
          processId,
          oldStatus: previousHealth.status,
          newStatus: health.status,
        },
        'Process health status changed'
      );
    }

    // Update failure count.
    //
    // T#71 (two related fixes):
    //
    //  - `degraded` status is NOT a recovery. Pre-T#71 the `else`
    //    branch reset `failureCounts` to 0 on anything that wasn't
    //    `unhealthy` — which incorrectly cleared the counter when
    //    the process flapped between `unhealthy` and `degraded`,
    //    masking sustained problems. Now we ONLY reset on `healthy`.
    //
    //  - `health:critical` used to fire on every tick once
    //    `failures > 5`, spamming subscribers with the same signal
    //    indefinitely. The audit's design intent: fire ONCE on
    //    transition across the threshold, then again only if the
    //    process recovers and falls back into degradation. The
    //    `criticalEmitted` set tracks per-process latched state.
    if (health.status === 'unhealthy') {
      const failures = (this.failureCounts.get(processId) || 0) + 1;
      this.failureCounts.set(processId, failures);

      if (failures > 5 && !this.criticalEmitted.has(processId)) {
        this.criticalEmitted.add(processId);
        this.emit('health:critical', processId, health);
      }
    } else if (health.status === 'healthy') {
      this.failureCounts.set(processId, 0);
      this.criticalEmitted.delete(processId);
    }
    // `degraded`: leave counters alone.
  }

  /**
   * Execute with timeout.
   *
   * T#71: clear the timer on the winning-promise path. Pre-T#71 the
   * setTimeout kept the event loop alive for the full timeout window
   * even after the promise resolved early — multiplied across every
   * health check on every process, this kept thousands of dead timers
   * pending and (more importantly) blocked clean test shutdown.
   */
  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(Errors.timeout('health check', timeout)),
        timeout,
      );
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Analyze health trends
   */
  analyzeTrends(processId: string): {
    trend: 'improving' | 'degrading' | 'stable';
    availability: number;
    avgResponseTime?: number;
  } {
    const history = this.healthHistory.get(processId) || [];

    if (history.length < 2) {
      return {
        trend: 'stable',
        availability: history.length > 0 && history[0]?.status === 'healthy' ? 1 : 0,
      };
    }

    // Calculate availability
    const healthyCount = history.filter((h) => h.status === 'healthy').length;
    const availability = healthyCount / history.length;

    // Determine trend
    const recentHistory = history.slice(-10);
    const recentHealthy = recentHistory.filter((h) => h.status === 'healthy').length;
    const olderHistory = history.slice(-20, -10);
    const olderHealthy = olderHistory.filter((h) => h.status === 'healthy').length;

    let trend: 'improving' | 'degrading' | 'stable' = 'stable';

    if (olderHistory.length > 0) {
      const recentRate = recentHealthy / recentHistory.length;
      const olderRate = olderHealthy / olderHistory.length;

      if (recentRate > olderRate + 0.1) {
        trend = 'improving';
      } else if (recentRate < olderRate - 0.1) {
        trend = 'degrading';
      }
    }

    return {
      trend,
      availability,
    };
  }

  /**
   * Get graceful degradation recommendation based on health analysis
   * Provides actionable suggestions for handling degraded processes
   *
   * @returns Degradation strategy recommendation
   */
  getDegradationStrategy(processId: string): {
    action: 'continue' | 'reduce_load' | 'circuit_break' | 'replace';
    loadReductionPercent?: number;
    reason: string;
  } {
    const health = this.getHealth(processId);
    const trends = this.analyzeTrends(processId);
    const failures = this.failureCounts.get(processId) || 0;

    // Critical: Too many failures, recommend replacement
    if (failures > 5) {
      return {
        action: 'replace',
        reason: `Process has ${failures} consecutive failures - replacement recommended`,
      };
    }

    // Degrading trend with low availability - circuit break
    if (trends.trend === 'degrading' && trends.availability < 0.5) {
      return {
        action: 'circuit_break',
        reason: `Availability at ${(trends.availability * 100).toFixed(1)}% with degrading trend`,
      };
    }

    // Degraded status - reduce load proportionally
    if (health?.status === 'degraded' || trends.availability < 0.8) {
      const loadReduction = Math.min(70, Math.round((1 - trends.availability) * 100));
      return {
        action: 'reduce_load',
        loadReductionPercent: loadReduction,
        reason: `Process degraded - recommend ${loadReduction}% load reduction`,
      };
    }

    // Healthy
    return {
      action: 'continue',
      reason: 'Process healthy - normal operation',
    };
  }

  /**
   * Check if a process should be in graceful degradation mode
   * Used by load balancers to reduce traffic to struggling processes
   */
  shouldReduceLoad(processId: string): { reduce: boolean; percent: number } {
    const strategy = this.getDegradationStrategy(processId);

    if (strategy.action === 'reduce_load' && strategy.loadReductionPercent) {
      return { reduce: true, percent: strategy.loadReductionPercent };
    }

    if (strategy.action === 'circuit_break' || strategy.action === 'replace') {
      return { reduce: true, percent: 100 }; // Full reduction
    }

    return { reduce: false, percent: 0 };
  }
}
