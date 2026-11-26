/**
 * Rate Limiter for Netron Auth Subsystem
 * @module @omnitron-dev/titan/netron/auth
 *
 * ## When to Use This vs HTTP Transport Rate Limiter
 *
 * **This rate limiter (auth/rate-limiter.ts):**
 * - Business/application-level rate limiting
 * - Used within PolicyEngine for fine-grained control
 * - Supports tiered limits (free, premium, enterprise users)
 * - Supports queueing instead of rejecting
 * - Multiple strategies: sliding window, fixed window, token bucket
 * - Best for: API quotas, subscription-based limits, user-specific limits
 *
 * **HTTP Transport rate limiter (transport/http/rate-limiter.ts):**
 * - Transport-level DoS protection
 * - Applied to all incoming HTTP requests before processing
 * - Simple per-client and global limits
 * - Supports IP whitelisting and proxy trust
 * - Best for: DDoS protection, preventing resource exhaustion
 *
 * **Usage Pattern:**
 * 1. HTTP transport limiter runs FIRST - blocks obvious abuse
 * 2. Auth rate limiter runs via PolicyEngine - applies business rules
 *
 * @example
 * ```typescript
 * // Transport-level protection (in HttpServer options)
 * const server = new HttpServer({
 *   rateLimit: { enabled: true, maxRequests: 1000, windowMs: 60000 }
 * });
 *
 * // Business-level limits (via policies)
 * policyEngine.register(BuiltInPolicies.requireRateLimit(logger, {
 *   defaultTier: { name: 'free', limit: 100 },
 *   tiers: { premium: { name: 'premium', limit: 1000 } }
 * }));
 * ```
 */

import type { ILogger } from '../../modules/logger/logger.types.js';
import type { ExecutionContext } from './types.js';
import { Errors, RateLimitError } from '../../errors/index.js';
import { RateLimitWaitQueue } from './rate-limit-queue.js';

/**
 * Maximum time (in milliseconds) a request can wait in the queue before timing out.
 * This prevents queued requests from waiting indefinitely if the queue processor stops.
 *
 * @constant {number} MAX_QUEUE_TIMEOUT_MS
 */
const MAX_QUEUE_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Rate limit tier configuration
 */
export interface RateLimitTier {
  /** Tier name (e.g., 'free', 'premium', 'enterprise') */
  name: string;

  /** Base limit (requests per window) */
  limit: number;

  /** Burst allowance (temporary spike tolerance) */
  burst?: number;

  /** Priority (higher = processed first when queued) */
  priority?: number;
}

/**
 * Rate limit strategy types
 */
export type RateLimitStrategy = 'sliding' | 'fixed' | 'token-bucket';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Default tier for unauthenticated users */
  defaultTier?: RateLimitTier;

  /** Tiers by role or custom key */
  tiers?: Record<string, RateLimitTier>;

  /** Time window in milliseconds (default: 60000 = 1 minute) */
  window?: number;

  /** Rate limiting strategy (default: 'sliding') */
  strategy?: RateLimitStrategy;

  /** Queue requests instead of rejecting (FIFO) */
  queue?: boolean;

  /** Max queue size (default: 1000) */
  maxQueueSize?: number;

  /** Maximum time to wait before another acquisition can be dispatched (milliseconds). */
  queueTimeoutMs?: number;

  /** Custom tier selector */
  getTier?: (ctx: ExecutionContext) => string;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether request is allowed */
  allowed: boolean;

  /** Remaining requests in current window */
  remaining: number;

  /** When the rate limit resets */
  resetAt: Date;

  /** Milliseconds until can retry (if denied) */
  retryAfter?: number;

  /** Earliest estimated admission time in epoch milliseconds. */
  retryAt?: number;

  /** Current tier name */
  tier?: string;

  /** True when this acquisition waited for capacity. */
  queued?: boolean;

  /** Queue position (if queued) */
  queuePosition?: number;
}

/**
 * Rate limit statistics
 */
export interface RateLimitStats {
  /** Total requests checked */
  totalChecks: number;

  /** Total requests allowed */
  totalAllowed: number;

  /** Total requests denied */
  totalDenied: number;

  /** Total requests queued */
  totalQueued: number;

  /** Current queue size */
  currentQueueSize: number;

