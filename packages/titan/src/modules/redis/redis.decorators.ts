import { getRedisClientToken, REDIS_MANAGER } from './redis.constants.js';
import { LockOptions, CacheOptions, RateLimitOptions } from './redis.types.js';

// Simple parameter decorator for dependency injection
function createInjectDecorator(token: string | symbol): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const key = propertyKey || 'constructor';
    const existingTokens = Reflect.getMetadata('inject:tokens', target, key) || [];
    existingTokens[parameterIndex] = token;
    Reflect.defineMetadata('inject:tokens', existingTokens, target, key);
  };
}

export const InjectRedis = (namespace?: string): ParameterDecorator => createInjectDecorator(getRedisClientToken(namespace));

export const InjectRedisManager = (): ParameterDecorator => createInjectDecorator(REDIS_MANAGER);

export function RedisCache(options?: CacheOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function cacheMethod(...args: any[]) {
      // Try to find redis client - support multiple naming conventions
      const redisManager = (this as any).redisManager;
      const redisService = (this as any).redisService;
      const redis = (this as any).redis;

      // Get client from manager or service
      let client: any;
      const namespace = options?.namespace || 'default';

      try {
        if (redisManager) {
          client = redisManager.getClient?.(namespace) || redisManager.client || redisManager;
        } else if (redisService) {
          client = redisService.getClient?.(namespace) || redisService.client || redisService;
        } else if (redis) {
          client = redis;
        }

        if (!client) {
          return originalMethod.apply(this, args);
        }
      } catch (error) {
        // If client not found, fall back to original method
        return originalMethod.apply(this, args);
      }

      // Support both 'key' and 'keyFn' for backward compatibility
      const keyFn = options?.keyFn || options?.key;
      let key: string;

      if (typeof keyFn === 'function') {
        key = keyFn(...args);
      } else if (keyFn) {
        // If static key provided, append args to it
        const argsKey = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(':');
        key = argsKey ? `${keyFn}:${argsKey}` : keyFn;
      } else {
        // Default key format
        key = `${String(propertyKey)}:${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(':')}`;
      }

      const fullKey = `cache:${key}`;

      if (options?.condition && !options.condition(...args)) {
        return originalMethod.apply(this, args);
      }

      const ttl = options?.ttl || 3600;

      try {
        if (!options?.refresh) {
          const cached = await client.get(fullKey);
          if (cached) {
            try {
              return JSON.parse(cached);
            } catch {
              return cached; // Return as-is if not JSON
            }
          }
        }

        const result = await originalMethod.apply(this, args);

        if (result !== undefined && result !== null) {
          // Always stringify for consistent storage and retrieval
          const value = JSON.stringify(result);
          if (ttl > 0) {
            await client.setex(fullKey, ttl, value);
          } else {
            await client.set(fullKey, value);
          }
        }

        return result;
      } catch {
        return originalMethod.apply(this, args);
      }
    };

    return descriptor;
  };
}

