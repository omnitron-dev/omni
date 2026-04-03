/**
 * Rate Limit Middleware for Netron HTTP Transport
 *
 * Provides transport-level rate limiting that integrates with the TitanRateLimitModule.
 * Can be used standalone (transport-level) or with service injection (service-level).
 *
 * @module @omnitron-dev/titan/module/ratelimit
 */

import type {
  MiddlewareFunction,
  HttpMiddlewareContext,
  MiddlewareConfig,
} from '@omnitron-dev/titan/netron/transport/http/middleware';
import type { IRateLimitService, IRateLimitResult } from './ratelimit.types.js';
import { MemoryRateLimitStorage } from './ratelimit.storage.js';
import { SlidingWindowAlgorithm } from './ratelimit.algorithms.js';

/**
 * Rate limit middleware configuration
 */
export interface RateLimitMiddlewareOptions {
  /**
   * Enable or disable rate limiting
   * @default true
   */
  enabled?: boolean;

  /**
   * Maximum requests per window
   * @default 100
   */
  limit?: number;

  /**
   * Time window in milliseconds
   * @default 60000 (1 minute)
   */
  windowMs?: number;

  /**
   * Maximum global requests (across all clients)
   * @default undefined (no global limit)
   */
  globalLimit?: number;

  /**
   * Trust X-Forwarded-For and X-Real-IP headers
   * @default false
   */
  trustProxy?: boolean;

  /**
   * IP addresses or patterns to whitelist
   */
  whitelist?: string[];

  /**
   * Custom key generator
   * @param ctx - HTTP middleware context
   * @returns Rate limit key
   */
  keyGenerator?: (ctx: HttpMiddlewareContext) => string;

  /**
   * Custom error message
   * @default 'Too many requests, please try again later.'
   */
  message?: string;

  /**
   * Injected rate limit service (optional, falls back to internal implementation)
   */
  rateLimitService?: IRateLimitService;

  /**
   * Skip counting successful requests (2xx status)
   * @default false
   */
  skipSuccessfulRequests?: boolean;

  /**
   * Skip counting failed requests (4xx/5xx status)
   * @default false
   */
  skipFailedRequests?: boolean;

  /**
   * Custom handler when rate limit is exceeded
   */
  onRateLimited?: (ctx: HttpMiddlewareContext, result: IRateLimitResult) => void | Promise<void>;

  /**
   * Custom handler for extracting tier from context
   */
  getTier?: (ctx: HttpMiddlewareContext) => string | undefined;
}

/**
 * Default middleware options
 */
const DEFAULT_OPTIONS: Required<
  Omit<
    RateLimitMiddlewareOptions,
    'rateLimitService' | 'onRateLimited' | 'keyGenerator' | 'getTier' | 'whitelist' | 'globalLimit'
  >
> = {
  enabled: true,
  limit: 100,
  windowMs: 60000,
  trustProxy: false,
  message: 'Too many requests, please try again later.',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
};

/**
 * Rate Limit Middleware
 *
 * Creates a Netron HTTP middleware for rate limiting. Can work in two modes:
 *
 * 1. **Standalone Mode**: Uses internal sliding-window algorithm with in-memory storage.
 *    Suitable for single-instance deployments or transport-level protection.
 *
 * 2. **Integrated Mode**: Uses injected IRateLimitService from TitanRateLimitModule.
 *    Provides distributed rate limiting with Redis backend and tier support.
 *
 * @example
 * Standalone usage:
 * ```typescript
 * const middleware = createRateLimitMiddleware({
 *   limit: 100,
 *   windowMs: 60000,
 *   trustProxy: true,
 * });
 *
 * httpServer.use(middleware, { name: 'rate-limit', priority: 5 }, MiddlewareStage.PRE_PROCESS);
 * ```
 *
 * @example
 * Integrated with TitanRateLimitModule:
 * ```typescript
 * @Injectable()
 * class HttpSetup {
 *   constructor(
 *     @Inject(RATE_LIMIT_SERVICE_TOKEN) private rateLimitService: IRateLimitService
 *   ) {}
 *
 *   configureMiddleware(httpServer: HttpServer) {
 *     httpServer.use(
 *       createRateLimitMiddleware({
 *         rateLimitService: this.rateLimitService,
 *         getTier: (ctx) => ctx.metadata.get('userTier') as string,
 *       }),
 *       { name: 'rate-limit' },
 *       MiddlewareStage.PRE_INVOKE
 *     );
 *   }
 * }
 * ```
 *
 * @param options - Middleware configuration
 * @returns Netron middleware function
 */
