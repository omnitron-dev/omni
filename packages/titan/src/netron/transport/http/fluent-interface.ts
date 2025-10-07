/**
 * Fluent Interface for Netron HTTP Transport
 *
 * Provides natural, Netron-style method calls with chainable configuration.
 * Example: await service.cache(60000).retry(3).getUser('user-123')
 */

import type { Definition } from '../../definition.js';
import { HttpTransportClient } from './client.js';
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
  constructor(
    private transport: HttpTransportClient,
    private definition: Definition,
    private cacheManager?: HttpCacheManager,
    private retryManager?: RetryManager,
    private globalOptions?: QueryOptions
  ) {}

  /**
   * Configure caching for the next method call
   * @returns ConfigurableProxy with cache settings
   */
  cache(options: CacheOptions | number): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { cache: this.normalizeCacheOptions(options) }
    );
  }

  /**
   * Configure retry behavior for the next method call
   * @returns ConfigurableProxy with retry settings
   */
  retry(options: RetryOptions | number): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { retry: this.normalizeRetryOptions(options) }
    );
  }

  /**
   * Set deduplication key for the next method call
   * @returns ConfigurableProxy with dedupe settings
   */
  dedupe(key: string): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { dedupeKey: key }
    );
  }

  /**
   * Configure request timeout
   * @returns ConfigurableProxy with timeout settings
   */
  timeout(ms: number): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { timeout: ms }
    );
  }

  /**
   * Set request priority
   * @returns ConfigurableProxy with priority settings
   */
  priority(level: 'high' | 'normal' | 'low'): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { priority: level }
    );
  }

  /**
   * Transform response data
   * @returns ConfigurableProxy with transform function
   */
  transform<TOut>(fn: (data: any) => TOut): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { transform: fn }
    );
  }

  /**
   * Validate response data
   * @returns ConfigurableProxy with validation function
   */
  validate(fn: (data: any) => boolean | Promise<boolean>): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { validate: fn }
    );
  }

  /**
   * Provide fallback data on error
   * @returns ConfigurableProxy with fallback data
   */
  fallback<T>(data: T): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { fallback: data }
    );
  }

  /**
   * Configure optimistic updates
   * @returns ConfigurableProxy with optimistic updater
   */
  optimistic<T>(updater: (current: T | undefined) => T): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { optimisticUpdate: updater }
    );
  }

  /**
   * Set cache invalidation tags
   * @returns ConfigurableProxy with invalidation tags
   */
  invalidateOn(tags: string[]): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { invalidateTags: tags }
    );
  }

  /**
   * Configure background refetch
   * @returns ConfigurableProxy with background refetch interval
   */
  background(interval: number): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { backgroundRefetch: interval }
    );
  }

  /**
   * Set metrics callback
   * @returns ConfigurableProxy with metrics function
   */
  metrics(fn: (timing: { duration: number; cacheHit?: boolean }) => void): ConfigurableProxy<TService> {
    return new ConfigurableProxy<TService>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager,
      { metrics: fn }
    );
  }

  // Backward compatibility methods

  /**
   * Original call-based API (backward compatible)
   * @deprecated Use fluent API instead: service.cache().retry().method(args)
   */
  call<M extends keyof TService>(method: M, input?: any): QueryBuilder<TService, M> {
    const builder = new QueryBuilder<TService, M>(
      this.transport,
      this.definition,
      this.cacheManager,
      this.retryManager
    );

    builder.method(method);
    if (input !== undefined) {
      builder.input(input);
    }

    // Apply global options
    if (this.globalOptions) {
      this.applyGlobalOptions(builder, this.globalOptions);
    }

    return builder;
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
          const builder = self.call(methodName as keyof TService, args.length === 1 ? args[0] : args);
          return builder.execute();
        };
      }
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
