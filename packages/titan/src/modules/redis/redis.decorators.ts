import { getRedisToken, REDIS_MANAGER } from './redis.constants.js';
import { CacheOptions, LockOptions, RateLimitOptions } from './redis.types.js';

// Simple parameter decorator for dependency injection
function createInjectDecorator(token: string | symbol): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const key = propertyKey || 'constructor';
    const existingTokens = Reflect.getMetadata('inject:tokens', target, key) || [];
    existingTokens[parameterIndex] = token;
    Reflect.defineMetadata('inject:tokens', existingTokens, target, key);
  };
}

export const InjectRedis = (namespace?: string): ParameterDecorator => {
  return createInjectDecorator(getRedisToken(namespace));
};

export const InjectRedisManager = (): ParameterDecorator => {
  return createInjectDecorator(REDIS_MANAGER);
};

export function RedisCache(options?: CacheOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const redisService = (this as any).redisService;

      if (!redisService) {
        return originalMethod.apply(this, args);
      }

      const key = typeof options?.key === 'function'
        ? options.key(...args)
        : options?.key || `${target.constructor.name}:${String(propertyKey)}:${JSON.stringify(args)}`;

      if (options?.condition && !options.condition(...args)) {
        return originalMethod.apply(this, args);
      }

      const namespace = options?.namespace;
      const ttl = options?.ttl || 3600;

      try {
        if (!options?.refresh) {
          const cached = await redisService.get(key, namespace);
          if (cached) {
            return JSON.parse(cached);
          }
        }

        const result = await originalMethod.apply(this, args);

        if (result !== undefined && result !== null) {
          await redisService.set(
            key,
            JSON.stringify(result),
            ttl,
            namespace,
          );
        }

        return result;
      } catch (error) {
        return originalMethod.apply(this, args);
      }
    };

    return descriptor;
  };
}

export function RedisLock(options?: LockOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const redisService = (this as any).redisService;

      if (!redisService) {
        return originalMethod.apply(this, args);
      }

      const key = typeof options?.key === 'function'
        ? options.key(...args)
        : options?.key || `lock:${target.constructor.name}:${String(propertyKey)}:${JSON.stringify(args)}`;

      const namespace = options?.namespace;
      const ttl = options?.ttl || 10000;
      const retries = options?.retries || 10;
      const retryDelay = options?.retryDelay || 100;

      const lockValue = `${Date.now()}:${Math.random()}`;

      for (let i = 0; i < retries; i++) {
        const acquired = await redisService.setnx(key, lockValue, namespace);

        if (acquired) {
          await redisService.expire(key, Math.ceil(ttl / 1000), namespace);

          try {
            const result = await originalMethod.apply(this, args);
            const currentValue = await redisService.get(key, namespace);

            if (currentValue === lockValue) {
              await redisService.del(key, namespace);
            }

            return result;
          } catch (error) {
            const currentValue = await redisService.get(key, namespace);

            if (currentValue === lockValue) {
              await redisService.del(key, namespace);
            }

            throw error;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }

      throw new Error(`Failed to acquire lock for key: ${key}`);
    };

    return descriptor;
  };
}

export function RedisRateLimit(options: RateLimitOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const redisService = (this as any).redisService;

      if (!redisService) {
        return originalMethod.apply(this, args);
      }

      const keyPrefix = options.keyPrefix || `rate:${target.constructor.name}:${String(propertyKey)}`;
      const key = `${keyPrefix}:${args[0] || 'default'}`;
      const namespace = options.namespace;

      const now = Date.now();
      const windowStart = now - options.duration;

      const client = redisService.getClient(namespace);

      const pipeline = client.pipeline();
      pipeline.zremrangebyscore(key, '-inf', windowStart);
      pipeline.zadd(key, now, `${now}:${Math.random()}`);
      pipeline.zcard(key);
      pipeline.expire(key, Math.ceil(options.duration / 1000));

      const results = await pipeline.exec();

      if (!results) {
        return originalMethod.apply(this, args);
      }

      const count = results[2]?.[1] as number;

      if (count > options.points) {
        if (options.blockDuration) {
          const blockKey = `${key}:blocked`;
          await redisService.set(
            blockKey,
            '1',
            Math.ceil(options.blockDuration / 1000),
            namespace,
          );
        }

        throw new Error('Rate limit exceeded');
      }

      const blocked = await redisService.get(`${key}:blocked`, namespace);
      if (blocked) {
        throw new Error('Rate limit blocked');
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}