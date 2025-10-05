/**
 * HTTP Interface with Fluent API
 *
 * Provides intelligent client features matching TanStack Query capabilities
 * with a fluent, chainable API for optimal developer experience.
 */

import type { Definition } from '../../definition.js';
import { HttpTransportClient } from './client.js';
import { HttpCacheManager, type CacheOptions } from './cache-manager.js';
import { RetryManager, type RetryOptions } from './retry-manager.js';
import type {
  HttpRequestContext,
  HttpRequestHints,
  HttpRequestMessage
} from './types.js';

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

  constructor(
    private transport: HttpTransportClient,
    private definition: Definition,
    private cacheManager?: HttpCacheManager,
    private retryManager?: RetryManager
  ) { }

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
   * Execute the query
   */
  async execute(): Promise<any> {
    if (!this.methodName) {
      throw new Error('Method name not specified');
    }

    const startTime = performance.now();
    let cacheHit = false;
    let result: any;

    try {
      // Check if we should use cache
      if (this.options.cache && this.cacheManager) {
        const cacheKey = this.getCacheKey();
        const fetcher = () => this.executeRequest();

        result = await this.cacheManager.get(
          cacheKey,
          fetcher,
          this.options.cache
        );

        cacheHit = this.cacheManager.isCacheHit(cacheKey);
      } else if (this.options.retry && this.retryManager) {
        // Use retry manager
        result = await this.retryManager.execute(
          () => this.executeRequest(),
          this.options.retry
        );
      } else {
        // Direct execution
        result = await this.executeRequest();
      }

      // Apply transform if specified
      if (this.options.transform) {
        result = this.options.transform(result);
      }

      // Validate if specified
      if (this.options.validate) {
        const isValid = await this.options.validate(result);
        if (!isValid) {
          throw new Error('Response validation failed');
        }
      }

      // Track metrics
      if (this.options.metrics) {
        const duration = performance.now() - startTime;
        this.options.metrics({ duration, cacheHit });
      }

      return result;
    } catch (error) {
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
        tags: this.options.cache.tags
      };
    }

    // Add retry hints
    if (this.options.retry) {
      hints.retry = {
        attempts: this.options.retry.attempts,
        backoff: this.options.retry.backoff,
        maxDelay: this.options.retry.maxDelay,
        initialDelay: this.options.retry.initialDelay
      };
    }

    // Add priority and timeout
    if (this.options.priority) {
      hints.priority = this.options.priority;
    }
    if (this.options.timeout) {
      hints.timeout = this.options.timeout;
    }

    return this.transport.invoke(
      this.definition.meta.name,
      this.methodName as string,
      [this.methodInput],
      { context, hints }
    );
  }

  /**
   * Generate cache key
   */
  private getCacheKey(): string {
    if (this.options.dedupeKey) {
      return this.options.dedupeKey;
    }

    return `${this.definition.meta.name}.${String(this.methodName)}:${JSON.stringify(this.methodInput)}`;
  }
}

/**
 * HTTP Interface with fluent API
 */
export class HttpInterface<T = any> {
  private service: T;
  private cacheManager?: HttpCacheManager;
  private retryManager?: RetryManager;
  private globalOptions: QueryOptions = {};

  constructor(
    private transport: HttpTransportClient,
    private definition: Definition,
    options?: {
      cache?: HttpCacheManager;
      retry?: RetryManager;
      globalOptions?: QueryOptions;
    }
  ) {
    this.cacheManager = options?.cache;
    this.retryManager = options?.retry;
    this.globalOptions = options?.globalOptions || {};
    this.service = this.createServiceProxy();
  }

  /**
   * Set global cache configuration
   */
  globalCache(options: CacheOptions): this {
    this.globalOptions.cache = options;
    return this;
  }

  /**
   * Set global retry configuration
   */
  globalRetry(options: RetryOptions): this {
    this.globalOptions.retry = options;
    return this;
  }

  /**
   * Configure caching for next call
   */
  cache(options: CacheOptions | number): QueryBuilder<T> {
    const builder = new QueryBuilder<T>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager
    );

    // Apply global options first
    if (this.globalOptions.cache) {
      builder.cache(this.globalOptions.cache);
    }

    // Apply specific options
    return builder.cache(options);
  }

  /**
   * Configure retry for next call
   */
  retry(options: RetryOptions | number): QueryBuilder<T> {
    const builder = new QueryBuilder<T>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager
    );

    // Apply global options first
    if (this.globalOptions.retry) {
      builder.retry(this.globalOptions.retry);
    }

    // Apply specific options
    return builder.retry(options);
  }

  /**
   * Create a query builder for a specific method
   */
  call<M extends keyof T>(method: M, input?: any): QueryBuilder<T, M> {
    const builder = new QueryBuilder<T, M>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager
    );

    // Apply global options
    if (this.globalOptions.cache) {
      builder.cache(this.globalOptions.cache);
    }
    if (this.globalOptions.retry) {
      builder.retry(this.globalOptions.retry);
    }

    return builder.method(method).input(input);
  }

  /**
   * Get the direct service proxy (uses defaults)
   */
  get api(): T {
    return this.service;
  }

  /**
   * Invalidate cache
   */
  invalidate(pattern: string | RegExp | string[]): void {
    if (this.cacheManager) {
      this.cacheManager.invalidate(pattern);
    }
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    if (this.cacheManager) {
      this.cacheManager.clear();
    }
  }

  /**
   * Create service proxy
   */
  private createServiceProxy(): T {
    const self = this;

    return new Proxy({}, {
      get(target: any, prop: string) {
        // Check for special properties
        if (prop === '$interface') {
          return self;
        }

        // Check if it's a method
        if (self.definition.meta.methods && self.definition.meta.methods[prop]) {
          return async (input: any) => {
            const builder = self.call(prop as keyof T, input);
            return builder.execute();
          };
        }

        // Check for async iteration
        if (typeof prop === 'symbol' && prop === Symbol.asyncIterator) {
          return undefined;
        }

        // Unknown property
        return undefined;
      }
    }) as T;
  }
}