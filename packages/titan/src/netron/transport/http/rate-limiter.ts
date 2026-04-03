/**
 * Sliding Window Rate Limiter for HTTP Server
 *
 * Implements a sliding window algorithm for rate limiting requests.
 * Supports both per-client and global rate limiting with configurable windows.
 *
 * ## When to Use This vs Auth Rate Limiter
 *
 * **This rate limiter (transport/http/rate-limiter.ts):**
 * - Transport-level DoS/DDoS protection
 * - Applied BEFORE request processing starts
 * - Simple per-IP and global limits
 * - Supports IP whitelisting for trusted clients
 * - Best for: Preventing resource exhaustion, blocking obvious abuse
 *
 * **Auth rate limiter (auth/rate-limiter.ts):**
 * - Business/application-level rate limiting
 * - Applied via PolicyEngine after authentication
 * - Tiered limits based on user subscription/role
 * - Queue support for graceful degradation
 * - Best for: API quotas, subscription enforcement
 *
 * **Typical Flow:**
 * 1. HTTP transport limiter → blocks DDoS/abuse (this file)
 * 2. Auth rate limiter → enforces business quotas (auth/rate-limiter.ts)
 *
 * @example
 * ```typescript
 * // Configure in HttpServer
 * const server = new HttpServer({
 *   rateLimit: {
 *     enabled: true,
 *     windowMs: 60000,        // 1 minute window
 *     maxRequests: 1000,      // 1000 requests per IP per minute
 *     globalMaxRequests: 10000, // 10000 total requests per minute
 *     whitelist: ['127.0.0.1', '::1'], // Skip rate limiting for localhost
 *   }
 * });
 * ```
 */

import type { RateLimitConfig } from '../types.js';

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Timestamp when the window resets (in milliseconds since epoch) */
  resetAt: number;
  /** Time to wait before retrying (in seconds), only set when not allowed */
  retryAfter?: number;
  /** The rate limit maximum */
  limit: number;
}

/**
 * Window entry for tracking request counts
 */
interface WindowEntry {
  /** Request count in current window */
  count: number;
  /** Timestamp when the window resets */
  resetAt: number;
}

/**
 * Sliding Window Rate Limiter
 *
 * Uses a simple sliding window algorithm where each key (client) has
 * a window that resets after windowMs milliseconds.
 *
 * @example
 * ```typescript
 * const limiter = new SlidingWindowRateLimiter({
 *   enabled: true,
 *   windowMs: 60000,      // 1 minute
 *   maxRequests: 100,     // 100 requests per minute per client
 *   globalMaxRequests: 10000, // 10000 requests per minute globally
 * });
 *
 * const result = await limiter.check('client-ip');
 * if (!result.allowed) {
 *   // Return 429 Too Many Requests
 * }
 * ```
 */
export class SlidingWindowRateLimiter {
  private windows = new Map<string, WindowEntry>();
  private globalWindow: WindowEntry | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private readonly enabled: boolean;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly globalMaxRequests: number;
  private readonly keyGenerator: (request: Request) => string;
  private readonly skipSuccessfulRequests: boolean;
  private readonly skipFailedRequests: boolean;
  private readonly whitelist: Set<string>;
  private readonly trustProxy: boolean;

  // Default cleanup interval: every 5 minutes
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000;

  constructor(config: RateLimitConfig = {}) {
    this.enabled = config.enabled ?? false;
    this.windowMs = config.windowMs ?? 60000; // 1 minute default
    this.maxRequests = config.maxRequests ?? 100;
    this.globalMaxRequests = config.globalMaxRequests ?? 10000;
    this.keyGenerator = config.keyGenerator ?? this.defaultKeyGenerator.bind(this);
    this.skipSuccessfulRequests = config.skipSuccessfulRequests ?? false;
    this.skipFailedRequests = config.skipFailedRequests ?? false;
    this.whitelist = new Set(config.whitelist ?? []);
    this.trustProxy = config.trustProxy ?? true;

    // Start cleanup interval if rate limiting is enabled
    if (this.enabled) {
      this.startCleanup();
    }
  }

  /**
   * Check if a request is allowed based on rate limits
   *
   * @param request - The incoming HTTP request
   * @returns Rate limit check result
   */
  check(request: Request): RateLimitResult {
    if (!this.enabled) {
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetAt: Date.now() + this.windowMs,
        limit: this.maxRequests,
      };
    }

    const key = this.keyGenerator(request);
    const now = Date.now();

