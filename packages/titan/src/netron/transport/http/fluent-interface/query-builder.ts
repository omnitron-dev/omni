/**
 * Query Builder for HTTP Interface
 *
 * Provides chainable API for configuring and executing HTTP RPC requests
 * with intelligent features like caching, retry, deduplication, and more.
 */

import { HttpTransportClient } from '../client.js';
import { HttpCacheManager, type CacheOptions } from './cache-manager.js';
import { RetryManager, type RetryOptions } from './retry-manager.js';
import type { HttpRequestContext, HttpRequestHints, HttpRequestMessage } from '../types.js';
import { Errors } from '../../../../errors/index.js';

/**
 * Query options for configuring request behavior
 */
export interface QueryOptions {
  /** Caching configuration */
  cache?: CacheOptions;
  /** Retry configuration */
  retry?: RetryOptions;
  /** Tags for cache invalidation */
  invalidateTags?: string[];
  /** Optimistic update function */
  optimisticUpdate?: (cache: any) => any;
  /** Deduplication key */
  dedupeKey?: string;
  /** Background refetch interval in milliseconds */
  backgroundRefetch?: number;
  /** Custom middleware function */
  customMiddleware?: (req: HttpRequestMessage) => HttpRequestMessage | Promise<HttpRequestMessage>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Request priority */
  priority?: 'high' | 'normal' | 'low';
  /** Transform response data */
  transform?: (data: any) => any;
  /** Validate response data */
  validate?: (data: any) => boolean | Promise<boolean>;
  /** Fallback data on error */
  fallback?: any;
  /** Metrics callback */
  metrics?: (timing: { duration: number; cacheHit?: boolean }) => void;
}

/**
 * Query builder for chainable API
 */
export class QueryBuilder<TService = any, TMethod extends keyof TService = keyof TService> {
  private options: QueryOptions = {};
  private methodName?: TMethod;
  private methodInput?: any;
  private abortController: AbortController;

  // Shared deduplication map across all QueryBuilder instances
  private static inFlightRequests = new Map<string, Promise<any>>();

  // Background refetch intervals
  private static backgroundIntervals = new Map<string, NodeJS.Timeout>();

  constructor(
    private transport: HttpTransportClient,
    private serviceName: string,
    private cacheManager?: HttpCacheManager,
    private retryManager?: RetryManager
  ) {
    // Create abort controller immediately so cancel() can be called before execute()
    this.abortController = new AbortController();
  }

  /**
   * Set the method to call
   */
  method(name: TMethod): this {
    this.methodName = name;
    return this;
  }

  /**
   * Set the input for the method
   */
  input(data: any): this {
    this.methodInput = data;
    return this;
  }

  /**
   * Configure caching
   */
  cache(options: CacheOptions | number): this {
    if (typeof options === 'number') {
      this.options.cache = { maxAge: options };
    } else {
      this.options.cache = options;
    }
    return this;
  }

  /**
   * Configure retry behavior
   */
  retry(options: RetryOptions | number): this {
    if (typeof options === 'number') {
      this.options.retry = { attempts: options };
    } else {
      this.options.retry = options;
    }
    return this;
  }

  /**
   * Set cache invalidation tags
   */
  invalidateOn(tags: string[]): this {
    this.options.invalidateTags = tags;
    return this;
  }

  /**
   * Configure optimistic updates
   */
  optimistic<T>(updater: (current: T | undefined) => T): this {
    this.options.optimisticUpdate = updater;
    return this;
  }

  /**
   * Set deduplication key
   */
  dedupe(key: string): this {
    this.options.dedupeKey = key;
    return this;
  }

  /**
   * Configure background refetch
   */
  background(interval: number): this {
    this.options.backgroundRefetch = interval;
    return this;
  }

  /**
   * Set request timeout
   */
  timeout(ms: number): this {
    this.options.timeout = ms;
    return this;
  }

  /**
   * Set request priority
   */
  priority(level: 'high' | 'normal' | 'low'): this {
    this.options.priority = level;
    return this;
  }

  /**
   * Transform response data
   */
  transform<T>(fn: (data: any) => T): this {
    this.options.transform = fn;
    return this;
  }

