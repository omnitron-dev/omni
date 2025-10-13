/**
 * @fileoverview NetronClient - Central orchestrator for netron operations
 * @module @omnitron-dev/aether/netron
 */

import { Injectable } from '../di/index.js';
import {
  HttpRemotePeer,
  HttpCacheManager,
  RetryManager,
} from '@omnitron-dev/netron-browser';
import type {
  BackendConfig,
  BackendOptions,
  QueryOptions,
  MutationOptions,
} from './types.js';

/**
 * NetronClient - Central orchestrator for all netron operations
 * Manages multiple backends and provides unified API
 */
@Injectable({ scope: 'singleton' })
export class NetronClient {
  private backends: Map<string, HttpRemotePeer>;
  private cacheManager: HttpCacheManager;
  private retryManager: RetryManager;
  private defaultBackend: string;
  private config?: BackendConfig;

  constructor(
    config?: BackendConfig,
    cacheManager?: HttpCacheManager,
    retryManager?: RetryManager,
    registry?: Map<string, HttpRemotePeer>,
    defaultBackend?: string
  ) {
    this.config = config;

    // Use provided registry or create new
    this.backends = registry || new Map();

    // Use provided or create default cache manager
    this.cacheManager = cacheManager || new HttpCacheManager({
      maxEntries: config?.cache?.maxEntries || 1000,
      maxSizeBytes: config?.cache?.maxSizeBytes || 10_000_000,
      defaultMaxAge: config?.cache?.defaultMaxAge || 60000,
      debug: config?.cache?.debug || false,
    });

    // Use provided or create default retry manager
    this.retryManager = retryManager || new RetryManager({
      defaultOptions: {
        attempts: config?.retry?.attempts || 3,
        backoff: config?.retry?.backoff || 'exponential',
        initialDelay: config?.retry?.initialDelay || 1000,
        maxDelay: config?.retry?.maxDelay || 30000,
        jitter: config?.retry?.jitter || 0.1,
      },
      circuitBreaker: config?.retry?.circuitBreaker,
      debug: false,
    });

    // Set default backend
    this.defaultBackend = defaultBackend || config?.default || 'main';

    // Initialize backends
    this.initializeBackends();
  }

  /**
   * Initialize backends from configuration
   */
  private initializeBackends(): void {
    if (!this.config) return;

    // Handle simple single backend configuration
    if (this.config.baseUrl) {
      this.createBackend('main', {
        url: this.config.baseUrl,
        cache: this.config.cache,
        retry: this.config.retry,
        headers: this.config.headers,
        timeout: this.config.timeout,
      });
      return;
    }

    // Handle multiple backends configuration
    if (this.config.backends) {
      for (const [name, config] of Object.entries(this.config.backends)) {
        if (typeof config === 'string') {
          // Simple URL string
          this.createBackend(name, { url: config });
        } else {
          // Full configuration object
          this.createBackend(name, config);
        }
      }
    }
  }

  /**
   * Create and configure a backend peer
   */
  private createBackend(name: string, options: BackendOptions): void {
    const peer = new HttpRemotePeer(options.url);

    // Configure cache manager
    peer.setCacheManager(this.cacheManager);

    // Configure retry manager
    peer.setRetryManager(this.retryManager);

    // Set global options if provided
    if (options.cache || options.retry) {
      peer.setGlobalOptions({
        cache: options.cache as any,
        retry: options.retry as any,
      });
    }

    // Store peer
    this.backends.set(name, peer);
  }

  /**
   * Get or create peer for backend
   *
   * @param name - Backend name (optional, uses default if not provided)
   * @returns HttpRemotePeer instance
   */
  backend(name?: string): HttpRemotePeer {
    const backendName = name || this.defaultBackend;

    let peer = this.backends.get(backendName);
    if (!peer) {
      // Create on-demand if not exists
      if (this.config?.backends && backendName in this.config.backends) {
        const config = this.config.backends[backendName];
        if (typeof config === 'string') {
          this.createBackend(backendName, { url: config });
        } else if (config) {
          this.createBackend(backendName, config);
        }
        peer = this.backends.get(backendName)!;
      } else {
        throw new Error(`Backend '${backendName}' not configured`);
      }
    }

    return peer;
  }

