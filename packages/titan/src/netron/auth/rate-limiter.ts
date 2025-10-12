/**
 * Rate Limiter for Netron Auth Subsystem
 * @module @omnitron-dev/titan/netron/auth
 */

import type { ILogger } from '../../modules/logger/logger.types.js';
import type { ExecutionContext } from './types.js';

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

  /** Current tier name */
  tier?: string;

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

  /** Statistics */
  checks: number;
  allowed: number;
  denied: number;
  queued: number;
}

/**
 * Queued request
 */
interface QueuedRequest {
  key: string;
  tier: string;
  priority: number;
  timestamp: number;
  resolve: (allowed: boolean) => void;
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

  /** Request queue (sorted by priority) */
  private readonly queue: QueuedRequest[] = [];

  /** Queue processing interval */
  private queueInterval?: NodeJS.Timeout;

  /** Cleanup interval */
  private cleanupInterval?: NodeJS.Timeout;

  /** Global statistics */
  private stats = {
    totalChecks: 0,
    totalAllowed: 0,
    totalDenied: 0,
    totalQueued: 0,
  };

  constructor(logger: ILogger, config?: RateLimitConfig) {
    this.logger = logger.child({ component: 'RateLimiter' });

    // Set defaults
    this.config = {
      window: config?.window ?? 60000, // 1 minute default
      strategy: config?.strategy ?? 'sliding',
      queue: config?.queue ?? false,
      maxQueueSize: config?.maxQueueSize ?? 1000,
      getTier: config?.getTier,
      defaultTier: config?.defaultTier ?? { name: 'default', limit: 100 },
      tiers: config?.tiers ?? {},
    };

    // Start queue processor if queuing is enabled
    if (this.config.queue) {
      this.startQueueProcessor();
    }

    // Start periodic cleanup
    this.startCleanup();

    this.logger.debug({ config: this.config }, 'Rate limiter initialized');
  }

