/* eslint-disable func-names */
/**
 * Rate Limit Decorators
 *
 * Method decorators for applying rate limiting to service methods in Titan's
 * service-oriented architecture. Provides distributed rate limiting using Redis
 * with sliding window algorithm.
 *
 * @module @omnitron-dev/titan/module/ratelimit
 */

import 'reflect-metadata';
import type { IRateLimitDecoratorOptions, IRateLimitContext, IRateLimitCheckOptions } from './ratelimit.types.js';

/**
 * Metadata key for storing rate limit configuration on methods
 * @internal
 */
const RATE_LIMIT_METADATA_KEY = Symbol.for('titan:ratelimit:metadata');

/**
 * @RateLimit Decorator
 *
 * Applies rate limiting to service methods. Uses Redis for distributed tracking
 * with a sliding window algorithm for accurate rate limiting.
 *
 * **Requirements:**
 * 1. Service must inject rate limit service: `@Inject(RATE_LIMIT_SERVICE_TOKEN) private readonly __rateLimitService__: IRateLimitService`
 * 2. RateLimitModule must be imported in your application module
 * 3. Redis must be configured (falls back to in-memory if unavailable)
 *
 * **Key Generation:**
 * - Default: `{className}:{methodName}:{arg0}`
 * - Custom: Use `keyGenerator` option for complex scenarios
 * - Method name inclusion controlled by `includeMethodName` (default: true)
 *
 * **Graceful Degradation:**
 * - If rate limit service is not injected, decorator allows all requests
 * - If `skipOnError` is true, allows request on storage/service errors
 * - Useful for test environments or gradual rollout
 *
 * @param options - Rate limit configuration
 * @returns Method decorator
 *
 * @example
 * Basic usage (per-client limit):
 * ```typescript
 * @Service({ name: 'AccountService@1.0.0' })
 * export class AccountRpcService {
 *   constructor(
 *     @Inject(RATE_LIMIT_SERVICE_TOKEN) private readonly __rateLimitService__: IRateLimitService
 *   ) {}
 *
 *   @RateLimit({ limit: 10, windowMs: 60000 })
 *   async createAccount(ownerId: string): Promise<Account> {
 *     // Max 10 requests per minute per ownerId
 *     // Key: "AccountRpcService:createAccount:ownerId_value"
 *   }
 * }
 * ```
 *
 * @example
 * Global rate limit:
 * ```typescript
 * @RateLimit({
 *   limit: 100,
 *   windowMs: 60000,
 *   keyGenerator: () => 'global'
 * })
 * async listAccounts(): Promise<Account[]> {
 *   // Max 100 requests per minute globally
 *   // Key: "AccountRpcService:listAccounts:global"
 * }
 * ```
 *
 * @example
 * Custom key generator:
 * ```typescript
 * @RateLimit({
 *   limit: 5,
 *   windowMs: 300000,
 *   keyGenerator: (...args) => `${args[0]}:${args[1]}`
 * })
 * async transfer(fromId: string, toId: string, amount: number): Promise<Transfer> {
 *   // Max 5 transfers per 5 minutes per account pair
 *   // Key: "AccountRpcService:transfer:fromId:toId"
 * }
 * ```
 *
 * @example
 * Method-specific limit without method name in key:
 * ```typescript
 * @RateLimit({
 *   limit: 3,
 *   windowMs: 300000,
 *   includeMethodName: false
 * })
 * async deleteAccount(id: string): Promise<void> {
 *   // Max 3 deletes per 5 minutes per account
 *   // Key: "AccountRpcService:id_value"
 * }
 * ```
 *
 * @example
 * Multi-tier rate limiting:
 * ```typescript
 * @RateLimit({
 *   limit: 10,
 *   windowMs: 60000,
 *   tier: 'free'
 * })
 * async apiCall(userId: string): Promise<void> {
 *   // Uses 'free' tier configuration
 *   // Key includes tier for proper isolation
 * }
 * ```
 *
 * @example
 * Graceful degradation on errors:
 * ```typescript
 * @RateLimit({
 *   limit: 10,
 *   windowMs: 60000,
 *   skipOnError: true  // Allow request if rate limit check fails
 * })
 * async criticalOperation(id: string): Promise<void> {
 *   // Won't block on Redis/storage failures
 * }
 * ```
 *
 * @public
 */
