/**
 * NR-3b: `useInfiniteQuery` stores `InfiniteData<T>` ({pages, pageParams}) while
 * `useQuery` stores a plain `T`. Both used to hash to the SAME map key, so a
 * consumer that (mis)used one queryKey for both an infinite and a regular query
 * would have them overwrite each other — each then reading the other's wrong
 * shape. Infinite entries are now stored under a NUL-marked variant of the hash
 * so the two coexist, while `invalidate()`/`remove()` still act on BOTH variants
 * so the infinite query stays reachable by its public key.
 */

import { describe, it, expect } from 'vitest';
import { QueryCache } from '../../src/cache/query-cache.js';

interface InfiniteShape {
  pages: number[][];
  pageParams: unknown[];
}

describe('QueryCache infinite/regular namespacing (NR-3b)', () => {
  it('keeps a regular and an infinite entry under the same key from colliding', () => {
    const cache = new QueryCache({ gcEnabled: false });

    const regular = { v: 1 };
    const infinite: InfiniteShape = { pages: [[1, 2, 3]], pageParams: [undefined] };

    // Write the infinite entry FIRST, then the regular one under the same key.
    cache.set(['k'], infinite, undefined, true);
    cache.set(['k'], regular);

    // Pre-NR-3b the second write clobbered the first. Now each side reads its own.
    expect(cache.get(['k'])).toEqual(regular);
    expect(cache.get<InfiniteShape>(['k'], true)).toEqual(infinite);

    // Reverse order is equally safe.
    cache.set(['k'], { v: 2 });
    expect(cache.get<InfiniteShape>(['k'], true)).toEqual(infinite);
    expect(cache.get(['k'])).toEqual({ v: 2 });
  });

  it('invalidate(key) invalidates BOTH the regular and the infinite entry', () => {
    const cache = new QueryCache({ gcEnabled: false });

    cache.set(['k'], { v: 1 });
    cache.set(['k'], { pages: [[1]], pageParams: [undefined] }, undefined, true);

    cache.invalidate(['k']);

    expect(cache.getQuery(['k'])?.state.isInvalidated).toBe(true);
    expect(cache.getQuery(['k'], true)?.state.isInvalidated).toBe(true);
  });

  it('remove(key) removes BOTH the regular and the infinite entry', () => {
    const cache = new QueryCache({ gcEnabled: false });

    cache.set(['k'], { v: 1 });
    cache.set(['k'], { pages: [[1]], pageParams: [undefined] }, undefined, true);

    cache.remove(['k']);

    expect(cache.get(['k'])).toBeUndefined();
    expect(cache.get(['k'], true)).toBeUndefined();
  });

  it('notifies only the matching variant on write', () => {
    const cache = new QueryCache({ gcEnabled: false });

    let regularNotifs = 0;
    let infiniteNotifs = 0;
    cache.subscribe(['k'], () => regularNotifs++);
    cache.subscribe(['k'], () => infiniteNotifs++, undefined, true);

    cache.set(['k'], { v: 1 });
    expect(regularNotifs).toBe(1);
    expect(infiniteNotifs).toBe(0);

    cache.set(['k'], { pages: [[1]], pageParams: [undefined] }, undefined, true);
    expect(regularNotifs).toBe(1);
    expect(infiniteNotifs).toBe(1);

    // invalidate fans out to both subscribers (both entries get invalidated).
    cache.invalidate(['k']);
    expect(regularNotifs).toBe(2);
    expect(infiniteNotifs).toBe(2);
  });

  it('leaves the regular-only path byte-identical (no marker leakage)', () => {
    const cache = new QueryCache({ gcEnabled: false });

    cache.set(['only'], { v: 7 });
    expect(cache.get(['only'])).toEqual({ v: 7 });
    // No infinite entry was ever written, so the infinite read is empty and a
    // findAll sees exactly one entry under the public key.
    expect(cache.get(['only'], true)).toBeUndefined();
    expect(cache.findAll().length).toBe(1);
    expect(cache.findAll()[0]!.queryKey).toEqual(['only']);
  });
});