  /**
   * Check if request is allowed without consuming
   */
  async check(key: string, tier?: string): Promise<RateLimitResult> {
    const tierConfig = this.getTierConfig(tier);
    const now = Date.now();

    // Get or create state
    const state = this.getOrCreateState(key);

    // Check based on strategy (without modifying state)
    let allowed: boolean;
    let remaining: number;
    let resetAt: Date;

    switch (this.config.strategy) {
      case 'sliding':
        ({ allowed, remaining, resetAt } = this.checkSlidingWindow(state, tierConfig, now, false));
        break;
      case 'fixed':
        ({ allowed, remaining, resetAt } = this.checkFixedWindow(state, tierConfig, now, false));
        break;
      case 'token-bucket':
        ({ allowed, remaining, resetAt } = this.checkTokenBucket(state, tierConfig, now, false));
        break;
      default:
        throw new Error(`Unknown strategy: ${this.config.strategy}`);
    }

    // Calculate retry after if denied
    let retryAfter: number | undefined;
    if (!allowed) {
      retryAfter = resetAt.getTime() - now;
    }

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter,
      tier: tierConfig.name,
    };
  }

  /**
   * Consume a request (marks it as used)
   */
  async consume(key: string, tier?: string): Promise<void> {
    const tierConfig = this.getTierConfig(tier);
    const now = Date.now();

    // Get or create state
    const state = this.getOrCreateState(key);

    // Track check
    state.checks++;

    // Check and consume based on strategy
    let allowed: boolean;
    let resetAt: Date;

    switch (this.config.strategy) {
      case 'sliding':
        ({ allowed, resetAt } = this.checkSlidingWindow(state, tierConfig, now, true).result);
        break;
      case 'fixed':
        ({ allowed, resetAt } = this.checkFixedWindow(state, tierConfig, now, true).result);
        break;
      case 'token-bucket':
        ({ allowed, resetAt } = this.checkTokenBucket(state, tierConfig, now, true).result);
        break;
      default:
        throw new Error(`Unknown strategy: ${this.config.strategy}`);
    }

    if (!allowed) {
      const retryAfter = resetAt.getTime() - now;

      // If queuing is enabled, add to queue
      if (this.config.queue && this.queue.length < this.config.maxQueueSize) {
        await this.enqueue(key, tierConfig);
        state.queued++;

        throw new Error('Request queued due to rate limit');
      }

      state.denied++;

      throw new Error(`Rate limit exceeded. Retry after ${retryAfter}ms`);
    }

    // Mark as consumed
    state.allowed++;
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    this.state.delete(key);
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
        currentQueueSize: this.queue.filter((q) => q.key === key).length,
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
      currentQueueSize: this.queue.length,
      byTier,
      activeKeys: this.state.size,
    };
  }

  /**
   * Destroy the rate limiter (cleanup resources)
   */
  destroy(): void {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.state.clear();
    this.queue.length = 0;
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
  ): { allowed: boolean; remaining: number; resetAt: Date; result: { allowed: boolean; resetAt: Date } } {
    // Remove expired timestamps
    const windowStart = now - this.config.window;
    const validTimestamps = state.timestamps.filter((t) => t > windowStart);

    // Check if under limit
    const limit = tier.limit + (tier.burst ?? 0);
    const currentCount = consume ? validTimestamps.length : state.timestamps.filter((t) => t > windowStart).length;
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

    return { allowed, remaining, resetAt, result: { allowed, resetAt } };
  }

  /**
   * Check using fixed window algorithm
   */
  private checkFixedWindow(
    state: RateLimitState,
    tier: RateLimitTier,
    now: number,
    consume: boolean
  ): { allowed: boolean; remaining: number; resetAt: Date; result: { allowed: boolean; resetAt: Date } } {
    // Calculate current window
    const currentWindow = Math.floor(now / this.config.window);
    const windowStart = currentWindow * this.config.window;
    const windowEnd = windowStart + this.config.window;

    // Get current count (considering window reset)
    const firstTimestamp = state.timestamps[0];
    let currentCount = 0;

    if (firstTimestamp && firstTimestamp >= windowStart) {
      currentCount = state.timestamps.length;
    }

    // Check if under limit
    const limit = tier.limit + (tier.burst ?? 0);
    const allowed = currentCount < limit;

    // If consuming, modify state
    if (consume) {
      // Reset if we're in a new window
      if (!firstTimestamp || firstTimestamp < windowStart) {
        state.timestamps = [];
      }

      // Add timestamp if allowed
      if (allowed) {
        state.timestamps.push(now);
      }
    }

    // Calculate remaining and reset time
    const finalCount = consume ? state.timestamps.length : currentCount + (allowed ? 0 : 0);
    const remaining = Math.max(0, limit - finalCount);
    const resetAt = new Date(windowEnd);

    return { allowed, remaining, resetAt, result: { allowed, resetAt } };
  }

  /**
   * Check using token bucket algorithm
   */
  private checkTokenBucket(
    state: RateLimitState,
    tier: RateLimitTier,
    now: number,
    consume: boolean
  ): { allowed: boolean; remaining: number; resetAt: Date; result: { allowed: boolean; resetAt: Date } } {
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
    const remaining = Math.floor(consume ? (state.tokens ?? 0) : allowed ? availableTokens - 1 : availableTokens);
    const tokensNeeded = maxTokens - (consume ? (state.tokens ?? 0) : availableTokens);
    const timeToRefill = tokensNeeded > 0 ? (tokensNeeded / tier.limit) * this.config.window : 0;
    const resetAt = new Date(now + timeToRefill);

    return { allowed, remaining, resetAt, result: { allowed, resetAt } };
  }

  /**
   * Enqueue a request
   */
  private enqueue(key: string, tier: RateLimitTier): Promise<boolean> {
    return new Promise((resolve) => {
      const request: QueuedRequest = {
        key,
        tier: tier.name,
        priority: tier.priority ?? 0,
        timestamp: Date.now(),
        resolve,
      };

      // Insert in priority order (higher priority first)
      const insertIndex = this.queue.findIndex((q) => q.priority < request.priority);
      if (insertIndex === -1) {
        this.queue.push(request);
      } else {
        this.queue.splice(insertIndex, 0, request);
      }

      this.logger.debug(
        { key, tier: tier.name, priority: tier.priority, queueSize: this.queue.length },
        'Request queued'
      );
    });
  }

  /**
   * Start queue processor
   */
  private startQueueProcessor(): void {
    // Process queue every 100ms
    this.queueInterval = setInterval(() => {
      this.processQueue();
    }, 100);
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    // Process requests in priority order
    const processed: QueuedRequest[] = [];

    for (const request of this.queue) {
      try {
        const result = await this.check(request.key, request.tier);
        if (result.allowed) {
          // Mark as consumed
          const state = this.state.get(request.key);
          if (state) {
            state.allowed++;
            this.stats.totalAllowed++;
          }

          request.resolve(true);
          processed.push(request);

          this.logger.debug({ key: request.key, tier: request.tier }, 'Queued request processed');
        }
      } catch (error) {
        this.logger.error({ error, key: request.key }, 'Error processing queued request');
        request.resolve(false);
        processed.push(request);
      }
    }

    // Remove processed requests
    for (const request of processed) {
      const index = this.queue.indexOf(request);
      if (index !== -1) {
        this.queue.splice(index, 1);
      }
    }
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
      const lastActivity = state.timestamps[state.timestamps.length - 1];
      if (!lastActivity || lastActivity < windowStart) {
        this.state.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug({ cleaned, remaining: this.state.size }, 'Cleaned up expired entries');
    }
  }
}
