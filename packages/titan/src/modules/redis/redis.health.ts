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

      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          namespace: namespace || 'default',
          healthy: false,
          latency,
        }),
      );
    } catch (error) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          namespace: namespace || 'default',
          error: (error as Error).message,
          healthy: false,
        }),
      );
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

      throw new HealthCheckError(
        'Some Redis clients are not healthy',
        this.getStatus('redis', false, {
          clients: details,
        }),
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
    try {
      const pingResult = await this.redisManager.ping(namespace);

      return this.getStatus('redis', true, {
        namespace: namespace || 'default',
        ping: pingResult,
      });
    } catch (error) {
      throw new HealthCheckError(
        'Redis ping failed',
        this.getStatus('redis', false, {
          namespace: namespace || 'default',
          error: (error as Error).message,
        }),
      );
    }
  }

  async checkConnection(namespace?: string): Promise<HealthIndicatorResult> {
    const key = namespace ? `redis-${namespace}` : 'redis-default';
    return this.isHealthy(key, namespace);
  }
}