export function RateLimit(options: IRateLimitDecoratorOptions = {}): MethodDecorator {
  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const methodName = propertyKey.toString();
    const className = target.constructor.name;

    // Validate options at decoration time
    if (options.limit !== undefined && (options.limit <= 0 || !Number.isInteger(options.limit))) {
      throw new Error(
        `@RateLimit: limit must be a positive integer, got ${options.limit} on ${className}.${methodName}`
      );
    }

    if (options.windowMs !== undefined && (options.windowMs <= 0 || !Number.isInteger(options.windowMs))) {
      throw new Error(
        `@RateLimit: windowMs must be a positive integer, got ${options.windowMs} on ${className}.${methodName}`
      );
    }

    // Replace method with rate-limited version
    descriptor.value = async function (this: IRateLimitContext, ...args: unknown[]) {
      const rateLimitService = this.__rateLimitService__;

      // Graceful degradation: if no rate limit service is injected, allow request
      // This is useful for:
      // - Test environments where rate limiting isn't needed
      // - Gradual rollout (add service injection when ready)
      // - Development mode
      if (!rateLimitService) {
        // Try to log warning if logger is available
        const logger = this.logger || this.loggerModule?.logger;
        if (logger?.warn) {
          logger.warn(`[RateLimit] No rate limit service injected for ${className}.${methodName}, allowing request`);
        }
        return originalMethod.apply(this, args);
      }

      try {
        // Generate rate limit key
        const key = generateRateLimitKey(className, methodName, args, options);

        // Build rate limit check options
        const checkOptions: Partial<IRateLimitCheckOptions> = {
          key,
        };

        if (options.limit !== undefined) {
          checkOptions.limit = options.limit;
        }
        if (options.windowMs !== undefined) {
          checkOptions.windowMs = options.windowMs;
        }
        if (options.tier !== undefined) {
          checkOptions.tier = options.tier;
        }

        // Enforce rate limit (throws if exceeded)
        await rateLimitService.enforce(key, checkOptions);

        // Log successful rate limit check if debug logging available
        const logger = this.logger || this.loggerModule?.logger;
        if (logger?.debug) {
          logger.debug(`[RateLimit] Allowed: ${className}.${methodName} key=${key}`);
        }
      } catch (error) {
        // Handle rate limit errors
        if (options.skipOnError && error && (error as any).name !== 'RateLimitExceededError') {
          // If skipOnError is true and this isn't a rate limit exceeded error,
          // allow the request to proceed (storage/service failure)
          const logger = this.logger || this.loggerModule?.logger;
          if (logger?.warn) {
            logger.warn(`[RateLimit] Check failed for ${className}.${methodName}, allowing due to skipOnError`, error);
          }
        } else {
          // Re-throw the error (either rate limit exceeded or skipOnError=false)
          throw error;
        }
      }

      // Call original method if rate limit check passes
      return originalMethod.apply(this, args);
    };

    // Store metadata for inspection/testing
    Reflect.defineMetadata(RATE_LIMIT_METADATA_KEY, options, target, propertyKey);

    return descriptor;
  };
}

/**
 * @Throttle Decorator
 *
 * Convenience decorator for token-bucket style rate limiting.
 * Converts requests-per-second to limit/windowMs for smoother rate limiting.
 *
 * This is useful for APIs that want smooth, distributed request flow rather
 * than burst allowances.
 *
 * @param requestsPerSecond - Maximum requests allowed per second
 * @param options - Additional rate limit options
 * @returns Method decorator
 *
 * @example
 * Simple throttle:
 * ```typescript
 * @Throttle(10) // 10 requests per second
 * async getBalance(accountId: string): Promise<Balance> {
 *   // Smooth rate limiting: max 10 req/s
 *   // Internally: limit=10, windowMs=1000
 * }
 * ```
 *
 * @example
 * Throttle with custom key:
 * ```typescript
 * @Throttle(5, {
 *   keyGenerator: (...args) => `api:${args[0]}`,
 *   tier: 'free'
 * })
 * async searchProducts(query: string): Promise<Product[]> {
 *   // Max 5 searches per second for free tier
 * }
 * ```
 *
 * @example
 * Throttle with graceful error handling:
 * ```typescript
 * @Throttle(10, { skipOnError: true })
 * async healthCheck(): Promise<{ status: string }> {
 *   // Won't fail health checks if rate limiter is down
 * }
 * ```
 *
 * @public
 */
export function Throttle(
  requestsPerSecond: number,
  options: Omit<IRateLimitDecoratorOptions, 'limit' | 'windowMs'> = {}
): MethodDecorator {
  if (requestsPerSecond <= 0 || !Number.isFinite(requestsPerSecond)) {
    throw new Error(`@Throttle: requestsPerSecond must be a positive number, got ${requestsPerSecond}`);
  }

  // Convert RPS to limit/window
  // For smooth throttling, use 1-second windows
  const limit = Math.ceil(requestsPerSecond);
  const windowMs = 1000;

  return RateLimit({
    ...options,
    limit,
    windowMs,
  });
}