export function RedisLock(options?: LockOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function lockMethod(...args: any[]) {
      // Try to find redis client - support multiple naming conventions
      const redisManager = (this as any).redisManager;
      const redisService = (this as any).redisService;
      const redis = (this as any).redis;

      // Get client from manager or service
      let client: any;
      const namespace = options?.namespace || 'default';

      try {
        if (redisManager) {
          client = redisManager.getClient?.(namespace) || redisManager.client || redisManager;
        } else if (redisService) {
          client = redisService.getClient?.(namespace) || redisService.client || redisService;
        } else if (redis) {
          client = redis;
        }

        if (!client) {
          return originalMethod.apply(this, args);
        }
      } catch (error) {
        // If client not found, fall back to original method
        return originalMethod.apply(this, args);
      }

      // Generate key based on options
      const keyFn = options?.keyFn || options?.key;
      let key: string;

      if (typeof keyFn === 'function') {
        key = keyFn(...args);
      } else if (keyFn) {
        // If a static key is provided, append the first argument as ID
        key = args.length > 0 ? `${keyFn}:${args[0]}` : keyFn;
      } else {
        // Default key includes class name, method name, and args
        key = `${target.constructor.name}:${String(propertyKey)}:${JSON.stringify(args)}`;
      }

      // TTL is expected to be in seconds (for backward compatibility with tests)
      const ttl = options?.ttl || 10; // Default 10 seconds
      const retries = options?.retries ?? 10; // Use ?? to allow 0
      const retryDelay = options?.retryDelay || 100;
      const fullKey = `lock:${key}`;

      const lockValue = `${Date.now()}:${Math.random()}`;
      const ttlSeconds = ttl; // TTL is already in seconds

      // Try to acquire lock (retries + 1 attempts total, including initial attempt)
      const maxAttempts = retries + 1;
      for (let i = 0; i < maxAttempts; i++) {
        // Use SET NX EX for atomic lock acquisition
        const acquired = await client.set(fullKey, lockValue, 'NX', 'EX', ttlSeconds);

        if (acquired === 'OK') {
          try {
            const result = await originalMethod.apply(this, args);

            // Release lock if we still own it
            const currentValue = await client.get(fullKey);
            if (currentValue === lockValue) {
              await client.del(fullKey);
            }

            return result;
          } catch (error) {
            // Release lock on error if we still own it
            const currentValue = await client.get(fullKey);
            if (currentValue === lockValue) {
              await client.del(fullKey);
            }
            throw error;
          }
        }

        // Wait before retrying (don't wait after last attempt)
        if (i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }

      throw new Error(`Failed to acquire lock for key: ${fullKey}`);
    };

    return descriptor;
  };
}

export function RedisRateLimit(options: RateLimitOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function rateLimitMethod(...args: any[]) {
      // Try to find redis client - support multiple naming conventions
      const redisManager = (this as any).redisManager;
      const redisService = (this as any).redisService;
      const redis = (this as any).redis;

      // Get client from manager or service
      let client: any;
      const namespace = options?.namespace || 'default';

      try {
        if (redisManager) {
          client = redisManager.getClient?.(namespace) || redisManager.client || redisManager;
        } else if (redisService) {
          client = redisService.getClient?.(namespace) || redisService.client || redisService;
        } else if (redis) {
          client = redis;
        }

        if (!client) {
          return originalMethod.apply(this, args);
        }
      } catch (error) {
        // If client not found, fall back to original method
        return originalMethod.apply(this, args);
      }

      // Support custom key function or static key/keyPrefix
      let key: string;
      if ((options as any).keyFn && typeof (options as any).keyFn === 'function') {
        key = `rate:${(options as any).keyFn(...args)}`;
      } else {
        // Support both 'key' and 'keyPrefix' for backward compatibility
        const keyPrefix = (options as any).key || options.keyPrefix || `rate:${String(propertyKey)}`;
        key = `${keyPrefix}:${args[0] || 'default'}`;
      }

      const now = Date.now();
      // Support both 'window' (seconds) and 'duration' (milliseconds) for backward compatibility
      const duration = (options as any).window ? (options as any).window * 1000 : options.duration;
      const windowStart = now - duration;

      // Use sorted sets for sliding window rate limiting
      const pipeline = client.pipeline();
      pipeline.zremrangebyscore(key, '-inf', windowStart);
      pipeline.zadd(key, now, `${now}:${Math.random()}`);
      pipeline.zcard(key);
      pipeline.expire(key, Math.ceil(duration / 1000));

      const results = await pipeline.exec();

      if (!results) {
        return originalMethod.apply(this, args);
      }

      const count = results[2]?.[1] as number;
      // Support both 'limit' and 'points' for backward compatibility
      const limit = (options as any).limit || options.points;

      if (count > limit) {
        if (options.blockDuration) {
          const blockKey = `${key}:blocked`;
          await client.setex(blockKey, Math.ceil(options.blockDuration / 1000), '1');
        }

        throw new Error(`Rate limit exceeded: ${count}/${limit} requests`);
      }

      // Check if blocked
      const blocked = await client.get(`${key}:blocked`);
      if (blocked) {
        throw new Error('Rate limit blocked');
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}