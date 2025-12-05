/**
 * Priceverse 2.0 - Health Service
 * Provides health check functionality for system components
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import type { HealthResponse, HealthCheck } from '../../shared/types.js';
import type { IRedisService } from '../collector/workers/base-worker.js';
import type { ExchangeManagerService } from '../collector/services/exchange-manager.service.js';
import { EXCHANGE_MANAGER_TOKEN } from '../../shared/tokens.js';

@Injectable()
export class HealthService {
  private startTime = Date.now();

  constructor(
    @Inject(RedisService) private readonly redis: IRedisService,
    @Inject(EXCHANGE_MANAGER_TOKEN) private readonly exchangeManager: ExchangeManagerService,
  ) {}

  /**
   * Get comprehensive health status
   */
  async getHealth(): Promise<HealthResponse> {
    const startCheck = Date.now();
    const checks: Record<string, HealthCheck> = {};

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
    };
  }

  /**
   * Check Redis health
   */
  private async checkRedis(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      // Test Redis connection by attempting a simple operation
      // Using xadd to a health check stream as a connectivity test
      await this.redis.xadd('health:check', '*', { check: Date.now().toString() });
      return {
        status: 'up',
        latency: Date.now() - start,
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
   */
  async getReadiness(): Promise<HealthCheck> {
    const redisCheck = await this.checkRedis();
    const exchangesCheck = await this.checkExchanges();

    if (redisCheck.status === 'up' && exchangesCheck.status === 'up') {
      return { status: 'up', message: 'Service is ready' };
    }

    return {
      status: 'down',
      message: 'Service not ready',
    };
  }
}
