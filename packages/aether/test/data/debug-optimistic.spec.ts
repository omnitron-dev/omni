/**
 * Debug test for optimistic updates
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCachedResource } from '../../src/data/resource-cache.js';
import { resetCacheManager, getCacheManager } from '../../src/data/cache-manager.js';

describe('Debug Optimistic', () => {
  beforeEach(() => {
    resetCacheManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetCacheManager();
    vi.useRealTimers();
  });

  it('should update resource via mutate', async () => {
    const resource = createCachedResource(async () => ({ count: 0 }));

    // Wait for initial load
    await vi.runAllTimersAsync();
    console.log('Initial resource value:', resource());
    expect(resource()?.count).toBe(0);

    // Get cache manager
    const cache = getCacheManager();
    const cacheKey = resource.getCacheKey();
    console.log('Cache key:', cacheKey);
    console.log('Cache before mutate:', cache.get(cacheKey));

    // Call mutate directly (should be synchronous now)
    const mutatePromise = resource.mutate({ count: 10 });
    console.log('Cache after mutate (synchronous):', cache.get(cacheKey));
    console.log('Resource after mutate (synchronous, before await):', resource());

    // The value should already be 10 because mutate is synchronous!
    expect(resource()?.count).toBe(10);

    // Wait for mutate promise to complete (should be immediate)
    await mutatePromise;
    console.log('Resource after await mutate:', resource());
    expect(resource()?.count).toBe(10);
  });
});