  /**
   * Validate response data
   */
  validate(fn: (data: any) => boolean | Promise<boolean>): this {
    this.options.validate = fn;
    return this;
  }

  /**
   * Set fallback data
   */
  fallback(data: any): this {
    this.options.fallback = data;
    return this;
  }

  /**
   * Track metrics
   */
  metrics(fn: (timing: { duration: number; cacheHit?: boolean }) => void): this {
    this.options.metrics = fn;
    return this;
  }

  /**
   * Cancel the query if it's in progress
   */
  cancel(): void {
    this.abortController.abort();
  }

  /**
   * Execute the query
   */
  async execute(): Promise<any> {
    if (!this.methodName) {
      throw Errors.badRequest('Method name not specified');
    }

    // Check for deduplication
    const dedupeKey = this.options.dedupeKey || (this.options.cache ? this.getCacheKey() : undefined);

    if (dedupeKey) {
      const inFlight = QueryBuilder.inFlightRequests.get(dedupeKey);
      if (inFlight) {
        // Request already in flight, return the existing promise
        return inFlight;
      }
    }

    // Create the promise and store it for deduplication
    const promise = this.executeInternal();

    if (dedupeKey) {
      QueryBuilder.inFlightRequests.set(dedupeKey, promise);
    }

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up
      if (dedupeKey) {
        QueryBuilder.inFlightRequests.delete(dedupeKey);
      }
    }
  }

  /**
   * Internal execution logic
   */
  private async executeInternal(): Promise<any> {
    const startTime = performance.now();
    let cacheHit = false;
    let result: any;

    try {
      // Check if already aborted before starting
      if (this.abortController.signal.aborted) {
        throw Errors.internal('Query cancelled');
      }

      // Handle optimistic updates separately
      if (this.options.optimisticUpdate && this.cacheManager && this.options.cache) {
        const cacheKey = this.getCacheKey();
        const current = this.cacheManager.getRaw(cacheKey);
        const optimistic = this.options.optimisticUpdate(current);

        // Apply optimistic update immediately
        this.cacheManager.set(cacheKey, optimistic, {
          ...this.options.cache,
          tags: [...(this.options.cache.tags || []), '__optimistic__'],
        });

        // Execute the actual request in background
        try {
          const fetcher =
            this.options.retry && this.retryManager
              ? () => this.retryManager!.execute(() => this.executeRequest(), this.options.retry!)
              : () => this.executeRequest();

          result = await fetcher();

          // Replace optimistic value with real result
          this.cacheManager.set(cacheKey, result, this.options.cache);
        } catch (error) {
          // Rollback optimistic update on error
          this.cacheManager.invalidate(cacheKey);
          throw error;
        }
      } else {
        // Check abort again before making request
        if (this.abortController.signal.aborted) {
          throw Errors.internal('Query cancelled');
        }

        // Check if we should use cache
        if (this.options.cache && this.cacheManager) {
          const cacheKey = this.getCacheKey();

          // Create fetcher with retry support if both cache and retry are specified
          const fetcher =
            this.options.retry && this.retryManager
              ? () => this.retryManager!.execute(() => this.executeRequest(), this.options.retry!)
              : () => this.executeRequest();

          result = await this.cacheManager.get(cacheKey, fetcher, this.options.cache);

          cacheHit = this.cacheManager.isCacheHit(cacheKey);

          // Check if cancelled after cache operation
          if (this.abortController.signal.aborted) {
            throw Errors.internal('Query cancelled');
          }
        } else if (this.options.retry && this.retryManager) {
          // Use retry manager
          result = await this.retryManager.execute(() => this.executeRequest(), this.options.retry);

          // Check if cancelled after retry
          if (this.abortController.signal.aborted) {
            throw Errors.internal('Query cancelled');
          }
        } else {
          // Direct execution
          result = await this.executeRequest();

          // Check if cancelled after request
          if (this.abortController.signal.aborted) {
            throw Errors.internal('Query cancelled');
          }
        }
      }

      // Check abort before post-processing
      if (this.abortController.signal.aborted) {
        throw Errors.internal('Query cancelled');
      }

      // Apply transform if specified
      if (this.options.transform) {
        result = this.options.transform(result);
      }

      // Validate if specified
      if (this.options.validate) {
        const isValid = await this.options.validate(result);
        if (!isValid) {
          throw Errors.badRequest('Response validation failed', { validator: this.options.validate });
        }
      }

      // Track metrics
      if (this.options.metrics) {
        const duration = performance.now() - startTime;
        this.options.metrics({ duration, cacheHit });
      }

      // Setup background refetch if configured
      if (this.options.backgroundRefetch && this.options.cache && this.cacheManager) {
        this.setupBackgroundRefetch();
      }

      return result;
    } catch (error) {
      // Handle abort error
      if ((error as Error).name === 'AbortError' || (error as Error).message === 'Query cancelled') {
        throw Errors.internal('Query cancelled');
      }

      // Use fallback if available
      if (this.options.fallback !== undefined) {
        return this.options.fallback;
      }
      throw error;
    }
  }

  /**
   * Execute the actual request
   */
  private async executeRequest(): Promise<any> {
    const context: HttpRequestContext = {};
    const hints: HttpRequestHints = {};

    // Add cache hints
    if (this.options.cache) {
      hints.cache = {
        maxAge: this.options.cache.maxAge,
        staleWhileRevalidate: this.options.cache.staleWhileRevalidate,
        tags: this.options.cache.tags,
      };
    }

    // Add retry hints
    if (this.options.retry) {
      hints.retry = {
        attempts: this.options.retry.attempts,
        backoff: this.options.retry.backoff,
        maxDelay: this.options.retry.maxDelay,
        initialDelay: this.options.retry.initialDelay,
      };
    }

    // Add priority and timeout
    if (this.options.priority) {
      hints.priority = this.options.priority;
    }
    if (this.options.timeout) {
      hints.timeout = this.options.timeout;
    }

    return this.transport.invoke(this.serviceName, this.methodName as string, [this.methodInput], { context, hints });
  }

  /**
   * Generate cache key
   */
  private getCacheKey(): string {
    if (this.options.dedupeKey) {
      return this.options.dedupeKey;
    }

    return `${this.serviceName}.${String(this.methodName)}:${JSON.stringify(this.methodInput)}`;
  }

  /**
   * Setup background refetch interval
   */
  private setupBackgroundRefetch(): void {
    if (!this.options.backgroundRefetch || !this.cacheManager) {
      return;
    }

    const cacheKey = this.getCacheKey();

    // Clear existing interval if any
    this.stopBackgroundRefetch(cacheKey);

    // Start new interval
    const interval = setInterval(async () => {
      try {
        // Silently refetch and update cache
        const result = await this.executeRequest();

        // Apply transform if specified
        let transformedResult = result;
        if (this.options.transform) {
          transformedResult = this.options.transform(result);
        }

        // Update cache with fresh data
        if (this.options.cache && this.cacheManager) {
          this.cacheManager.set(cacheKey, transformedResult, this.options.cache);
        }
      } catch (error) {
        // Silent failure - don't throw errors during background refetch
        // Optionally could log or emit event
      }
    }, this.options.backgroundRefetch);

    // Store interval for cleanup
    QueryBuilder.backgroundIntervals.set(cacheKey, interval);
  }

  /**
   * Stop background refetch for a specific cache key
   */
  private stopBackgroundRefetch(cacheKey: string): void {
    const interval = QueryBuilder.backgroundIntervals.get(cacheKey);
    if (interval) {
      clearInterval(interval);
      QueryBuilder.backgroundIntervals.delete(cacheKey);
    }
  }

  /**
   * Stop all background refetch intervals
   * Useful for cleanup when shutting down
   */
  static stopAllBackgroundRefetch(): void {
    for (const interval of QueryBuilder.backgroundIntervals.values()) {
      clearInterval(interval);
    }
    QueryBuilder.backgroundIntervals.clear();
  }

  /**
   * Get active background refetch count (for debugging/testing)
   */
  static getActiveBackgroundRefetchCount(): number {
    return QueryBuilder.backgroundIntervals.size;
  }
}