/**
 * Generate rate limit key from class name, method name, and arguments
 *
 * Key format depends on options:
 * - With tier: `{tier}:{className}:{methodName?}:{identifier}`
 * - Without tier: `{className}:{methodName?}:{identifier}`
 *
 * @internal
 */
function generateRateLimitKey(
  className: string,
  methodName: string,
  args: unknown[],
  options: IRateLimitDecoratorOptions
): string {
  const parts: string[] = [];

  // Start with tier if specified
  if (options.tier) {
    parts.push(options.tier);
  }

  // Add class name for namespacing
  parts.push(className);

  // Add method name if requested (default: true)
  if (options.includeMethodName !== false) {
    parts.push(methodName);
  }

  // Generate the identifier part of the key
  let identifier: string;

  if (options.keyGenerator) {
    // Use custom key generator
    identifier = options.keyGenerator(...args);
  } else {
    // Default: use first argument as key
    const firstArg = args[0];
    identifier = firstArg !== null && firstArg !== undefined ? String(firstArg) : 'unknown';
  }

  parts.push(identifier);

  return parts.join(':');
}

/**
 * Get rate limit metadata for a method
 *
 * Useful for testing, introspection, and debugging to understand
 * what rate limits are applied to a method.
 *
 * @param target - Class prototype or instance
 * @param propertyKey - Method name
 * @returns Rate limit options if decorator is applied, undefined otherwise
 *
 * @example
 * ```typescript
 * class MyService {
 *   @RateLimit({ limit: 10, windowMs: 60000 })
 *   async myMethod() {}
 * }
 *
 * const metadata = getRateLimitMetadata(MyService.prototype, 'myMethod');
 * console.log(metadata); // { limit: 10, windowMs: 60000 }
 * ```
 *
 * @public
 */
export function getRateLimitMetadata(
  target: object,
  propertyKey: string | symbol
): IRateLimitDecoratorOptions | undefined {
  return Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, target, propertyKey);
}

/**
 * Check if a method has rate limiting applied
 *
 * @param target - Class prototype or instance
 * @param propertyKey - Method name
 * @returns True if method has @RateLimit decorator applied
 *
 * @example
 * ```typescript
 * if (hasRateLimit(MyService.prototype, 'myMethod')) {
 *   console.log('Method is rate limited');
 * }
 * ```
 *
 * @public
 */
export function hasRateLimit(target: object, propertyKey: string | symbol): boolean {
  return Reflect.hasMetadata(RATE_LIMIT_METADATA_KEY, target, propertyKey);
}

/**
 * Get all rate-limited methods in a class
 *
 * Returns a map of method names to their rate limit configurations.
 * Useful for generating documentation or monitoring dashboards.
 *
 * @param target - Class constructor or prototype
 * @returns Map of method names to rate limit options
 *
 * @example
 * ```typescript
 * const rateLimits = getAllRateLimits(MyService);
 * for (const [method, config] of rateLimits.entries()) {
 *   console.log(`${method}: ${config.limit} req/${config.windowMs}ms`);
 * }
 * ```
 *
 * @example
 * Generate documentation:
 * ```typescript
 * function generateRateLimitDocs(serviceClass: Function): string {
 *   const limits = getAllRateLimits(serviceClass);
 *   const docs: string[] = [];
 *
 *   for (const [method, config] of limits.entries()) {
 *     const rps = config.limit && config.windowMs
 *       ? (config.limit / (config.windowMs / 1000)).toFixed(2)
 *       : 'unknown';
 *     docs.push(`- ${method}: ${config.limit} requests per ${config.windowMs}ms (${rps} req/s)`);
 *   }
 *
 *   return docs.join('\n');
 * }
 * ```
 *
 * @public
 */
export function getAllRateLimits(
  target: (new (...args: unknown[]) => unknown) | object
): Map<string, IRateLimitDecoratorOptions> {
  const prototype = typeof target === 'function' ? target.prototype : target;
  const rateLimits = new Map<string, IRateLimitDecoratorOptions>();

  // Get all property names (including inherited)
  let current = prototype;
  while (current && current !== Object.prototype) {
    for (const propertyKey of Object.getOwnPropertyNames(current)) {
      // Skip constructor and non-methods
      if (propertyKey === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(current, propertyKey);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      // Check if method has rate limit metadata
      const metadata = getRateLimitMetadata(current, propertyKey);
      if (metadata) {
        // Only add if not already present (child class methods take precedence)
        if (!rateLimits.has(propertyKey)) {
          rateLimits.set(propertyKey, metadata);
        }
      }
    }

    current = Object.getPrototypeOf(current);
  }

  return rateLimits;
}
