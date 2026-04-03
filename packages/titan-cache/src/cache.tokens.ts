/**
 * Cache Module Tokens
 *
 * DI tokens for the cache module
 *
 * @module titan/modules/cache
 */

import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type { ICacheService, ICache, ICacheModuleOptions } from './cache.types.js';

/**
 * Token for the cache service
 */
export const CACHE_SERVICE_TOKEN: Token<ICacheService> = createToken<ICacheService>('CacheService');

/**
 * Token for the default cache instance
 */
export const CACHE_DEFAULT_TOKEN: Token<ICache> = createToken<ICache>('Cache:Default');

/**
 * Token for cache module options
 */
export const CACHE_OPTIONS_TOKEN: Token<ICacheModuleOptions> = createToken<ICacheModuleOptions>('CacheOptions');

/**
 * Get a cache token by name
 */
export function getCacheToken(name: string): Token<ICache> {
  return createToken<ICache>(`Cache:${name}`);
}

/**
 * Token for the cache adapter
 */
export const CACHE_ADAPTER_TOKEN: Token<import('./cache.adapter.js').CacheAdapter> = createToken<import('./cache.adapter.js').CacheAdapter>('CacheAdapter');

/**
 * Token for cache adapter options
 */
export const CACHE_ADAPTER_OPTIONS_TOKEN: Token<import('./cache.adapter.js').ICacheAdapterOptions> =
  createToken<import('./cache.adapter.js').ICacheAdapterOptions>('CacheAdapterOptions');

/**
 * Default cache name
 */
export const DEFAULT_CACHE_NAME = 'default';
