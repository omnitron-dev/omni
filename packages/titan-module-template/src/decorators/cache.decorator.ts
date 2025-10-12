/**
 * Cache Decorator
 *
 * Decorator for caching method results.
 * This demonstrates how to create method decorators in Titan modules.
 */

import 'reflect-metadata';
import { TEMPLATE_METADATA } from '../constants.js';
import { createCacheKey } from '../utils.js';

export interface CacheOptions {
  /**
   * TTL in seconds
   */
  ttl?: number;

  /**
   * Custom key generator
   */
  keyGenerator?: (...args: any[]) => string;

  /**
   * Whether to cache null/undefined results
   */
  cacheNull?: boolean;
}

/**
 * Cache method results
 */
export function Cached(options: CacheOptions = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    // Store metadata
    Reflect.defineMetadata(TEMPLATE_METADATA.CACHED_METHOD, options, target, propertyKey);

    const originalMethod = descriptor.value;
    const methodName = String(propertyKey);

    descriptor.value = async function cachedMethod(...args: any[]) {
      // Get cache service (assumes it's injected into the class)
      const cacheService = (this as any).cache;

      if (!cacheService || !cacheService.get) {
        // No cache service available, call original method
        return originalMethod.apply(this, args);
      }

      // Generate cache key
      const cacheKey = options.keyGenerator
        ? options.keyGenerator(...args)
        : createCacheKey(target.constructor.name, methodName, JSON.stringify(args));

      // Try to get from cache
      const cached = await cacheService.get(cacheKey);
      if (cached !== null || (options.cacheNull && cached === null)) {
        return cached;
      }

      // Call original method
      const result = await originalMethod.apply(this, args);

      // Cache the result if not null/undefined (or if cacheNull is true)
      if ((result !== null && result !== undefined) || options.cacheNull) {
        await cacheService.set(cacheKey, result, options.ttl);
      }

      return result;
    };

    return descriptor;
  };
}

/**
 * Clear cache for a method
 */
export function CacheClear(methodName?: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const targetMethod = methodName || String(propertyKey);

    descriptor.value = async function cacheClearMethod(...args: any[]) {
      // Call original method first
      const result = await originalMethod.apply(this, args);

      // Get cache service
      const cacheService = (this as any).cache;

      if (cacheService && cacheService.clear) {
        // Clear cache for the specified method
        // In a real implementation, this would clear specific keys
        const cacheKey = createCacheKey(target.constructor.name, targetMethod, '*');
        await cacheService.delete(cacheKey);
      }

      return result;
    };

    return descriptor;
  };
}