    // Check whitelist
    if (this.isWhitelisted(key)) {
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetAt: now + this.windowMs,
        limit: this.maxRequests,
      };
    }

    // Check global rate limit first
    const globalResult = this.checkGlobalLimit(now);
    if (!globalResult.allowed) {
      return globalResult;
    }

    // Check per-client rate limit
    return this.checkClientLimit(key, now);
  }

  /**
   * Check global rate limit
   */
  private checkGlobalLimit(now: number): RateLimitResult {
    if (!this.globalWindow || this.globalWindow.resetAt <= now) {
      // Create new window
      this.globalWindow = {
        count: 1,
        resetAt: now + this.windowMs,
      };
      return {
        allowed: true,
        remaining: this.globalMaxRequests - 1,
        resetAt: this.globalWindow.resetAt,
        limit: this.globalMaxRequests,
      };
    }

    if (this.globalWindow.count >= this.globalMaxRequests) {
      const retryAfter = Math.ceil((this.globalWindow.resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: this.globalWindow.resetAt,
        retryAfter,
        limit: this.globalMaxRequests,
      };
    }

    this.globalWindow.count++;
    return {
      allowed: true,
      remaining: this.globalMaxRequests - this.globalWindow.count,
      resetAt: this.globalWindow.resetAt,
      limit: this.globalMaxRequests,
    };
  }

  /**
   * Check per-client rate limit
   */
  private checkClientLimit(key: string, now: number): RateLimitResult {
    const window = this.windows.get(key);

    if (!window || window.resetAt <= now) {
      // Create new window for this client
      this.windows.set(key, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetAt: now + this.windowMs,
        limit: this.maxRequests,
      };
    }

    if (window.count >= this.maxRequests) {
      const retryAfter = Math.ceil((window.resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: window.resetAt,
        retryAfter,
        limit: this.maxRequests,
      };
    }

    window.count++;
    return {
      allowed: true,
      remaining: this.maxRequests - window.count,
      resetAt: window.resetAt,
      limit: this.maxRequests,
    };
  }

  /**
   * Decrement the counter for a key (used when skipping successful/failed requests)
   */
  decrement(request: Request): void {
    if (!this.enabled) return;

    const key = this.keyGenerator(request);
    const window = this.windows.get(key);
    if (window && window.count > 0) {
      window.count--;
    }

    // Also decrement global counter
    if (this.globalWindow && this.globalWindow.count > 0) {
      this.globalWindow.count--;
    }
  }

  /**
   * Check if a request should have its count decremented after processing
   */
  shouldSkip(request: Request, success: boolean): boolean {
    if (!this.enabled) return false;
    if (success && this.skipSuccessfulRequests) return true;
    if (!success && this.skipFailedRequests) return true;
    return false;
  }

  /**
   * Check if a key is whitelisted
   */
  private isWhitelisted(key: string): boolean {
    return this.whitelist.has(key);
  }

  /**
   * Default key generator - extracts client IP from request
   */
  private defaultKeyGenerator(request: Request): string {
    // Try to get IP from proxy headers if trustProxy is enabled
    if (this.trustProxy) {
      const forwardedFor = request.headers.get('X-Forwarded-For');
      if (forwardedFor) {
        // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
        // The first one is the original client
        const clientIp = forwardedFor.split(',')[0]?.trim();
        if (clientIp) return clientIp;
      }

      const realIp = request.headers.get('X-Real-IP');
      if (realIp) return realIp;
    }

    // Fallback: try to extract from URL or use a default
    // Note: In Bun/Deno, we might need to access the socket info differently
    try {
      const url = new URL(request.url);
      // For localhost development
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return '127.0.0.1';
      }
      return url.hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Start periodic cleanup of expired windows
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL);

    // Don't prevent process from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Clean up expired windows to prevent memory leaks
   */
  cleanup(): void {
    const now = Date.now();

    // Clean up per-client windows
    for (const [key, window] of this.windows) {
      if (window.resetAt < now) {
        this.windows.delete(key);
      }
    }

    // Clean up global window
    if (this.globalWindow && this.globalWindow.resetAt < now) {
      this.globalWindow = null;
    }
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.windows.clear();
    this.globalWindow = null;
  }

  /**
   * Get current rate limiter statistics
   */
  getStats(): {
    enabled: boolean;
    activeClients: number;
    globalCount: number;
    globalResetAt: number | null;
    config: {
      windowMs: number;
      maxRequests: number;
      globalMaxRequests: number;
    };
  } {
    return {
      enabled: this.enabled,
      activeClients: this.windows.size,
      globalCount: this.globalWindow?.count ?? 0,
      globalResetAt: this.globalWindow?.resetAt ?? null,
      config: {
        windowMs: this.windowMs,
        maxRequests: this.maxRequests,
        globalMaxRequests: this.globalMaxRequests,
      },
    };
  }
}

/**
 * Create rate limit headers for a response
 */
export function createRateLimitHeaders(result: RateLimitResult): Headers {
  const headers = new Headers();

  headers.set('X-RateLimit-Limit', String(result.limit));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

  if (!result.allowed && result.retryAfter !== undefined) {
    headers.set('Retry-After', String(result.retryAfter));
  }

  return headers;
}
