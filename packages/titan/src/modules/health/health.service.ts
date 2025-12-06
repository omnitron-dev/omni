/**
 * Health Service
 *
 * Main service for managing health indicators and performing health checks.
 *
 * @module titan/modules/health
 */

import { Injectable } from '../../decorators/index.js';
import type {
  IHealthService,
  IHealthIndicator,
  HealthIndicatorResult,
  HealthCheckResult,
  HealthStatus,
  HealthModuleOptions,
} from './health.types.js';
import { Errors } from '../../errors/index.js';

/**
 * Default options for the health service
 */
const DEFAULT_OPTIONS: Required<
  Pick<HealthModuleOptions, 'timeout' | 'enableCaching' | 'cacheTtl'>
> = {
  timeout: 5000,
  enableCaching: false,
  cacheTtl: 1000,
};

/**
 * Cache entry structure
 */
interface CacheEntry {
  result: HealthCheckResult;
  expiresAt: number;
}

/**
 * Health service implementation
 *
 * @example
 * ```typescript
 * const healthService = container.resolve(HealthService);
 *
 * // Register custom indicator
 * healthService.registerIndicator(new DatabaseHealthIndicator());
 *
 * // Run all health checks
 * const result = await healthService.check();
 * console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
 *
 * // Check specific indicator
 * const dbHealth = await healthService.checkOne('database');
 *
 * // Simple boolean check
 * if (await healthService.isHealthy()) {
 *   console.log('System is healthy');
 * }
 * ```
 */
@Injectable()
export class HealthService implements IHealthService {
  private indicators: Map<string, IHealthIndicator> = new Map();
  private options: Required<Pick<HealthModuleOptions, 'timeout' | 'enableCaching' | 'cacheTtl'>>;
  private cache: CacheEntry | null = null;
  private startTime: number;

  constructor(options: HealthModuleOptions = {}) {
    this.options = {
      timeout: options.timeout ?? DEFAULT_OPTIONS.timeout,
      enableCaching: options.enableCaching ?? DEFAULT_OPTIONS.enableCaching,
      cacheTtl: options.cacheTtl ?? DEFAULT_OPTIONS.cacheTtl,
    };
    this.startTime = Date.now();
  }

  /**
   * Register a health indicator
   */
  registerIndicator(indicator: IHealthIndicator): void {
    if (!indicator.name) {
      throw Errors.badRequest('Health indicator must have a name');
    }
    if (this.indicators.has(indicator.name)) {
      throw Errors.conflict(`Health indicator '${indicator.name}' is already registered`);
    }
    this.indicators.set(indicator.name, indicator);
    // Invalidate cache when indicators change
    this.cache = null;
  }

  /**
   * Unregister a health indicator
   */
  unregisterIndicator(name: string): boolean {
    const result = this.indicators.delete(name);
    if (result) {
      // Invalidate cache when indicators change
      this.cache = null;
    }
    return result;
  }

  /**
   * Run all health checks
   */
  async check(): Promise<HealthCheckResult> {
    // Check cache first
    if (this.options.enableCaching && this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.result;
    }

    const start = Date.now();
    const indicators: Record<string, HealthIndicatorResult> = {};
    const statuses: HealthStatus[] = [];

    // Run all indicator checks in parallel with timeout
    const indicatorEntries = Array.from(this.indicators.entries());
    const results = await Promise.allSettled(
      indicatorEntries.map(async ([name, indicator]) => {
        return {
          name,
          result: await this.runWithTimeout(indicator),
        };
      })
    );

    // Process results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { name, result: indicatorResult } = result.value;
        indicators[name] = indicatorResult;
        statuses.push(indicatorResult.status);
      } else {
        // Find the indicator name from the error context
        const index = results.indexOf(result);
        const name = indicatorEntries[index]?.[0] || 'unknown';
        indicators[name] = {
          status: 'unhealthy',
          message: result.reason?.message || 'Health check failed',
          error: {
            message: result.reason?.message || 'Unknown error',
          },
          timestamp: new Date(),
        };
        statuses.push('unhealthy');
      }
    }

    // Determine overall status
    const status = this.getWorstStatus(statuses);
    const totalLatency = Date.now() - start;

    const checkResult: HealthCheckResult = {
      status,
      indicators,
      timestamp: new Date(),
      totalLatency,
      uptime: Date.now() - this.startTime,
    };

    // Cache the result
    if (this.options.enableCaching) {
      this.cache = {
        result: checkResult,
        expiresAt: Date.now() + this.options.cacheTtl,
      };
    }

    return checkResult;
  }

  /**
   * Run a single health check by name
   */
  async checkOne(name: string): Promise<HealthIndicatorResult> {
    const indicator = this.indicators.get(name);
    if (!indicator) {
      throw Errors.notFound('Health indicator', name);
    }

    return this.runWithTimeout(indicator);
  }

  /**
   * Check if overall system is healthy
   */
  async isHealthy(): Promise<boolean> {
    const result = await this.check();
    return result.status === 'healthy';
  }

  /**
   * Check if overall system is ready (for Kubernetes readiness probes)
   * Ready means the system can accept traffic (healthy or degraded)
   */
  async isReady(): Promise<boolean> {
    const result = await this.check();
    return result.status !== 'unhealthy';
  }

  /**
   * Check if system is alive (for Kubernetes liveness probes)
   * Alive is a simpler check - just that the process is responsive
   */
  async isAlive(): Promise<boolean> {
    // Basic liveness check - if we can respond, we're alive
    return true;
  }

  /**
   * Get list of registered indicator names
   */
  getIndicators(): string[] {
    return Array.from(this.indicators.keys());
  }

  /**
   * Get a registered indicator by name
   */
  getIndicator(name: string): IHealthIndicator | undefined {
    return this.indicators.get(name);
  }

  /**
   * Check if an indicator is registered
   */
  hasIndicator(name: string): boolean {
    return this.indicators.has(name);
  }

  /**
   * Get the number of registered indicators
   */
  getIndicatorCount(): number {
    return this.indicators.size;
  }

  /**
   * Clear all registered indicators
   */
  clearIndicators(): void {
    this.indicators.clear();
    this.cache = null;
  }

  /**
   * Invalidate the health check cache
   */
  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * Get the service uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Run indicator with timeout
   */
  private async runWithTimeout(indicator: IHealthIndicator): Promise<HealthIndicatorResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          status: 'unhealthy',
          message: `Health check timed out after ${this.options.timeout}ms`,
          timestamp: new Date(),
        });
      }, this.options.timeout);

      indicator
        .check()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          resolve({
            status: 'unhealthy',
            message: error?.message || 'Health check failed',
            error: {
              message: error?.message || 'Unknown error',
              code: error?.code,
            },
            timestamp: new Date(),
          });
        });
    });
  }

  /**
   * Get the worst status from multiple statuses
   */
  private getWorstStatus(statuses: HealthStatus[]): HealthStatus {
    if (statuses.length === 0) return 'healthy';

    const severity = {
      healthy: 0,
      degraded: 1,
      unhealthy: 2,
    };

    return statuses.reduce((worst, current) => {
      return severity[current] > severity[worst] ? current : worst;
    }, 'healthy' as HealthStatus);
  }
}
