/**
 * Priceverse 2.0 - Health Service
 * Provides health check functionality using Titan's DatabaseHealthIndicator
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import {
  DatabaseHealthIndicator,
  DATABASE_HEALTH_INDICATOR,
  type DatabaseHealthCheckResult,
  type DatabaseMetrics,
} from '@omnitron-dev/titan/module/database';
import type { HealthResponse, HealthCheck } from '../../shared/types.js';
import type { ExchangeManagerService } from '../collector/services/exchange-manager.service.js';
import { EXCHANGE_MANAGER_TOKEN } from '../../shared/tokens.js';

// Extended health response with database metrics
export interface ExtendedHealthResponse extends HealthResponse {
  database?: {
    connected: boolean;
    connectionsCount: number;
    pool?: {
      total: number;
      active: number;
      idle: number;
      waiting: number;
    };
    migrations?: {
      upToDate: boolean;
      pendingCount: number;
      currentVersion?: string;
    };
    metrics?: DatabaseMetrics;
  };
}

@Injectable()
export class HealthService {
  private startTime = Date.now();

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(EXCHANGE_MANAGER_TOKEN) private readonly exchangeManager: ExchangeManagerService,
    @Inject(DATABASE_HEALTH_INDICATOR) private readonly dbHealth: DatabaseHealthIndicator
  ) {}

  /**
   * Get comprehensive health status including database metrics
   */
  async getHealth(): Promise<ExtendedHealthResponse> {
    const startCheck = Date.now();
    const checks: Record<string, HealthCheck> = {};

    // Check database connectivity using Titan's DatabaseHealthIndicator
    const dbResult = await this.checkDatabase();
    checks.database = dbResult.check;

    // Check Redis connectivity
    checks.redis = await this.checkRedis();

    // Check exchange connections
    checks.exchanges = await this.checkExchanges();

    // Determine overall health status
    const allUp = Object.values(checks).every((check) => check.status === 'up');
    const allDown = Object.values(checks).every((check) => check.status === 'down');

    const status = allUp ? 'healthy' : allDown ? 'unhealthy' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: '2.0.0',
      checks,
      latency: Date.now() - startCheck,
      database: dbResult.details,
    };
  }

  /**
   * Check database health using DatabaseHealthIndicator
   */
  private async checkDatabase(): Promise<{
    check: HealthCheck;
    details?: ExtendedHealthResponse['database'];
  }> {
    const start = Date.now();
    try {
      // Use Titan's DatabaseHealthIndicator for comprehensive health check
      const health: DatabaseHealthCheckResult = await this.dbHealth.check();

      // Extract connection info
      const connectionNames = Object.keys(health.connections);
      const firstConnection = connectionNames.length > 0 ? health.connections[connectionNames[0]] : null;

      // Extract metrics if available
      const details: ExtendedHealthResponse['database'] = {
        connected: health.status === 'healthy',
        connectionsCount: connectionNames.length,
        pool: firstConnection?.pool
          ? {
              total: firstConnection.pool.total,
              active: firstConnection.pool.active,
              idle: firstConnection.pool.idle,
              waiting: firstConnection.pool.waiting,
            }
          : undefined,
        migrations: health.migrations
          ? {
              upToDate: health.migrations.upToDate,
              pendingCount: health.migrations.pendingCount,
              currentVersion: health.migrations.currentVersion,
            }
          : undefined,
        metrics: health.metrics,
      };

      return {
        check: {
          status: health.status === 'healthy' ? 'up' : 'down',
          latency: Date.now() - start,
          message:
            health.status === 'healthy'
              ? `Database connected (${connectionNames.length} connection(s))`
              : firstConnection?.error ?? 'Database unhealthy',
        },
        details,
      };
    } catch (error) {
      return {
        check: {
          status: 'down',
          latency: Date.now() - start,
          message: error instanceof Error ? error.message : 'Database check failed',
        },
      };
    }
  }

  /**
   * Check Redis health
   */
  private async checkRedis(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      // Test Redis connection using ping() method from RedisService
      const isHealthy = await this.redis.ping();
      if (isHealthy) {
        return {
          status: 'up',
          latency: Date.now() - start,
        };
      }
      return {
        status: 'down',
        latency: Date.now() - start,
        message: 'Redis ping failed',
      };
    } catch (error) {
      return {
        status: 'down',
        latency: Date.now() - start,
        message: error instanceof Error ? error.message : 'Redis connection failed',
      };
    }
  }

  /**
   * Check exchange connections
   */
  private async checkExchanges(): Promise<HealthCheck> {
    try {
      const connectedCount = this.exchangeManager.getConnectedCount();
      const totalCount = this.exchangeManager.getStats().length;

      if (connectedCount === 0) {
        return {
          status: 'down',
          message: `No exchanges connected (0/${totalCount})`,
        };
      }

      return {
        status: 'up',
        message: `${connectedCount}/${totalCount} exchanges connected`,
      };
    } catch (error) {
      return {
        status: 'down',
        message: error instanceof Error ? error.message : 'Failed to check exchanges',
      };
    }
  }

  /**
   * Simple liveness check (always returns healthy if service is running)
   */
  async getLiveness(): Promise<{ status: 'up' }> {
    return { status: 'up' };
  }

  /**
   * Readiness check (checks if service is ready to handle requests)
   * Includes database readiness check
   */
  async getReadiness(): Promise<HealthCheck> {
    const [dbCheck, redisCheck, exchangesCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkExchanges(),
    ]);

    const isReady =
      dbCheck.check.status === 'up' &&
      redisCheck.status === 'up' &&
      exchangesCheck.status === 'up';

    if (isReady) {
      return { status: 'up', message: 'Service is ready' };
    }

    const failures: string[] = [];
    if (dbCheck.check.status === 'down') failures.push('database');
    if (redisCheck.status === 'down') failures.push('redis');
    if (exchangesCheck.status === 'down') failures.push('exchanges');

    return {
      status: 'down',
      message: `Service not ready: ${failures.join(', ')} unavailable`,
    };
  }

  /**
   * Get database-specific health metrics
   */
  async getDatabaseHealth(): Promise<ExtendedHealthResponse['database'] | null> {
    const result = await this.checkDatabase();
    return result.details ?? null;
  }
}
