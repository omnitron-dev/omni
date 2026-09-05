import { describe, it, expect, vi, afterEach } from 'vitest';

import { LRUCache } from '../src/lru-cache.js';

/**
 * TTL eviction must not wait for the timer wheel to come round again.
 *
 * The cache wheel runs at `resolution: 1000` with `wheelSize: 60`, and
 * `ICacheSetOptions.ttl` is in SECONDS — so the delay handed to the wheel is
 * always an exact multiple of its resolution. That is precisely the case where
 * `schedule()` leaves no slack: the entry's slot is reached exactly `ttl * 1000`
 * ms after the preceding tick, while the entry expires that long after the
 * `set()` call, which is later by however far into the tick the call landed.
 *
 * `get()` checks `expiresAt` itself (lru-cache.ts), so a stale value is never
 * served; what used to be delayed was the eviction — memory held and the
 * `onEvict(..., 'ttl')` callback fired up to a full revolution (60 s) late.
 */
describe('LRUCache - TTL eviction latency', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('evicts on time when the entry was set between wheel ticks', async () => {
    vi.useFakeTimers();

    const evictedAt: number[] = [];
    const cache = new LRUCache<string>({
      maxSize: 100,
      onEvict: (_key, _value, reason) => {
        if (reason === 'ttl') evictedAt.push(Date.now());
      },
    });

    // Keeps the wheel running, so the entry under test inherits its tick
    // boundaries instead of starting the interval itself.
    await cache.set('keepalive', 'x', { ttl: 600 });

    // 5 ms into the tick — the ordinary case. Landing exactly on a tick is the
    // only way the old code got this right.
    await vi.advanceTimersByTimeAsync(5);

    const setAt = Date.now();
    await cache.set('k', 'v', { ttl: 3 });

    await vi.advanceTimersByTimeAsync(120_000);

    expect(evictedAt).toHaveLength(1);
    // Measured before the fix: t+62_995 ms for a 3-second TTL. A timer wheel is
    // approximate by construction, so one resolution tick of lateness is the
    // contract; a whole revolution is not.
    expect(evictedAt[0]! - setAt).toBeLessThan(3_000 + 2_000);
  });
});