  /** Stats by tier */
  byTier: Map<
    string,
    {
      checks: number;
      allowed: number;
      denied: number;
      queued: number;
    }
  >;

  /** Active keys being tracked */
  activeKeys: number;
}

/**
 * Internal rate limit state
 */
interface RateLimitState {
  /** Request timestamps (for sliding/fixed window) */
  timestamps: number[];

  /** Token bucket state */
  tokens?: number;
  lastRefill?: number;
  fullAt?: number;

  /** Statistics */
  checks: number;
  allowed: number;
  denied: number;
  queued: number;
}

/**
 * Rate Limiter
 *
 * Provides configurable rate limiting with multiple strategies:
 * - Sliding Window: Most accurate, tracks individual request timestamps
 * - Fixed Window: Simpler, less memory, resets at fixed intervals
 * - Token Bucket: Supports burst traffic, tokens refill over time
 *
 * Features:
 * - Tiered limiting (free, premium, enterprise, etc.)
 * - Queue mode with priority support
 * - Automatic cleanup of expired entries
 * - Thread-safe concurrent request handling
 * - Memory efficient
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter(logger, {
 *   strategy: 'sliding',
 *   window: 60000, // 1 minute
 *   defaultTier: { name: 'free', limit: 100 },
 *   tiers: {
 *     premium: { name: 'premium', limit: 1000, burst: 50 },
 *     enterprise: { name: 'enterprise', limit: 10000, burst: 200, priority: 10 }
 *   }
 * });
 *
 * // Check if request is allowed
 * const result = await limiter.check('user-123', 'premium');
 * if (result.allowed) {
 *   await limiter.consume('user-123', 'premium');
 *   // Process request
 * }
 * ```
 */
export class RateLimiter {
  private readonly logger: ILogger;
  private readonly config: Required<Omit<RateLimitConfig, 'getTier' | 'defaultTier' | 'tiers'>> & {
    getTier?: (ctx: ExecutionContext) => string;
    defaultTier: RateLimitTier;
    tiers: Record<string, RateLimitTier>;
  };

  /** Rate limit state by key */
  private readonly state = new Map<string, RateLimitState>();

  private readonly queue?: RateLimitWaitQueue<RateLimitResult>;
  private destroyed = false;

  /** Cleanup interval */
  private cleanupInterval?: NodeJS.Timeout;

  constructor(logger: ILogger, config?: RateLimitConfig) {
    this.logger = logger.child({ component: 'RateLimiter' });

    // Set defaults
    this.config = {
      window: config?.window ?? 60000, // 1 minute default
      strategy: config?.strategy ?? 'sliding',
      queue: config?.queue ?? false,
      maxQueueSize: config?.maxQueueSize ?? 1000,
      queueTimeoutMs: config?.queueTimeoutMs ?? MAX_QUEUE_TIMEOUT_MS,
      getTier: config?.getTier,
      defaultTier: config?.defaultTier ?? { name: 'default', limit: 100 },
      tiers: config?.tiers ?? {},
    };

    if (this.config.queue) {
      this.queue = new RateLimitWaitQueue(this.config.maxQueueSize, this.config.queueTimeoutMs,
        denial => (denial.retryAt ?? denial.resetAt.getTime()) - Date.now());
    }

    // Start periodic cleanup
    this.startCleanup();

    this.logger.debug({ config: this.config }, 'Rate limiter initialized');
  }

  /**
   * Check if request is allowed without consuming
   */
  async check(key: string, tier?: string): Promise<RateLimitResult> {
    return this.attempt(this.getOrCreateState(key), this.getTierConfig(tier), false);
  }

  private attempt(state: RateLimitState, tier: RateLimitTier, consume: boolean): RateLimitResult {
    const now = Date.now();
    let result: RateLimitResult;
    switch (this.config.strategy) {
      case 'sliding': result = this.checkSlidingWindow(state, tier, now, consume); break;
      case 'fixed': result = this.checkFixedWindow(state, tier, now, consume); break;
      case 'token-bucket': result = this.checkTokenBucket(state, tier, now, consume); break;
      default: throw Errors.badRequest(`Unknown rate limit strategy: ${this.config.strategy}`);
    }
    result.tier = tier.name;
    if (!result.allowed) {
      result.retryAfter ??= Math.max(0, result.resetAt.getTime() - now);
      result.retryAt = now + result.retryAfter;
    }
    return result;
  }

