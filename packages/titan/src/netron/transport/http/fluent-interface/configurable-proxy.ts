/**
 * Configurable Proxy for Fluent Interface
 *
 * Accumulates configuration options and intercepts method calls to execute
 * with all accumulated settings. Uses JavaScript Proxy for method interception.
 */

import type { Definition } from '../../../definition.js';
import { HttpTransportClient } from '../client.js';
import { HttpCacheManager, type CacheOptions } from './cache-manager.js';
import { RetryManager, type RetryOptions } from './retry-manager.js';
import { QueryBuilder, type QueryOptions } from './query-builder.js';

/**
 * Configurable proxy that accumulates options and creates a callable service proxy
 *
 * @template TService - Service interface type
 */
export class ConfigurableProxy<TService = any> {
  private accumulatedOptions: QueryOptions = {};
  private proxy: any; // Store the proxy for returning from methods

  constructor(
    private transport: HttpTransportClient,
    private definition: Definition,
    private cacheManager?: HttpCacheManager,
    private retryManager?: RetryManager,
    initialOptions?: QueryOptions
  ) {
    if (initialOptions) {
      this.accumulatedOptions = { ...initialOptions };
    }

    // Create and store the Proxy
    this.proxy = new Proxy(this, {
      get: (target, prop: string | symbol) => {
        // If prop is a symbol or a configuration method, return it
        if (typeof prop === 'symbol' || prop in target) {
          const value = (target as any)[prop];
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
        }

        // Otherwise, treat it as a service method call
        return (...args: any[]) => {
          // Create QueryBuilder with accumulated options
          const builder = new QueryBuilder<TService>(
            target.transport,
            target.definition,
            target.cacheManager,
            target.retryManager
          );

          // Apply all accumulated options
          target.applyOptions(builder, target.accumulatedOptions);

          // Set method and input
          builder.method(prop as keyof TService);
          if (args.length > 0) {
            builder.input(args.length === 1 ? args[0] : args);
          }

          // Execute and return promise
          return builder.execute();
        };
      }
    });

    // Return the proxy
    return this.proxy as any;
  }

  /**
   * Chain cache configuration
   */
  cache(options: CacheOptions | number): ConfigurableProxy<TService> {
    this.accumulatedOptions.cache = typeof options === 'number'
      ? { maxAge: options }
      : options;
    return this.proxy;
  }

  /**
   * Chain retry configuration
   */
  retry(options: RetryOptions | number): ConfigurableProxy<TService> {
    this.accumulatedOptions.retry = typeof options === 'number'
      ? { attempts: options }
      : options;
    return this.proxy;
  }

  /**
   * Chain deduplication key
   */
  dedupe(key: string): ConfigurableProxy<TService> {
    this.accumulatedOptions.dedupeKey = key;
    return this.proxy;
  }

  /**
   * Chain timeout
   */
  timeout(ms: number): ConfigurableProxy<TService> {
    this.accumulatedOptions.timeout = ms;
    return this.proxy;
  }

  /**
   * Chain priority
   */
  priority(level: 'high' | 'normal' | 'low'): ConfigurableProxy<TService> {
    this.accumulatedOptions.priority = level;
    return this.proxy;
  }

  /**
   * Chain transform
   */
  transform<TOut>(fn: (data: any) => TOut): ConfigurableProxy<TService> {
    this.accumulatedOptions.transform = fn;
    return this.proxy;
  }

  /**
   * Chain validate
   */
  validate(fn: (data: any) => boolean | Promise<boolean>): ConfigurableProxy<TService> {
    this.accumulatedOptions.validate = fn;
    return this.proxy;
  }

  /**
   * Chain fallback
   */
  fallback<T>(data: T): ConfigurableProxy<TService> {
    this.accumulatedOptions.fallback = data;
    return this.proxy;
  }

  /**
   * Chain optimistic updates
   */
  optimistic<T>(updater: (current: T | undefined) => T): ConfigurableProxy<TService> {
    this.accumulatedOptions.optimisticUpdate = updater;
    return this.proxy;
  }

  /**
   * Chain cache invalidation tags
   */
  invalidateOn(tags: string[]): ConfigurableProxy<TService> {
    this.accumulatedOptions.invalidateTags = tags;
    return this.proxy;
  }

  /**
   * Chain background refetch
   */
  background(interval: number): ConfigurableProxy<TService> {
    this.accumulatedOptions.backgroundRefetch = interval;
    return this.proxy;
  }

  /**
   * Chain metrics
   */
  metrics(fn: (timing: { duration: number; cacheHit?: boolean }) => void): ConfigurableProxy<TService> {
    this.accumulatedOptions.metrics = fn;
    return this.proxy;
  }

  /**
   * Apply accumulated options to a QueryBuilder
   */
  private applyOptions(builder: QueryBuilder<any>, options: QueryOptions): void {
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
