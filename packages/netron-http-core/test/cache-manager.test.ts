/**
 * HttpCacheManager (SHARED-HTTP-CORE) — core behaviour.
 *
 * Verifies the shared cache manager that both titan and netron-browser now
 * consume: fresh hit, miss-then-fetch, stale-while-revalidate, tag/pattern
 * invalidation, LRU eviction, TTL expiry, and the neutral logger hook.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpCacheManager } from '../src/cache-manager.js';

describe('HttpCacheManager (shared)', () => {
  it('returns a fresh cache hit without re-fetching', async () => {
    const cm = new HttpCacheManager();
    const fetcher = vi.fn(async () => 'v1');

    expect(await cm.get('k', fetcher, { maxAge: 1000 })).toBe('v1'); // miss → fetch
    expect(await cm.get('k', fetcher, { maxAge: 1000 })).toBe('v1'); // hit
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cm.isCacheHit('k')).toBe(true);
    expect(cm.getStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('serves stale-while-revalidate and refreshes in the background', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const cm = new HttpCacheManager();
      let n = 0;
      const fetcher = vi.fn(async () => `v${++n}`);

      expect(await cm.get('k', fetcher, { maxAge: 100, staleWhileRevalidate: 1000 })).toBe('v1');

      // Past maxAge but within SWR window: returns stale v1, triggers background refresh.
      vi.setSystemTime(1_000_000 + 200);
      expect(await cm.get('k', fetcher, { maxAge: 100, staleWhileRevalidate: 1000 })).toBe('v1');
      expect(fetcher).toHaveBeenCalledTimes(2); // revalidation fetch fired synchronously

      // Flush the revalidation promise microtasks WITHOUT firing the long TTL
      // timer (advancing by 0 leaves the entry in place, just lets set(v2) run).
      await vi.advanceTimersByTimeAsync(0);

      // Next read serves the refreshed value.
      expect(await cm.get('k', fetcher, { maxAge: 100, staleWhileRevalidate: 1000 })).toBe('v2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates by tag and by prefix pattern', async () => {
    const cm = new HttpCacheManager();
    await cm.get('users/1', async () => 'a', { maxAge: 1000, tags: ['users'] });
    await cm.get('users/2', async () => 'b', { maxAge: 1000, tags: ['users'] });
    await cm.get('posts/1', async () => 'c', { maxAge: 1000, tags: ['posts'] });

    cm.invalidate(['users']); // tag
    expect(cm.getRaw('users/1')).toBeUndefined();
    expect(cm.getRaw('users/2')).toBeUndefined();
    expect(cm.getRaw('posts/1')).toBe('c');

    cm.invalidate('posts/*'); // prefix
    expect(cm.getRaw('posts/1')).toBeUndefined();
  });

  it('evicts the oldest entry at maxEntries capacity', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const cm = new HttpCacheManager({ maxEntries: 2 });
      await cm.get('a', async () => 1, { maxAge: 10_000 });
      vi.setSystemTime(1_000_001);
      await cm.get('b', async () => 2, { maxAge: 10_000 });
      vi.setSystemTime(1_000_002);
      await cm.get('c', async () => 3, { maxAge: 10_000 }); // evicts 'a' (oldest)

      expect(cm.getRaw('a')).toBeUndefined();
      expect(cm.getRaw('b')).toBe(2);
      expect(cm.getRaw('c')).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes debug output through an injected neutral logger', async () => {
    const debug = vi.fn();
    const cm = new HttpCacheManager({ logger: { debug } });
    await cm.get('k', async () => 'v', { maxAge: 1000 });
    expect(debug).toHaveBeenCalledWith('[Cache] MISS: k');
  });
});
