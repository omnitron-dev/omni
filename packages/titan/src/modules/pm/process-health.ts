/**
 * Process Health Checker
 *
 * Monitors and checks the health of running processes
 */

import { EventEmitter } from 'events';
import type { ILogger } from '../logger/logger.types.js';
import type {
  IHealthStatus,
  ServiceProxy,
  IProcessOptions
} from './types.js';
import { Errors } from '../../errors/factories.js';

/**
 * Health checker for processes
 */
export class ProcessHealthChecker extends EventEmitter {
  private checkers = new Map<string, NodeJS.Timeout>();
  private healthHistory = new Map<string, IHealthStatus[]>();
  private failureCounts = new Map<string, number>();

  constructor(private readonly logger: ILogger) {
    super();
  }

  /**
   * Start monitoring health for a process
   */
  startMonitoring(
    processId: string,
    proxy: ServiceProxy<any>,
    options: IProcessOptions['health']
  ): void {
    if (this.checkers.has(processId)) {
      return; // Already monitoring
    }

    const {
      interval = 30000,
      timeout = 5000,
      retries = 3
    } = options || {};

    this.logger.debug({ processId }, 'Starting health monitoring');

    // Initialize history
    this.healthHistory.set(processId, []);
    this.failureCounts.set(processId, 0);

    // Setup health check interval
    const checker = setInterval(async () => {
      try {
        const health = await this.checkHealth(proxy, timeout, retries);
        this.recordHealth(processId, health);
      } catch (error) {
        this.logger.error(
          { error, processId },
          'Health check failed'
        );

        this.recordHealth(processId, {
          status: 'unhealthy',
          checks: [{
            name: 'general',
            status: 'fail',
            message: error instanceof Error ? error.message : 'Unknown error'
          }],
          timestamp: Date.now()
        });
      }
    }, interval);

    this.checkers.set(processId, checker);

    // Perform initial health check
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

      this.logger.debug({ processId }, 'Stopped health monitoring');
    }
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
      this.logger.error(
        { error, processId },
        'Initial health check failed'
      );
    }
  }

  /**
   * Check process health
   */
  private async checkHealth(
    proxy: ServiceProxy<any>,
    timeout: number,
    retries: number
  ): Promise<IHealthStatus> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Try to get health from the process
        if ('__getHealth' in proxy) {
          return await this.withTimeout(
            proxy.__getHealth(),
            timeout
          );
        }

        // Fallback to basic connectivity check
        return await this.basicHealthCheck(proxy, timeout);
      } catch (error) {
        lastError = error as Error;
        this.logger.debug(
          { error, attempt },
          'Health check attempt failed'
        );

        if (attempt < retries - 1) {
          await this.delay(1000); // Wait before retry
        }
      }
    }

    throw lastError || Errors.unavailable('process health check', 'Health check failed after retries');
  }

  /**
   * Perform basic health check
   */
  private async basicHealthCheck(
    proxy: ServiceProxy<any>,
    timeout: number
  ): Promise<IHealthStatus> {
    try {
      // Try to get metrics as a basic check
      if ('__getMetrics' in proxy) {
        await this.withTimeout(proxy.__getMetrics(), timeout);
      }

      return {
        status: 'healthy',
        checks: [{
          name: 'connectivity',
          status: 'pass'
        }],
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        checks: [{
          name: 'connectivity',
          status: 'fail',
          message: 'Failed to connect to process'
        }],
        timestamp: Date.now()
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
          newStatus: health.status
        },
        'Process health status changed'
      );
    }

    // Update failure count
    if (health.status === 'unhealthy') {
      const failures = (this.failureCounts.get(processId) || 0) + 1;
      this.failureCounts.set(processId, failures);

      // Emit critical event if too many failures
      if (failures > 5) {
        this.emit('health:critical', processId, health);
      }
    } else {
      this.failureCounts.set(processId, 0);
    }
  }

  /**
   * Execute with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(Errors.timeout('health check', timeout)), timeout)
      )
    ]);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        availability: history.length > 0 && history[0]?.status === 'healthy' ? 1 : 0
      };
    }

    // Calculate availability
    const healthyCount = history.filter(h => h.status === 'healthy').length;
    const availability = healthyCount / history.length;

    // Determine trend
    const recentHistory = history.slice(-10);
    const recentHealthy = recentHistory.filter(h => h.status === 'healthy').length;
    const olderHistory = history.slice(-20, -10);
    const olderHealthy = olderHistory.filter(h => h.status === 'healthy').length;

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
      availability
    };
  }
}