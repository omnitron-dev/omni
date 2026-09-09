/**
 * Rate Limit Service
 *
 * Core service for unified rate limiting with multiple strategies.
 *
 * @module titan/modules/ratelimit
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { TitanError, ErrorCode } from '@omnitron-dev/titan/errors';
import type {
  IRateLimitService,
  IRateLimitStorage,
  IRateLimitResult,
  IRateLimitCheckOptions,
  IRateLimitStats,
  IRateLimitModuleOptions,
  IRateLimitTier,
} from './ratelimit.types.js';
import { RATE_LIMIT_OPTIONS_TOKEN, RATE_LIMIT_STORAGE_TOKEN, DEFAULT_RATE_LIMIT_PREFIX } from './ratelimit.tokens.js';
import { type IRateLimitAlgorithm, createAlgorithm } from './ratelimit.algorithms.js';
import { setAmbientRateLimitService, getAmbientRateLimitService } from './ratelimit.decorators.js';

/**
 * Default options for rate limit service
 */
const DEFAULT_OPTIONS: Required<Omit<IRateLimitModuleOptions, 'storageType' | 'isGlobal' | 'tiers' | 'defaultTier'>> = {
  enabled: true,
  strategy: 'sliding-window',
  keyPrefix: DEFAULT_RATE_LIMIT_PREFIX,
  defaultLimit: 100,
  defaultWindowMs: 60000,
  burstLimit: 0,
  tokenRefillRate: 100,
  queueEnabled: false,
  maxQueueSize: 1000,
  queueTimeoutMs: 5000,
};

/**
 * Rate limit exceeded error
 */
/**
 * Thrown when a caller has spent its allowance.
 *
 * A `TitanError` with `TOO_MANY_REQUESTS`, not a bare `Error`. It used to
 * be the latter, which carries no status, so the RPC seam reported every
 * exhausted rate limit as a **500 INTERNAL** — including sign-in's
 * anti-brute-force limit. A client cannot tell "slow down" from "the
 * server broke", so it retries immediately instead of backing off, and a
 * brute-force attempt shows up in monitoring as a spike of server faults
 * rather than of refusals: exactly backwards for detection.
 *
 * `retryAfter` travels in `details` so a caller can honour it without
 * parsing prose.
 *
 * The message deliberately does not name the key. It used to read
 * `Rate limit exceeded for key: AuthRpcService:signin:pgpuser`, which
 * hands an unauthenticated caller the internal key format and echoes back
 * the identifier they probed with. The key stays available to the server
 * on `.result` for logging.
 */
export class RateLimitExceededError extends TitanError {
  constructor(
    public readonly result: IRateLimitResult,
    /** Key that was exhausted. Server-side only — never in the message. */
    public readonly key?: string
  ) {
    const seconds = result.retryAfter ?? 0;
    super({
      code: ErrorCode.TOO_MANY_REQUESTS,
      message:
        seconds > 0
          ? `Rate limit exceeded. Retry after ${seconds}s.`
          : 'Rate limit exceeded. Retry shortly.',
      details: {
        retryAfter: seconds,
        ...(result.limit !== undefined && { limit: result.limit }),
        ...(result.remaining !== undefined && { remaining: result.remaining }),
      },
    });
    this.name = 'RateLimitExceededError';
  }
}

/**
 * Rate Limit Service
 *
 * Provides unified rate limiting with multiple strategies:
 * - Token bucket: Allows bursts with gradual refill
 * - Sliding window: Accurate rolling window tracking
 * - Fixed window: Simple, efficient window-based limiting
 *
 * @example
 * ```typescript
 * // Check and consume
 * const result = await rateLimitService.consume('user:123');
 * if (!result.allowed) {
 *   throw new Error(`Rate limited. Retry after ${result.retryAfter}s`);
 * }
 *
 * // Enforce (throws on limit exceeded)
 * await rateLimitService.enforce('user:123');
 *
 * // Check status without consuming
 * const status = await rateLimitService.getStatus('user:123');
 * console.log(`Remaining: ${status.remaining}/${status.limit}`);
 * ```
 */
@Injectable()
export class RateLimitService implements IRateLimitService {
  private readonly options: IRateLimitModuleOptions &
    Required<Omit<IRateLimitModuleOptions, 'storageType' | 'isGlobal' | 'tiers' | 'defaultTier'>>;
  private readonly algorithm: IRateLimitAlgorithm;
  private readonly stats: IRateLimitStats;
  private readonly tierStats: Map<string, { checks: number; allowed: number; denied: number }>;

  constructor(
    @Inject(RATE_LIMIT_STORAGE_TOKEN) private readonly storage: IRateLimitStorage,
    @Inject(RATE_LIMIT_OPTIONS_TOKEN) options: IRateLimitModuleOptions
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Initialize algorithm based on strategy
    this.algorithm = createAlgorithm(this.options.strategy, {
      refillRate: this.options.tokenRefillRate,
    });

    // Initialize statistics
    this.stats = {
      totalChecks: 0,
      totalAllowed: 0,
      totalDenied: 0,
      activeKeys: 0,
    };
    this.tierStats = new Map();

    // Publish for the decorators. `@RateLimit` reads
    // `this.__rateLimitService__` off the decorated instance, so a class that
    // does not inject that exact field falls into the decorator's graceful
    // degradation and allows every request. Making the configured service
    // reachable without per-class injection is what lets a declared limit
    // actually apply; an injected field still wins over this.
    setAmbientRateLimitService(this);
  }

