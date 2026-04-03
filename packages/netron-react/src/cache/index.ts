/**
 * Cache module exports
 */

export { QueryCache, type QueryCacheConfig } from './query-cache.js';
export { MutationCache, type MutationEntry } from './mutation-cache.js';
export { SubscriptionManager } from './subscription-manager.js';

export {
  hashQueryKey,
  matchQueryKey,
  partialMatchKey,
  deepEqual,
  matchQueryFilters,
  createAbortSignal,
  scheduleMicrotask,
  batchUpdates,
  timeUtils,
  calculateRetryDelay,
  generateId,
} from './utils.js';
