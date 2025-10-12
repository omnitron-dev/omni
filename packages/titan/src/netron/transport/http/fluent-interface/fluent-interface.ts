/**
 * Fluent Interface for Netron HTTP Transport
 *
 * Provides natural, Netron-style method calls with chainable configuration.
 * Example: await service.cache(60000).retry(3).getUser('user-123')
 */

import { HttpTransportClient } from '../client.js';
import { HttpCacheManager, type CacheOptions } from './cache-manager.js';
import { RetryManager, type RetryOptions } from './retry-manager.js';
import { QueryBuilder, type QueryOptions } from './query-builder.js';
import { ConfigurableProxy } from './configurable-proxy.js';

/**
 * Enhanced fluent interface for natural Netron-style method calls
 *
 * @template TService - Service interface type
 */
export class FluentInterface<TService = any> {
  /**
   * Definition metadata (for compatibility with Interface)
   * Always undefined for HTTP transport
   * @internal
   */
  public $def?: undefined;

  /**
   * Peer reference (for compatibility with Interface)
   * @internal
   */
  public $peer?: any;

  constructor(
    private transport: HttpTransportClient,
    private serviceName: string,
    private cacheManager?: HttpCacheManager,
    private retryManager?: RetryManager,
    private globalOptions: QueryOptions = {}
  ) {
    // Set compatibility properties (for HTTP, $def is undefined since we don't fetch definitions)
    this.$def = undefined;
  }

  /**
   * Set global cache configuration that applies to all method calls
   * @returns this for method chaining
   */
  globalCache(options: CacheOptions): this {
    if (!this.globalOptions) {
      this.globalOptions = {};
    }
    this.globalOptions.cache = options;
    return this;
  }

  /**
   * Set global retry configuration that applies to all method calls
   * @returns this for method chaining
   */
  globalRetry(options: RetryOptions): this {
    if (!this.globalOptions) {
      this.globalOptions = {};
    }
    this.globalOptions.retry = options;
    return this;
  }

  /**
   * Configure caching for the next method call
   * @returns ConfigurableProxy with cache settings
   */
  cache(options: CacheOptions | number): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions };
    mergedOptions.cache = this.normalizeCacheOptions(options);
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Configure retry behavior for the next method call
   * @returns ConfigurableProxy with retry settings
   */
  retry(options: RetryOptions | number): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions };
    mergedOptions.retry = this.normalizeRetryOptions(options);
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Set deduplication key for the next method call
   * @returns ConfigurableProxy with dedupe settings
   */
  dedupe(key: string): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, dedupeKey: key };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Configure request timeout
   * @returns ConfigurableProxy with timeout settings
   */
  timeout(ms: number): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, timeout: ms };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Set request priority
   * @returns ConfigurableProxy with priority settings
   */
  priority(level: 'high' | 'normal' | 'low'): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, priority: level };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Transform response data
   * @returns ConfigurableProxy with transform function
   */
  transform<TOut>(fn: (data: any) => TOut): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, transform: fn };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Validate response data
   * @returns ConfigurableProxy with validation function
   */
  validate(fn: (data: any) => boolean | Promise<boolean>): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, validate: fn };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Provide fallback data on error
   * @returns ConfigurableProxy with fallback data
   */
  fallback<T>(data: T): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, fallback: data };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Configure optimistic updates
   * @returns ConfigurableProxy with optimistic updater
   */
  optimistic<T>(updater: (current: T | undefined) => T): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, optimisticUpdate: updater };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Set cache invalidation tags
   * @returns ConfigurableProxy with invalidation tags
   */
  invalidateOn(tags: string[]): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, invalidateTags: tags };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Configure background refetch
   * @returns ConfigurableProxy with background refetch interval
   */
  background(interval: number): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, backgroundRefetch: interval };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Set metrics callback
   * @returns ConfigurableProxy with metrics function
   */
  metrics(fn: (timing: { duration: number; cacheHit?: boolean }) => void): ConfigurableProxy<TService> {
    const mergedOptions = { ...this.globalOptions, metrics: fn };
    return new ConfigurableProxy<TService>(
      this.transport,
      this.serviceName,
      this.cacheManager,
      this.retryManager,
      mergedOptions
    );
  }

  /**
   * Direct service proxy (no configuration)
   * For simple calls: await service.api.getUser(id)
   */
  get api(): TService {
    return this.createDirectProxy();
  }

  /**
   * Create a direct proxy that immediately executes method calls
   */
  private createDirectProxy(): TService {
    const self = this;
    return new Proxy({} as any, {
      get: (target: any, methodName: string | symbol) => {
        if (typeof methodName === 'symbol') return undefined;
        return (...args: any[]) => {
          // Create QueryBuilder directly instead of using deprecated call() method
          const builder = new QueryBuilder<TService, keyof TService>(
            self.transport,
            self.serviceName,
            self.cacheManager,
            self.retryManager
          );

          builder.method(methodName as keyof TService);
          const input = args.length === 1 ? args[0] : args;
          if (input !== undefined) {
            builder.input(input);
          }

          // Apply global options
          if (self.globalOptions) {
            self.applyGlobalOptions(builder, self.globalOptions);
          }

          return builder.execute();
        };
      },
    }) as TService;
  }

  /**
   * Cache invalidation API
   */
  invalidate(pattern: string | RegExp | Array<string | RegExp>): void {
    if (!this.cacheManager) return;

    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    for (const p of patterns) {
      this.cacheManager.invalidate(p);
    }
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cacheManager?.clear();
  }

  // Helper methods

  private normalizeCacheOptions(options: CacheOptions | number): CacheOptions {
    return typeof options === 'number' ? { maxAge: options } : options;
  }

  private normalizeRetryOptions(options: RetryOptions | number): RetryOptions {
    return typeof options === 'number' ? { attempts: options } : options;
  }

  private applyGlobalOptions(builder: QueryBuilder<any, any>, options: QueryOptions): void {
    if (options.cache) builder.cache(options.cache);
    if (options.retry) builder.retry(options.retry);
    if (options.timeout) builder.timeout(options.timeout);
    if (options.priority) builder.priority(options.priority);
    if (options.transform) builder.transform(options.transform);
    if (options.validate) builder.validate(options.validate);
    if (options.fallback !== undefined) builder.fallback(options.fallback);
    if (options.optimisticUpdate) builder.optimistic(options.optimisticUpdate);
    if (options.invalidateTags) builder.invalidateOn(options.invalidateTags);
    if (options.backgroundRefetch) builder.background(options.backgroundRefetch);
    if (options.metrics) builder.metrics(options.metrics);
    if (options.dedupeKey) builder.dedupe(options.dedupeKey);
  }
}
