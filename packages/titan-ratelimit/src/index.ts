/**
 * Rate Limit Module
 *
 * Unified rate limiting for distributed systems with multiple strategies,
 * pluggable storage backends, and Netron HTTP middleware integration.
 *
 * @module titan/modules/ratelimit
 *
 * @example
 * Module registration:
 * ```typescript
 * import { TitanRateLimitModule, RATE_LIMIT_SERVICE_TOKEN } from '@omnitron-dev/titan/module/ratelimit';
 *
 * @Module({
 *   imports: [
 *     TitanRateLimitModule.forRoot({
 *       strategy: 'sliding-window',
 *       defaultLimit: 100,
 *       defaultWindowMs: 60000,
 *       storageType: 'redis',
 *       tiers: {
 *         free: { name: 'free', limit: 100 },
 *         premium: { name: 'premium', limit: 1000, burst: 100 },
 *       },
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * Using decorators:
 * ```typescript
 * import { RateLimit, Throttle, RATE_LIMIT_SERVICE_TOKEN } from '@omnitron-dev/titan/module/ratelimit';
 *
 * @Service({ name: 'UserService@1.0.0' })
 * class UserService {
 *   constructor(
 *     @Inject(RATE_LIMIT_SERVICE_TOKEN)
 *     private readonly __rateLimitService__: IRateLimitService
 *   ) {}
 *
 *   @RateLimit({ limit: 10, windowMs: 60000 })
 *   async createUser(data: CreateUserDto) { }
 *
 *   @Throttle(5) // 5 requests per second
 *   async listUsers() { }
 * }
 * ```
 *
 * @example
 * HTTP middleware:
 * ```typescript
 * import { createRateLimitMiddleware } from '@omnitron-dev/titan/module/ratelimit';
 *
 * const middleware = createRateLimitMiddleware({
 *   limit: 100,
 *   windowMs: 60000,
 *   trustProxy: true,
 * });
 * ```
 */

export * from './ratelimit.types.js';
export * from './ratelimit.tokens.js';
export * from './ratelimit.storage.js';
export * from './ratelimit.algorithms.js';
export * from './ratelimit.service.js';
export * from './ratelimit.decorators.js';
export * from './ratelimit.module.js';
export * from './ratelimit.middleware.js';
