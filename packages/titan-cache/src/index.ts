/**
 * Cache Module Exports
 *
 * High-performance caching with LRU/LFU eviction, TTL management,
 * multi-tier support, and compression.
 *
 * @module titan/modules/cache
 */

export * from './cache.types.js';
export * from './cache.tokens.js';
export * from './cache.decorators.js';
export * from './cache.service.js';
export * from './cache.adapter.js';
export * from './cache.module.js';
export * from './cache.health.js';
export * from './cache.utils.js';

// Cache implementations
export * from './lru-cache.js';
export * from './lfu-cache.js';
export * from './multi-tier-cache.js';

// Wheel timer - re-export from utils for convenience
export { WheelTimer, HierarchicalWheelTimer, createCacheWheelTimer } from '@omnitron-dev/titan/utils';
export type { WheelTimerOptions, WheelTimerStats, CacheWheelTimerOptions } from '@omnitron-dev/titan/utils';
