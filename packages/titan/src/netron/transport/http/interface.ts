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
import { QueryBuilder, type QueryOptions } from './query-builder.js';

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