/**
 * Rotif Health Indicator
 *
 * Provides health check functionality for the Rotif messaging system.
 */

import type { NotificationManager } from '../../rotif/rotif.js';
import type { ILogger } from '../logger/logger.types.js';

/**
 * Health status for Rotif
 */
export interface RotifHealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  redis: {
    status: string;
    connected: boolean;
    host?: string;
    port?: number;
  };
  dlq?: {
    messageCount: number;
    oldestMessage?: number;
  };
  subscriptions: {
    count: number;
    active: number;
    paused: number;
  };
  latency?: number;
}

/**
 * RotifHealthIndicator provides health check functionality.
 *
 * @example
 * ```typescript
 * const health = new RotifHealthIndicator(manager);
 * const status = await health.check();
 * console.log(status.status); // 'healthy' | 'unhealthy' | 'degraded'
 * ```
 */
export class RotifHealthIndicator {
  private logger?: ILogger;

  constructor(private readonly manager: NotificationManager) {}

  /**
   * Set logger for health indicator
   */
  setLogger(logger: ILogger): void {
    this.logger = logger;
  }

  /**
   * Perform a health check on the Rotif system.
   */
  async check(): Promise<RotifHealthStatus> {
    const startTime = Date.now();

    try {
      // Check Redis connection
      const redisStatus = await this.checkRedis();

      // Check DLQ status
      const dlqStatus = await this.checkDLQ();

      // Get subscription stats
      const subscriptionStats = this.getSubscriptionStats();

      const latency = Date.now() - startTime;

      // Determine overall status
      let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
      let message: string | undefined;

      if (!redisStatus.connected) {
        status = 'unhealthy';
        message = 'Redis connection is down';
      } else if (dlqStatus && dlqStatus.messageCount > 100) {
        status = 'degraded';
        message = `DLQ has ${dlqStatus.messageCount} messages`;
      } else if (latency > 1000) {
        status = 'degraded';
        message = `High latency: ${latency}ms`;
      }

      return {
        status,
        message,
        redis: redisStatus,
        dlq: dlqStatus,
        subscriptions: subscriptionStats,
        latency,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Health check failed',
        redis: {
          status: 'error',
          connected: false,
        },
        subscriptions: {
          count: 0,
          active: 0,
          paused: 0,
        },
      };
    }
  }

  /**
   * Check Redis connection status.
   */
  private async checkRedis(): Promise<RotifHealthStatus['redis']> {
    const redis = this.manager.redis;

    try {
      // Ping Redis to verify connection
      await redis.ping();

      return {
        status: redis.status,
        connected: redis.status === 'ready',
        host: redis.options.host,
        port: redis.options.port,
      };
    } catch {
      return {
        status: 'error',
        connected: false,
        host: redis.options.host,
        port: redis.options.port,
      };
    }
  }

  /**
   * Check DLQ status.
   */
  private async checkDLQ(): Promise<RotifHealthStatus['dlq'] | undefined> {
    try {
      const stats = await this.manager.getDLQStats();
      return {
        messageCount: stats.totalMessages || 0,
        oldestMessage: stats.oldestMessage,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Get subscription statistics.
   */
  private getSubscriptionStats(): RotifHealthStatus['subscriptions'] {
    return this.manager.getSubscriptionStats();
  }

  /**
   * Simple liveness check - returns true if Redis is connected.
   */
  async isAlive(): Promise<boolean> {
    try {
      await this.manager.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Simple readiness check - returns true if system is ready to accept messages.
   */
  async isReady(): Promise<boolean> {
    try {
      const status = this.manager.redis.status;
      return status === 'ready';
    } catch {
      return false;
    }
  }
}