export function createRateLimitMiddleware(
  options: RateLimitMiddlewareOptions = {}
): MiddlewareFunction<HttpMiddlewareContext> {
  const config = { ...DEFAULT_OPTIONS, ...options };

  // Create internal rate limiter if no service provided
  let internalStorage: MemoryRateLimitStorage | undefined;
  let internalAlgorithm: SlidingWindowAlgorithm | undefined;

  if (!config.rateLimitService) {
    internalStorage = new MemoryRateLimitStorage({
      cleanupIntervalMs: 60000,
      maxKeys: 10000,
    });
    internalAlgorithm = new SlidingWindowAlgorithm();
  }

  // Global rate limit state (if configured)
  let globalStorage: MemoryRateLimitStorage | undefined;
  if (config.globalLimit) {
    globalStorage = new MemoryRateLimitStorage({
      cleanupIntervalMs: 60000,
      maxKeys: 100,
    });
  }

  return async (ctx: HttpMiddlewareContext, next: () => Promise<void>): Promise<void> => {
    // Skip if disabled
    if (!config.enabled) {
      return next();
    }

    // Extract client identifier
    const key = config.keyGenerator ? config.keyGenerator(ctx) : extractClientKey(ctx, config.trustProxy);

    // Check whitelist
    if (config.whitelist?.length) {
      if (isWhitelisted(key, config.whitelist)) {
        return next();
      }
    }

    // Check global limit first
    if (config.globalLimit && globalStorage && internalAlgorithm) {
      const globalResult = await internalAlgorithm.check(
        globalStorage,
        'global',
        config.globalLimit,
        config.windowMs,
        true
      );

      if (!globalResult.allowed) {
        await handleRateLimited(ctx, globalResult, config);
        return undefined;
      }
    }

    // Perform rate limit check
    let result: IRateLimitResult;

    if (config.rateLimitService) {
      // Use injected service (supports tiers, Redis, etc.)
      const tier = config.getTier?.(ctx);
      result = await config.rateLimitService.check({
        key,
        tier,
        consume: true,
      });
    } else if (internalStorage && internalAlgorithm) {
      // Use internal standalone implementation
      result = await internalAlgorithm.check(internalStorage, key, config.limit, config.windowMs, true);
    } else {
      // Should never happen, but allow request if misconfigured
      return next();
    }

    // Store result in context for downstream use
    ctx.metadata.set('rateLimit', result);

    // Check if rate limited
    if (!result.allowed) {
      await handleRateLimited(ctx, result, config);
      return undefined;
    }

    // Add rate limit headers
    addRateLimitHeaders(ctx, result);

    // Continue to next middleware
    await next();

    // Post-processing: optionally undo count based on response
    if (config.skipSuccessfulRequests || config.skipFailedRequests) {
      // Note: This would require "unconsume" capability in the rate limiter
      // which is not currently implemented. This is a design note for future work.
    }
    return undefined;
  };
}

/**
 * Extract client identifier from HTTP context
 */
function extractClientKey(ctx: HttpMiddlewareContext, trustProxy: boolean): string {
  if (trustProxy) {
    // Check proxy headers
    const forwardedFor = ctx.request.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
      if (ips) {
        return ips.trim();
      }
    }

    const realIp = ctx.request.headers['x-real-ip'];
    if (realIp) {
      const ip = Array.isArray(realIp) ? realIp[0] : realIp;
      if (ip) {
        return ip;
      }
    }
  }

  // Fall back to socket remote address
  const socket = ctx.request.socket;
  return socket.remoteAddress || 'unknown';
}

/**
 * Check if a key matches whitelist patterns
 */
function isWhitelisted(key: string, whitelist: string[]): boolean {
  for (const pattern of whitelist) {
    // Exact match
    if (key === pattern) {
      return true;
    }

    // CIDR-style match (simplified: only /24 and /16 for IPv4)
    if (pattern.includes('/')) {
      const parts = pattern.split('/');
      const network = parts[0];
      const bits = parts[1];

      if (!network || !bits) continue;

      const maskBits = parseInt(bits, 10);
      if (isNaN(maskBits)) continue;

      if (key.includes('.') && network.includes('.')) {
        // IPv4
        const keyParts = key.split('.');
        const networkParts = network.split('.');
        const octetsToCompare = Math.floor(maskBits / 8);

        let matches = true;
        for (let i = 0; i < octetsToCompare && i < 4; i++) {
          if (keyParts[i] !== networkParts[i]) {
            matches = false;
            break;
          }
        }
        if (matches) return true;
      }
    }

    // Wildcard match
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(key)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Handle rate limited response
 */
async function handleRateLimited(
  ctx: HttpMiddlewareContext,
  result: IRateLimitResult,
  config: RateLimitMiddlewareOptions & typeof DEFAULT_OPTIONS
): Promise<void> {
  // Call custom handler if provided
  if (config.onRateLimited) {
    await config.onRateLimited(ctx, result);
  }

  // Add rate limit headers
  addRateLimitHeaders(ctx, result);

  // Set retry-after header
  if (result.retryAfter) {
    ctx.response.setHeader('Retry-After', result.retryAfter.toString());
  }

  // Set 429 status and error response
  ctx.response.statusCode = 429;
  ctx.response.setHeader('Content-Type', 'application/json');
  ctx.response.end(
    JSON.stringify({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: config.message,
        retryAfter: result.retryAfter,
        limit: result.limit,
        remaining: result.remaining,
        resetAt: result.resetAt,
      },
    })
  );

  // Mark to skip remaining middleware
  ctx.skipRemaining = true;
}

/**
 * Add standard rate limit headers to response
 */
function addRateLimitHeaders(ctx: HttpMiddlewareContext, result: IRateLimitResult): void {
  ctx.response.setHeader('X-RateLimit-Limit', result.limit.toString());
  ctx.response.setHeader('X-RateLimit-Remaining', result.remaining.toString());
  ctx.response.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000).toString());

  if (result.tier) {
    ctx.response.setHeader('X-RateLimit-Tier', result.tier);
  }
}

/**
 * Middleware configuration preset for rate limiting
 */
export const RATE_LIMIT_MIDDLEWARE_CONFIG: Partial<MiddlewareConfig> = {
  name: 'rate-limit',
  priority: 5, // Early in the pipeline
};

/**
 * Get the rate limit result from context (set by middleware)
 */
export function getRateLimitFromContext(ctx: HttpMiddlewareContext): IRateLimitResult | undefined {
  return ctx.metadata.get('rateLimit') as IRateLimitResult | undefined;
}
