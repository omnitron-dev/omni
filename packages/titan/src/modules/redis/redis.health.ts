import { RedisManager } from './redis.manager.js';

export interface HealthIndicatorResult {
  [key: string]: {
    status: 'up' | 'down';
    [key: string]: any;
  };
}

export class HealthCheckError extends Error {
  public readonly causes: HealthIndicatorResult;

  constructor(
    message: string,
    causes: HealthIndicatorResult,
  ) {
    super(message);
    this.causes = causes;
  }
}

export abstract class HealthIndicator {
  protected getStatus(
    key: string,
    isHealthy: boolean,
    data?: Record<string, any>,
  ): HealthIndicatorResult {
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
      const healthy = await this.redisManager.isHealthy(namespace);

      if (healthy) {
        return this.getStatus(key, true, {
          namespace: namespace || 'default',
          status: 'ready',
        });
      }

      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          namespace: namespace || 'default',
          status: 'not ready',
        }),
      );
    } catch (error) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          namespace: namespace || 'default',
          error: (error as Error).message,
        }),
      );
    }
  }

  async checkAll(): Promise<HealthIndicatorResult> {
    try {
      const results = await this.redisManager.healthCheck();
      const details: Record<string, any> = {};
      let allHealthy = true;

      for (const [namespace, healthy] of results) {
        details[namespace] = {
          status: healthy ? 'ready' : 'not ready',
          healthy,
        };

        if (!healthy) {
          allHealthy = false;
        }
      }

      if (allHealthy) {
        return this.getStatus('redis', true, details);
      }

      throw new HealthCheckError(
        'Some Redis clients are not healthy',
        this.getStatus('redis', false, details),
      );
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus('redis', false, {
          error: (error as Error).message,
        }),
      );
    }
  }

  async ping(namespace?: string): Promise<HealthIndicatorResult> {
    return this.isHealthy('redis-ping', namespace);
  }

  async checkConnection(namespace?: string): Promise<HealthIndicatorResult> {
    const key = namespace ? `redis-${namespace}` : 'redis-default';
    return this.isHealthy(key, namespace);
  }
}