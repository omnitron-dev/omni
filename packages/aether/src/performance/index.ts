/**
 * Performance Optimization Module
 *
 * Exports all Phase 6 performance optimizations including:
 * - Subscription pool for signal optimization
 * - Enhanced batch manager with priority queues
 * - Lazy loader with intersection observer
 * - VNode memory pool
 * - Optimized diff algorithm
 * - Component recycling pool
 * - Request deduplication cache
 *
 * @module performance
 */

// Import global instances for internal use
import { globalSubscriptionPool } from '../core/reactivity/subscription-pool.js';
import { globalBatchManager } from '../core/reactivity/batch-manager.js';
import { globalLazyLoader } from '../core/component/lazy-loader.js';
import { globalVNodePool } from '../reconciler/vnode-pool.js';
import { globalDiffer } from '../reconciler/optimized-diff.js';
import { globalComponentPool } from '../core/component/component-pool.js';
import { globalRequestCache } from '../data/request-cache.js';

// Subscription Pool
export {
  SubscriptionPool,
  SubscriptionArray,
  globalSubscriptionPool,
  type Subscription,
  type SubscriptionPoolConfig,
} from '../core/reactivity/subscription-pool.js';

// Batch Manager
export {
  BatchManager,
  globalBatchManager,
  batchWithPriority,
  queueUpdate,
  BatchPriority,
  FlushStrategy,
  type BatchConfig,
} from '../core/reactivity/batch-manager.js';

// Lazy Loader
export {
  LazyLoader,
  globalLazyLoader,
  lazyWithOptions,
  preloadComponent,
  PreloadStrategy,
  ResourceHint,
  type ComponentLoader,
  type LazyLoaderOptions,
} from '../core/component/lazy-loader.js';

// VNode Pool
export { VNodePool, globalVNodePool, pooled as pooledVNode, type VNodePoolConfig } from '../reconciler/vnode-pool.js';

// Optimized Diff
export {
  OptimizedDiffer,
  globalDiffer,
  optimizedDiff,
  longestIncreasingSubsequence,
  calculateMoves,
} from '../reconciler/optimized-diff.js';

// Component Pool
export {
  ComponentPool,
  globalComponentPool,
  pooled as pooledComponent,
  recyclable,
  type ComponentPoolConfig,
  type PoolableComponent,
} from '../core/component/component-pool.js';

// Request Cache
export {
  RequestCache,
  globalRequestCache,
  cachedFetch,
  invalidateCache,
  clearCache,
  createCachedRequest,
  type RequestCacheConfig,
  type RequestOptions,
  type RequestFunction,
} from '../data/request-cache.js';

/**
 * Performance optimization utilities
 */
export const performance = {
  /**
   * Get all performance statistics
   */
  getStats() {
    return {
      subscriptionPool: globalSubscriptionPool.getStats(),
      batchManager: globalBatchManager.getStats(),
      lazyLoader: globalLazyLoader.getStats(),
      vnodePool: globalVNodePool.getStats(),
      differ: globalDiffer.getStats(),
      componentPool: globalComponentPool.getStats(),
      requestCache: globalRequestCache.getStats(),
    };
  },

  /**
   * Clear all performance caches
   */
  clearAll() {
    globalSubscriptionPool.clear();
    globalBatchManager.clear();
    globalLazyLoader.clear();
    globalVNodePool.clear();
    globalDiffer.clearCache();
    globalComponentPool.clear();
    globalRequestCache.clear();
  },

  /**
   * Get performance report
   */
  getReport() {
    const stats = this.getStats();

    return {
      summary: {
        totalReused: stats.subscriptionPool.reused + stats.vnodePool.reused + stats.componentPool.reused,
        totalCached: stats.requestCache.hits,
        totalOptimized: stats.batchManager.deduped + stats.differ.fastPaths + stats.requestCache.deduped,
      },
      details: stats,
      recommendations: this.generateRecommendations(stats),
    };
  },

  /**
   * Generate optimization recommendations
   */
  generateRecommendations(stats: any): string[] {
    const recommendations: string[] = [];

    // Subscription pool
    if (stats.subscriptionPool.reuseRate < 0.5) {
      recommendations.push(
        'Low subscription reuse rate. Consider increasing pool size or reducing subscription churn.'
      );
    }

    // VNode pool
    if (stats.vnodePool.reuseRate < 0.5) {
      recommendations.push('Low VNode reuse rate. Consider using keys for list items or increasing pool size.');
    }

    // Batch manager
    if (stats.batchManager.dedupRate < 0.3) {
      recommendations.push('Low deduplication rate. Consider wrapping more updates in batch() calls.');
    }

    // Request cache
    if (stats.requestCache.hitRate < 0.5) {
      recommendations.push('Low cache hit rate. Consider increasing TTL or cache size.');
    }

    // Differ
    if (stats.differ.fastPathRate < 0.3) {
      recommendations.push('Low fast path usage. Consider using memoization or stable references.');
    }

    if (recommendations.length === 0) {
      recommendations.push('All optimizations are performing well!');
    }

    return recommendations;
  },
};