  /** Consume one slot and return its authoritative result, including a bounded wait when configured. */
  async acquire(key: string, tier?: string, signal?: AbortSignal): Promise<RateLimitResult> {
    signal?.throwIfAborted();
    const config = this.getTierConfig(tier);
    const state = this.getOrCreateState(key);
    const consume = () => this.attempt(this.getOrCreateState(key), config, true);
    state.checks++;
    let result = consume();
    if (!result.allowed && this.queue) {
      const waiting = this.queue.wait(key, config.priority ?? 0, result, consume, signal);
      if (waiting) {
        state.queued++;
        result = { ...await waiting, queued: true };
      }
    }
    if (result.allowed) state.allowed++;
    else {
      state.denied++;
      result.retryAfter = Math.max(0, (result.retryAt ?? result.resetAt.getTime()) - Date.now());
    }
    return result;
  }

  /** Consume one slot or throw a structured rate limit error. */
  async consume(key: string, tier?: string): Promise<void> {
    const result = await this.acquire(key, tier);
    if (!result.allowed) {
      throw new RateLimitError('Rate limit exceeded', result.queued ? { queued: true } : undefined, {
        retryAfter: result.retryAfter, remaining: result.remaining, resetTime: result.resetAt,
      });
    }
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    this.state.delete(key);
    this.queue?.wake(key);
    this.logger.debug({ key }, 'Rate limit reset');
  }

  /**
   * Get statistics
   */
  getStats(key?: string): RateLimitStats {
    if (key) {
      const state = this.state.get(key);
      if (!state) {
        return {
          totalChecks: 0,
          totalAllowed: 0,
          totalDenied: 0,
          totalQueued: 0,
          currentQueueSize: 0,
          byTier: new Map(),
          activeKeys: 0,
        };
      }

      return {
        totalChecks: state.checks,
        totalAllowed: state.allowed,
        totalDenied: state.denied,
        totalQueued: state.queued,
        currentQueueSize: this.queue?.count(key) ?? 0,
        byTier: new Map(),
        activeKeys: 1,
      };
    }

    // Global stats - aggregate from all states
    let totalChecks = 0;
    let totalAllowed = 0;
    let totalDenied = 0;
    let totalQueued = 0;

    for (const state of this.state.values()) {
      totalChecks += state.checks;
      totalAllowed += state.allowed;
      totalDenied += state.denied;
      totalQueued += state.queued;
    }

    const byTier = new Map<string, { checks: number; allowed: number; denied: number; queued: number }>();

    return {
      totalChecks,
      totalAllowed,
      totalDenied,
      totalQueued,
      currentQueueSize: this.queue?.count() ?? 0,
      byTier,
      activeKeys: this.state.size,
    };
  }

  /**
   * Destroy the rate limiter (cleanup resources).
   * Clears all intervals, timeout handles, and queued requests.
   */
  destroy(): void {
    this.destroyed = true;
    clearInterval(this.cleanupInterval);
    this.queue?.destroy();
    this.state.clear();
    this.logger.debug('Rate limiter destroyed');
  }

  /**
   * Get tier configuration
   */
  private getTierConfig(tier?: string): RateLimitTier {
    if (!tier) {
      return this.config.defaultTier;
    }

    const tierConfig = this.config.tiers[tier];
    if (!tierConfig) {
      this.logger.warn({ tier }, 'Unknown tier, using default');
      return this.config.defaultTier;
    }

    return tierConfig;
  }

  /**
   * Get or create state for a key
   */
  private getOrCreateState(key: string): RateLimitState {
    if (this.destroyed) throw new Error('Rate limiter destroyed');
    let state = this.state.get(key);
    if (!state) {
      state = {
        timestamps: [],
        checks: 0,
        allowed: 0,
        denied: 0,
        queued: 0,
      };
      this.state.set(key, state);
    }
    return state;
  }

