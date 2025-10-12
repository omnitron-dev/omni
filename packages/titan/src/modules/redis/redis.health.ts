import { RedisManager } from './redis.manager.js';
import { TitanError } from '../../errors/core.js';
import { ErrorCode } from '../../errors/codes.js';

export interface HealthIndicatorResult {
  [key: string]: {
    status: 'up' | 'down';
    [key: string]: any;
  };
}

export abstract class HealthIndicator {
  protected getStatus(key: string, isHealthy: boolean, data?: Record<string, any>): HealthIndicatorResult {
    return {
      [key]: {
        status: isHealthy ? 'up' : 'down',
        ...data,
      },
    };
  }
}

export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redisManager: RedisManager) {
    super();
  }

  async isHealthy(key: string, namespace?: string): Promise<HealthIndicatorResult> {
    try {
      const start = Date.now();
      const healthy = await this.redisManager.isHealthy(namespace);
      const latency = Date.now() - start;

      if (healthy) {
        return this.getStatus(key, true, {
          namespace: namespace || 'default',
          healthy: true,
          latency,
        });
      }

      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Redis check failed',
        details: {
          service: 'Redis health check',
          causes: [
            this.getStatus(key, false, {
              namespace: namespace || 'default',
              healthy: false,
              latency,
            }),
          ],
        },
      });
    } catch (error) {
      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Redis check failed',
        details: {
          service: 'Redis health check',
          causes: [
            this.getStatus(key, false, {
              namespace: namespace || 'default',
              error: (error as Error).message,
              healthy: false,
            }),
          ],
        },
      });
    }
  }

  async checkAll(): Promise<HealthIndicatorResult> {
    try {
      const results = await this.redisManager.healthCheck();
      const details: Record<string, any> = {};
      let allHealthy = true;

      for (const [namespace, result] of Object.entries(results)) {
        details[namespace] = {
          status: result.healthy ? 'ready' : 'not ready',
          healthy: result.healthy,
          latency: result.latency,
        };

        if (!result.healthy) {
          allHealthy = false;
        }
      }

      if (allHealthy) {
        return this.getStatus('redis', true, {
          clients: details,
        });
      }

      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Some Redis clients are not healthy',
        details: {
          service: 'Redis health check',
          causes: [
            this.getStatus('redis', false, {
              clients: details,
            }),
          ],
        },
      });
    } catch (error) {
      if (error instanceof TitanError) {
        throw error;
      }

      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Redis health check failed',
        details: {
          service: 'Redis health check',
          causes: [
            this.getStatus('redis', false, {
              error: (error as Error).message,
            }),
          ],
        },
      });
    }
  }

  async ping(namespace?: string): Promise<HealthIndicatorResult> {
    try {
      const pingResult = await this.redisManager.ping(namespace);

      return this.getStatus('redis', true, {
        namespace: namespace || 'default',
        ping: pingResult,
      });
    } catch (error) {
      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Redis ping failed',
        details: {
          service: 'Redis health check',
          causes: [
            this.getStatus('redis', false, {
              namespace: namespace || 'default',
              error: (error as Error).message,
            }),
          ],
        },
      });
    }
  }

  async checkConnection(namespace?: string): Promise<HealthIndicatorResult> {
    const key = namespace ? `redis-${namespace}` : 'redis-default';
    return this.isHealthy(key, namespace);
  }
}
