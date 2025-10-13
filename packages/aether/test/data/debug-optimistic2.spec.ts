/**
 * Debug test for optimistic updates - simulating actual test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCachedResource } from '../../src/data/resource-cache.js';
import { optimisticUpdate } from '../../src/data/optimistic.js';
import { resetCacheManager } from '../../src/data/cache-manager.js';

describe('Debug Optimistic 2', () => {
  beforeEach(() => {
    resetCacheManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetCacheManager();
    vi.useRealTimers();
  });

  it('should apply optimistic update immediately (simulating failing test)', async () => {
    const resource = createCachedResource(async () => ({ count: 0 }));

    // Wait for initial load
    await vi.runAllTimersAsync();
    console.log('1. Initial resource value:', resource());
    expect(resource()?.count).toBe(0);

    // Call optimisticUpdate without awaiting (like the failing test)
    console.log('2. Calling optimisticUpdate...');
    const promise = optimisticUpdate(
      resource,
      async () => {
        console.log('4. Inside mutation function, will setTimeout 1000ms');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log('6. Mutation function completed');
      },
      {
        optimisticData: { count: 10 },
      }
    );

    console.log('3. After calling optimisticUpdate, resource value:', resource());

    // Should update immediately
    console.log('5. Running all timers...');
    await vi.runAllTimersAsync();
    console.log('7. After runAllTimersAsync, resource value:', resource());

    expect(resource()?.count).toBe(10);
  });
});