  /**
   * Check using sliding window algorithm
   */
  private checkSlidingWindow(
    state: RateLimitState,
    tier: RateLimitTier,
    now: number,
    consume: boolean
  ): RateLimitResult {
    // Remove expired timestamps - filter once and reuse
    const windowStart = now - this.config.window;
    const validTimestamps = state.timestamps.filter((t) => t > windowStart);

    // Check if under limit - reuse validTimestamps instead of filtering again
    const limit = tier.limit + (tier.burst ?? 0);
    const currentCount = validTimestamps.length;
    const allowed = currentCount < limit;

    // If consuming and allowed, add timestamp
    if (consume) {
      state.timestamps = validTimestamps;
      if (allowed) {
        state.timestamps.push(now);
      }
    }

    // Calculate remaining and reset time
    const remaining = Math.max(0, limit - (consume ? state.timestamps.length : currentCount));
    const oldestTimestamp = (consume ? state.timestamps[0] : validTimestamps[0]) ?? now;
    const resetAt = new Date(oldestTimestamp + this.config.window);

    return { allowed, remaining, resetAt };
  }

  /**
   * Check using fixed window algorithm
   */
  private checkFixedWindow(
    state: RateLimitState,
    tier: RateLimitTier,
    now: number,
    consume: boolean
  ): RateLimitResult {
    // Calculate current window
    const currentWindow = Math.floor(now / this.config.window);
    const windowStart = currentWindow * this.config.window;
    const windowEnd = windowStart + this.config.window;

    // Get current count (considering window reset)
    const firstTimestamp = state.timestamps[0];
    let currentCount = 0;

    if (firstTimestamp !== undefined && firstTimestamp >= windowStart) {
      currentCount = state.timestamps.length;
    }

    // Check if under limit
    const limit = tier.limit + (tier.burst ?? 0);
    const allowed = currentCount < limit;

    // If consuming, modify state
    if (consume) {
      // Reset if we're in a new window
      if (firstTimestamp === undefined || firstTimestamp < windowStart) {
        state.timestamps = [];
      }

      // Add timestamp if allowed
      if (allowed) {
        state.timestamps.push(now);
      }
    }

    // Calculate remaining and reset time
    const finalCount = consume ? state.timestamps.length : currentCount;
    const remaining = Math.max(0, limit - finalCount);
    const resetAt = new Date(windowEnd);

    return { allowed, remaining, resetAt };
  }

  /**
   * Check using token bucket algorithm
   */
  private checkTokenBucket(
    state: RateLimitState,
    tier: RateLimitTier,
    now: number,
    consume: boolean
  ): RateLimitResult {
    // Get current token state
    const maxTokens = tier.limit + (tier.burst ?? 0);
    const currentTokens = state.tokens ?? maxTokens; // Start with max if not initialized
    const lastRefill = state.lastRefill ?? now;

    // Calculate tokens to add based on time passed
    const timePassed = now - lastRefill;
    const tokensToAdd = timePassed > 0 ? (timePassed / this.config.window) * tier.limit : 0;

    // Calculate available tokens (up to limit + burst)
    let availableTokens = Math.min(maxTokens, currentTokens + tokensToAdd);

    // Check if we have tokens available
    const allowed = availableTokens >= 1;

    // Consume token if requested and allowed
    if (consume) {
      state.tokens = availableTokens;
      state.lastRefill = now;

      if (allowed) {
        state.tokens -= 1;
        availableTokens -= 1;
      }
    }

    // Calculate remaining and reset time
    const remaining = Math.floor(availableTokens);
    const tokensNeeded = maxTokens - availableTokens;
    const timeToRefill = tokensNeeded > 0 ? (tokensNeeded / tier.limit) * this.config.window : 0;
    const resetAt = new Date(now + timeToRefill);
    if (consume) state.fullAt = now + timeToRefill;
    const retryAfter = allowed ? undefined : Math.ceil((1 - availableTokens) * this.config.window / tier.limit);
    return { allowed, remaining, resetAt, retryAfter };
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    // Cleanup every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000
    );
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.window * 2; // Keep extra window for safety
    let cleaned = 0;

    for (const [key, state] of this.state.entries()) {
      // Remove if no recent activity
      const lastActivity = state.lastRefill ?? state.timestamps.at(-1) ?? -Infinity;
      if (lastActivity < windowStart && (state.fullAt ?? 0) <= now && !this.queue?.count(key)) {
        this.state.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug({ cleaned, remaining: this.state.size }, 'Cleaned up expired entries');
    }
  }
}