  /**
   * Query a service method (returns Promise)
   *
   * @param service - Service name
   * @param method - Method name
   * @param args - Method arguments
   * @param options - Query options
   * @param backendName - Backend name (optional)
   * @returns Promise with result
   */
  async query<T = any>(
    service: string,
    method: string,
    args: any[],
    options?: QueryOptions,
    backendName?: string
  ): Promise<T> {
    const peer = this.backend(backendName);
    const serviceInterface = await peer.queryFluentInterface<any>(service);

    // Build fluent query
    let query = serviceInterface as any;

    if (options?.cache) {
      query = query.cache(options.cache);
    }

    if (options?.retry) {
      query = query.retry(options.retry);
    }

    if (options?.timeout) {
      query = query.timeout(options.timeout);
    }

    if (options?.priority) {
      query = query.priority(options.priority);
    }

    if (options?.transform) {
      query = query.transform(options.transform);
    }

    if (options?.validate) {
      query = query.validate(options.validate);
    }

    if (options?.fallback !== undefined) {
      query = query.fallback(options.fallback);
    }

    if (options?.metrics) {
      query = query.metrics(options.metrics);
    }

    // Call method with args
    return await query[method](...args);
  }

  /**
   * Mutate via service method (returns Promise)
   *
   * @param service - Service name
   * @param method - Method name
   * @param args - Method arguments
   * @param options - Mutation options
   * @param backendName - Backend name (optional)
   * @returns Promise with result
   */
  async mutate<T = any>(
    service: string,
    method: string,
    args: any[],
    options?: MutationOptions,
    backendName?: string
  ): Promise<T> {
    const peer = this.backend(backendName);
    const serviceInterface = await peer.queryFluentInterface<any>(service);

    // Build fluent mutation
    let mutation = serviceInterface as any;

    if (options?.optimistic) {
      mutation = mutation.optimistic(options.optimistic);
    }

    if (options?.invalidate) {
      mutation = mutation.invalidateOn(options.invalidate);
    }

    if (options?.retry) {
      mutation = mutation.retry(options.retry);
    }

    // Call method with args
    const result = await mutation[method](...args);

    // Call callbacks
    if (options?.onSuccess) {
      await options.onSuccess(result);
    }

    return result;
  }

  /**
   * Invalidate cache by pattern
   *
   * @param pattern - Cache key pattern (string, RegExp, or array of tags)
   * @param backendName - Backend name (optional, invalidates all if not provided)
   */
  invalidate(pattern: string | RegExp | string[], backendName?: string): void {
    if (backendName) {
      // Invalidate specific backend
      const peer = this.backend(backendName);
      peer.invalidateCache(pattern as any, 'http');
    } else {
      // Invalidate all backends
      for (const peer of this.backends.values()) {
        peer.invalidateCache(pattern as any, 'http');
      }
    }
  }

  /**
   * Get cache statistics
   *
   * @returns Cache statistics
   */
  getCacheStats() {
    return this.cacheManager.getStats();
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cacheManager.clear();
  }

  /**
   * Get all configured backend names
   *
   * @returns Array of backend names
   */
  getBackends(): string[] {
    return Array.from(this.backends.keys());
  }

  /**
   * Check if a backend is configured
   *
   * @param name - Backend name
   * @returns True if backend exists
   */
  hasBackend(name: string): boolean {
    return this.backends.has(name);
  }

  /**
   * Get or set default backend
   *
   * @param name - Backend name (optional)
   * @returns Current default backend
   */
  getDefaultBackend(name?: string): string {
    if (name) {
      this.defaultBackend = name;
    }
    return this.defaultBackend;
  }
}