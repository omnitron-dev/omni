/**
 * Database Health Indicator
 *
 * Monitors database connectivity and performance.
 * Works with any database that provides a connection/query interface.
 *
 * @module titan/modules/health
 */

import { HealthIndicator } from '../health.indicator.js';
import type { HealthIndicatorResult } from '../health.types.js';

/**
 * Database health check options
 */
export interface DatabaseHealthOptions {
  /**
   * Query latency threshold for degraded status (ms)
   * @default 100
   */
  latencyDegradedThreshold?: number;

  /**
   * Query latency threshold for unhealthy status (ms)
   * @default 1000
   */
  latencyUnhealthyThreshold?: number;

  /**
   * Custom health check query (optional)
   * If not provided, uses 'SELECT 1' for PostgreSQL/MySQL
   */
  healthQuery?: string;

  /**
   * Timeout for health check query (ms)
   * @default 5000
   */
  timeout?: number;
}

/**
 * Database connection interface
 * Compatible with Kysely, pg, mysql2, etc.
 */
export interface IDatabaseConnection {
  /**
   * Execute a raw query
   */
  execute?(query: string): Promise<unknown>;

  /**
   * Alternative: run raw SQL (Kysely pattern)
   */
  raw?(query: string): { execute(): Promise<unknown> };

  /**
   * Alternative: query method (pg pattern)
   */
  query?(query: string): Promise<unknown>;
}

/**
 * Default thresholds
 */
const DEFAULT_OPTIONS: Required<DatabaseHealthOptions> = {
  latencyDegradedThreshold: 100,
  latencyUnhealthyThreshold: 1000,
  healthQuery: 'SELECT 1',
  timeout: 5000,
};

/**
 * Database Health Indicator
 *
 * Monitors database connectivity by executing a simple query.
 * Measures latency and reports health based on response time.
 *
 * @example
 * ```typescript
 * import { Kysely } from 'kysely';
 *
 * const db: Kysely<Database> = ...;
 *
 * const indicator = new DatabaseHealthIndicator(db, {
 *   latencyDegradedThreshold: 50,
 *   latencyUnhealthyThreshold: 500,
 * });
 *
 * healthService.registerIndicator(indicator);
 * ```
 */
export class DatabaseHealthIndicator extends HealthIndicator {
  readonly name = 'database';

  private readonly options: Required<DatabaseHealthOptions>;
  private connection?: IDatabaseConnection;

  constructor(connection?: IDatabaseConnection, options: DatabaseHealthOptions = {}) {
    super();
    this.connection = connection;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  /**
   * Set database connection (for lazy initialization)
   */
  setConnection(connection: IDatabaseConnection): void {
    this.connection = connection;
  }

  /**
   * Perform database health check
   */
  async check(): Promise<HealthIndicatorResult> {
    if (!this.connection) {
      return this.unhealthy('Database connection not configured');
    }

    try {
      const start = Date.now();
      await this.withTimeout(() => this.executeHealthQuery(), this.options.timeout);
      const latency = Date.now() - start;

      const details = {
        latency,
        threshold: {
          degraded: this.options.latencyDegradedThreshold,
          unhealthy: this.options.latencyUnhealthyThreshold,
        },
      };

      if (latency >= this.options.latencyUnhealthyThreshold) {
        return this.unhealthy(`Database response too slow: ${latency}ms`, details);
      }

      if (latency >= this.options.latencyDegradedThreshold) {
        return this.degraded(`Database response slow: ${latency}ms`, details);
      }

      return this.healthy(`Database responding in ${latency}ms`, details);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.unhealthy(
        `Database check failed: ${errorMessage}`,
        undefined,
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }

  /**
   * Execute health check query
   */
  private async executeHealthQuery(): Promise<void> {
    const conn = this.connection!;

    // Kysely pattern: raw().execute()
    if (typeof conn.raw === 'function') {
      await conn.raw(this.options.healthQuery).execute();
      return;
    }

    // Direct execute pattern
    if (typeof conn.execute === 'function') {
      await conn.execute(this.options.healthQuery);
      return;
    }

    // pg pattern: query()
    if (typeof conn.query === 'function') {
      await conn.query(this.options.healthQuery);
      return;
    }

    throw new Error('Database connection does not support any known query method');
  }
}
