/**
 * Data Loading Infrastructure
 *
 * Complete data loading system with caching, server functions, and optimistic updates.
 *
 * @packageDocumentation
 */

// Cache Manager
export {
  getCacheManager,
  createCacheManager,
  resetCacheManager,
  generateCacheKey,
  invalidateByPrefix,
  invalidateCache,
  getCacheStats,
} from './cache-manager.js';

// Server Functions
export {
  serverFunction,
  netronServerFunction,
  batchServerFunctions,
  optimisticServerFunction,
} from './server-function.js';

// Cached Resources
export {
  createCachedResource,
  createCachedResources,
  createAutoTrackedResource,
  preloadCachedResource,
} from './resource-cache.js';

// Optimistic Updates
export {
  optimisticUpdate,
  createOptimisticMutation,
  applyOptimisticUpdate,
  atomicOptimisticUpdate,
  createDebouncedOptimisticMutation,
  mergeOptimisticUpdate,
} from './optimistic.js';

// Loader Integration
export {
  withLoaderCache,
  createLoaderResource,
  prefetchLoader,
  invalidateLoaderCache,
  preloadLoaders,
  withSSR,
  withStreaming,
  enhanceLoader,
} from './loader-integration.js';

// Types
export type {
  CacheOptions,
  CacheEntry,
  CacheInvalidationPattern,
  CacheManager,
  CacheStats,
  ServerFunction,
  ServerFunctionOptions,
  WrappedServerFunction,
  CachedResource,
  CachedResourceOptions,
  OptimisticUpdateOptions,
  OptimisticUpdateResult,
  MutationFunction,
  RevalidationStrategy,
  LoaderIntegrationOptions,
} from './types.js';
