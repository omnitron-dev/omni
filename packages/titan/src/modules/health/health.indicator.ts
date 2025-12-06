/**
 * Health Indicator Base Class
 *
 * Abstract base class for implementing health indicators.
 * Provides common functionality and helper methods.
 *
 * @module titan/modules/health
 */

import type { HealthStatus, HealthIndicatorResult, IHealthIndicator } from './health.types.js';

/**
 * Abstract base class for health indicators
 *
 * @example
 * ```typescript
 * class DatabaseHealthIndicator extends HealthIndicator {
 *   readonly name = 'database';
 *
 *   async check(): Promise<HealthIndicatorResult> {
 *     const start = Date.now();
 *     try {
 *       await this.db.ping();
 *       return this.healthy('Database connection is active', {
 *         latency: Date.now() - start
 *       });
 *     } catch (error) {
 *       return this.unhealthy('Database connection failed', {
 *         error: error.message
 *       });
 *     }
 *   }
 * }
 * ```
 */
export abstract class HealthIndicator implements IHealthIndicator {
  /**
   * Unique name of this health indicator
   * Must be implemented by subclasses
   */
  abstract readonly name: string;

  /**
   * Perform the health check
   * Must be implemented by subclasses
   */
  abstract check(): Promise<HealthIndicatorResult>;

  /**
   * Create a healthy result
   */
  protected healthy(message?: string, details?: Record<string, unknown>): HealthIndicatorResult {
    return this.createResult('healthy', message, details);
  }

  /**
   * Create a degraded result
   */
  protected degraded(message?: string, details?: Record<string, unknown>): HealthIndicatorResult {
    return this.createResult('degraded', message, details);
  }

  /**
   * Create an unhealthy result
   */
  protected unhealthy(
    message?: string,
    details?: Record<string, unknown>,
    error?: Error
  ): HealthIndicatorResult {
    const result = this.createResult('unhealthy', message, details);
    if (error) {
      result.error = {
        message: error.message,
        code: (error as any).code,
        stack: process.env['NODE_ENV'] !== 'production' ? error.stack : undefined,
      };
    }
    return result;
  }

  /**
   * Create a result based on a condition
   */
  protected createResultFromCondition(
    isHealthy: boolean,
    healthyMessage?: string,
    unhealthyMessage?: string,
    details?: Record<string, unknown>
  ): HealthIndicatorResult {
    return isHealthy
      ? this.healthy(healthyMessage, details)
      : this.unhealthy(unhealthyMessage, details);
  }

  /**
   * Create a result with a specific status
   */
  protected createResult(
    status: HealthStatus,
    message?: string,
    details?: Record<string, unknown>
  ): HealthIndicatorResult {
    return {
      status,
      message,
      details,
      timestamp: new Date(),
    };
  }

  /**
   * Helper to measure latency of an async operation
   */
  protected async withLatency<T>(
    operation: () => Promise<T>
  ): Promise<{ result: T; latency: number }> {
    const start = Date.now();
    const result = await operation();
    const latency = Date.now() - start;
    return { result, latency };
  }

  /**
   * Helper to run a check with timeout
   */
  protected async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage = 'Health check timed out'
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Check if a result indicates healthy status
   */
  isHealthy(result?: HealthIndicatorResult): boolean {
    return result?.status === 'healthy';
  }

  /**
   * Check if a result indicates degraded status
   */
  isDegraded(result?: HealthIndicatorResult): boolean {
    return result?.status === 'degraded';
  }

  /**
   * Check if a result indicates unhealthy status
   */
  isUnhealthy(result?: HealthIndicatorResult): boolean {
    return result?.status === 'unhealthy';
  }

  /**
   * Get the severity level of a status (for comparison)
   */
  protected getStatusSeverity(status: HealthStatus): number {
    switch (status) {
      case 'healthy':
        return 0;
      case 'degraded':
        return 1;
      case 'unhealthy':
        return 2;
      default:
        return 2;
    }
  }

  /**
   * Get the worst status from multiple statuses
   */
  protected getWorstStatus(statuses: HealthStatus[]): HealthStatus {
    if (statuses.length === 0) return 'healthy';

    return statuses.reduce((worst, current) => {
      return this.getStatusSeverity(current) > this.getStatusSeverity(worst) ? current : worst;
    }, 'healthy' as HealthStatus);
  }
}

/**
 * Composite health indicator that aggregates multiple indicators
 *
 * @example
 * ```typescript
 * const composite = new CompositeHealthIndicator(
 *   'external-services',
 *   [redisIndicator, databaseIndicator, cacheIndicator]
 * );
 * const result = await composite.check();
 * ```
 */
export class CompositeHealthIndicator extends HealthIndicator {
  readonly name: string;
  private indicators: IHealthIndicator[];

  constructor(name: string, indicators: IHealthIndicator[] = []) {
    super();
    this.name = name;
    this.indicators = indicators;
  }

  /**
   * Add an indicator to the composite
   */
  addIndicator(indicator: IHealthIndicator): this {
    this.indicators.push(indicator);
    return this;
  }

  /**
   * Remove an indicator from the composite
   */
  removeIndicator(name: string): boolean {
    const index = this.indicators.findIndex((i) => i.name === name);
    if (index >= 0) {
      this.indicators.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Check all indicators and aggregate results
   */
  async check(): Promise<HealthIndicatorResult> {
    const start = Date.now();
    const results = await Promise.allSettled(this.indicators.map((i) => i.check()));

    const indicatorResults: Record<string, HealthIndicatorResult> = {};
    const statuses: HealthStatus[] = [];

    results.forEach((result, index) => {
      const indicator = this.indicators[index];
      if (!indicator) return;

      if (result.status === 'fulfilled') {
        indicatorResults[indicator.name] = result.value;
        statuses.push(result.value.status);
      } else {
        indicatorResults[indicator.name] = {
          status: 'unhealthy',
          message: result.reason?.message || 'Health check failed',
          error: {
            message: result.reason?.message || 'Unknown error',
          },
          timestamp: new Date(),
        };
        statuses.push('unhealthy');
      }
    });

    const overallStatus = this.getWorstStatus(statuses);
    const latency = Date.now() - start;

    return {
      status: overallStatus,
      message: 'Composite check of ' + this.indicators.length + ' indicators',
      details: {
        indicators: indicatorResults,
        indicatorCount: this.indicators.length,
      },
      latency,
      timestamp: new Date(),
    };
  }
}
