/**
 * @fileoverview NetronModule - DI module for netron integration
 * @module @omnitron-dev/aether/netron
 */

import type { Provider } from '../di/types.js';
import { NetronClient } from './client.js';
import { HttpCacheManager, HttpRemotePeer, RetryManager } from '@omnitron-dev/netron-browser';
import {
  BACKEND_CONFIG,
  CACHE_MANAGER,
  RETRY_MANAGER,
  BACKEND_REGISTRY,
  DEFAULT_BACKEND,
} from './tokens.js';
import type { BackendConfig, CacheConfig, RetryConfig } from './types.js';

/**
 * Module with providers (simplified interface for forRoot/forFeature pattern)
 */
export interface ModuleConfig {
  providers?: Provider[];
  exports?: any[];
}

/**
 * NetronModule configuration options
 */
export interface NetronModuleConfig {
  backends?: BackendConfig['backends'];
  baseUrl?: string;
  default?: string;
  cache?: CacheConfig;
  retry?: RetryConfig;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * NetronModule - Provides netron integration for Aether
 *
 * @example
 * ```typescript
 * // Root module with single backend
 * const app = new Application({
 *   imports: [
 *     NetronModule.forRoot({
 *       baseUrl: 'http://localhost:3000',
 *       cache: { maxEntries: 1000, defaultMaxAge: 60000 },
 *     }),
 *   ],
 * });
 *
 * // Root module with multiple backends
 * const app = new Application({
 *   imports: [
 *     NetronModule.forRoot({
 *       backends: {
 *         main: 'http://localhost:3000',
 *         analytics: 'http://localhost:3001',
 *         auth: {
 *           url: 'http://localhost:3002',
 *           headers: { 'X-API-Key': 'secret' },
 *         },
 *       },
 *       default: 'main',
 *       cache: { maxEntries: 2000 },
 *     }),
 *   ],
 * });
 * ```
 */
export class NetronModule {
  /**
   * Create root module with singleton providers
   *
   * @param config - Module configuration
   * @returns Module definition
   */
  static forRoot(config?: NetronModuleConfig): ModuleConfig {
    // Create cache manager
    const cacheManager = new HttpCacheManager({
      maxEntries: config?.cache?.maxEntries || 1000,
      maxSizeBytes: config?.cache?.maxSizeBytes || 10_000_000,
      defaultMaxAge: config?.cache?.defaultMaxAge || 60000,
      debug: config?.cache?.debug || false,
    });

    // Create retry manager
    const retryManager = new RetryManager({
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

    // Create backend registry
    const backendRegistry = new Map<string, HttpRemotePeer>();

    // Initialize backends if configured
    if (config?.baseUrl) {
      // Single backend configuration
      const peer = new HttpRemotePeer(config.baseUrl);
      peer.setCacheManager(cacheManager);
      peer.setRetryManager(retryManager);
      backendRegistry.set('main', peer);
    } else if (config?.backends) {
      // Multiple backends configuration
      for (const [name, backendConfig] of Object.entries(config.backends)) {
        const url = typeof backendConfig === 'string' ? backendConfig : backendConfig.url;
        const peer = new HttpRemotePeer(url);
        peer.setCacheManager(cacheManager);
        peer.setRetryManager(retryManager);

        if (typeof backendConfig === 'object' && backendConfig.headers) {
          // Set headers if provided
          peer.setGlobalOptions({
            headers: backendConfig.headers as any,
            timeout: backendConfig.timeout,
          } as any);
        }

        backendRegistry.set(name, peer);
      }
    }

    // Build backend config
    const backendConfig: BackendConfig = {
      backends: config?.backends,
      baseUrl: config?.baseUrl,
      default: config?.default || 'main',
      cache: config?.cache,
      retry: config?.retry,
      headers: config?.headers,
      timeout: config?.timeout,
    };

    return {
      providers: [
        // Provide configuration
        {
          provide: BACKEND_CONFIG,
          useValue: backendConfig,
        },
        // Provide cache manager
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
        // Provide retry manager
        {
          provide: RETRY_MANAGER,
          useValue: retryManager,
        },
        // Provide backend registry
        {
          provide: BACKEND_REGISTRY,
          useValue: backendRegistry,
        },
        // Provide default backend name
        {
          provide: DEFAULT_BACKEND,
          useValue: config?.default || 'main',
        },
        // Provide NetronClient as singleton
        NetronClient,
      ],
      exports: [NetronClient],
    };
  }

  /**
   * Create feature module (no providers, just imports)
   *
   * @returns Module definition
   */
  static forFeature(): ModuleConfig {
    return {
      // Feature modules don't provide anything
      // They just import NetronClient from root
      providers: [],
      exports: [],
    };
  }

  /**
   * Create testing module with mock backends
   *
   * @param mockBackends - Mock backend implementations
   * @returns Module definition
   */
  static forTesting(mockBackends?: Record<string, HttpRemotePeer>): ModuleConfig {
    const cacheManager = new HttpCacheManager({
      maxEntries: 100,
      defaultMaxAge: 1000,
      debug: true,
    });

    const retryManager = new RetryManager({
      defaultOptions: {
        attempts: 1, // Don't retry in tests
        backoff: 'constant',
        initialDelay: 0,
      },
      debug: true,
    });

    const backendRegistry = new Map<string, HttpRemotePeer>();

    if (mockBackends) {
      for (const [name, peer] of Object.entries(mockBackends)) {
        peer.setCacheManager(cacheManager);
        peer.setRetryManager(retryManager);
        backendRegistry.set(name, peer);
      }
    }

    return {
      providers: [
        {
          provide: BACKEND_CONFIG,
          useValue: { default: 'main' },
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
        {
          provide: RETRY_MANAGER,
          useValue: retryManager,
        },
        {
          provide: BACKEND_REGISTRY,
          useValue: backendRegistry,
        },
        {
          provide: DEFAULT_BACKEND,
          useValue: 'main',
        },
        NetronClient,
      ],
      exports: [NetronClient],
    };
  }
}