  /**
   * Withdraw the ambient reference so a disposed service cannot keep
   * answering decorator calls in a re-initialised container (tests, mainly).
   */
  async onDestroy(): Promise<void> {
    if (getAmbientRateLimitService() === this) {
      setAmbientRateLimitService(undefined);
    }
  }

  /**
   * Resolve tier configuration from options
   */
  private resolveTier(tierName?: string): IRateLimitTier | undefined {
    if (!tierName) {
      return this.options.defaultTier;
    }

    // `tiers` may be a function so that limits sourced from mutable state —
    // an admin settings row, a config service — are read per check rather
    // than frozen into module options at boot.
    const tiers = typeof this.options.tiers === 'function' ? this.safeTiers() : this.options.tiers;
    return tiers?.[tierName] ?? this.options.defaultTier;
  }

  /**
   * Call the tier resolver, treating a throw as "no tiers configured".
   *
   * A resolver reaching for config that is not ready yet must degrade to the
   * default limit, not fail the request it was asked to rate-limit.
   */
  private safeTiers(): Record<string, IRateLimitTier> | undefined {
    try {
      return (this.options.tiers as () => Record<string, IRateLimitTier> | undefined)();
    } catch {
      return undefined;
    }
  }

  /**
   * Build storage key with proper prefix and tier
   */
  private buildKey(key: string, tier?: string): string {
    const parts = [this.options.keyPrefix];
    if (tier) {
      parts.push(tier);
    }
    parts.push(key);
    return parts.join(':');
  }

  /**
   * Update statistics for a rate limit check
   */
  private updateStats(allowed: boolean, tier?: string): void {
    this.stats.totalChecks++;
    if (allowed) {
      this.stats.totalAllowed++;
    } else {
      this.stats.totalDenied++;
    }

    // Update per-tier statistics
    if (tier) {
      let tierStat = this.tierStats.get(tier);
      if (!tierStat) {
        tierStat = { checks: 0, allowed: 0, denied: 0 };
        this.tierStats.set(tier, tierStat);
      }
      tierStat.checks++;
      if (allowed) {
        tierStat.allowed++;
      } else {
        tierStat.denied++;
      }
    }
  }

  /**
   * Check if a request is within the rate limit
   */
  async check(options: IRateLimitCheckOptions): Promise<IRateLimitResult> {
    if (!this.options.enabled) {
      // Rate limiting disabled, always allow
      return {
        allowed: true,
        remaining: this.options.defaultLimit,
        limit: this.options.defaultLimit,
        resetAt: Date.now() + this.options.defaultWindowMs,
      };
    }

    // Resolve tier configuration
    const tier = this.resolveTier(options.tier);

    // Determine effective limits (priority: options > tier > defaults)
    const limit = options.limit ?? tier?.limit ?? this.options.defaultLimit;
    const windowMs = options.windowMs ?? tier?.windowMs ?? this.options.defaultWindowMs;
    const burstLimit = tier?.burst ?? this.options.burstLimit;
    const effectiveLimit = limit + burstLimit;

    // Build storage key
    const storageKey = this.buildKey(options.key, options.tier);

    // Perform rate limit check
    const consume = options.consume ?? true;
    const result = await this.algorithm.check(this.storage, storageKey, effectiveLimit, windowMs, consume);

    // Add tier info to result
    if (options.tier) {
      result.tier = options.tier;
    }

    // Update statistics
    this.updateStats(result.allowed, options.tier);

    return result;
  }

  /**
   * Consume a token from the rate limit bucket
   */
  async consume(key: string, options?: Partial<IRateLimitCheckOptions>): Promise<IRateLimitResult> {
    return this.check({
      key,
      consume: true,
      ...options,
    });
  }

  /**
   * Enforce a rate limit, throwing an error if exceeded
   */
  async enforce(key: string, options?: Partial<IRateLimitCheckOptions>): Promise<void> {
    const result = await this.consume(key, options);

    if (!result.allowed) {
      throw new RateLimitExceededError(result, key);
    }
  }

  /**
   * Get the current status without consuming a token
   */
  async getStatus(key: string, options?: Partial<IRateLimitCheckOptions>): Promise<IRateLimitResult> {
    return this.check({
      key,
      consume: false,
      ...options,
    });
  }

  /**
   * Reset the rate limit for a specific key
   *
   * @param key - Rate limit key to reset
   * @param tier - Optional tier for the key
   */
  async reset(key: string, tier?: string): Promise<void> {
    const storageKey = this.buildKey(key, tier);
    // Resolve the effective window (same precedence as check) so the
    // fixed-window algorithm can target the current window-suffixed key.
    const tierConfig = this.resolveTier(tier);
    const windowMs = tierConfig?.windowMs ?? this.options.defaultWindowMs;
    await this.algorithm.reset(this.storage, storageKey, windowMs);
  }

  /**
   * Get usage statistics for the rate limiter
   *
   * Includes per-tier breakdown if multi-tier limits are configured.
   */
  getStats(): IRateLimitStats {
    const stats = { ...this.stats };

    // Include per-tier statistics if any exist
    if (this.tierStats.size > 0) {
      stats.byTier = new Map(this.tierStats);
    }

    return stats;
  }

  /**
   * Cleanup resources and stop the service
   */
  destroy(): void {
    if (this.storage.destroy) {
      this.storage.destroy();
    }
  }
}
