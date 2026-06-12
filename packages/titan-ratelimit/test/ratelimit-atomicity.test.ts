/**
 * RL-atomicity: the fixed-window / counter path must admit at most `limit`
 * slots even under concurrent callers.
 *
 * The old `storage.get()` (check) + `storage.increment()` (consume) sequence had
 * a TOCTOU window: N concurrent callers could all read `count < limit` at the
 * `await get()` point and then all `await increment()`, admitting far more than
 * `limit`. The atomic `checkAndConsume` does the compare-and-increment as one
 * step (Redis Lua / single-threaded memory), so the counter never overshoots.
 */

import { describe, it, expect } from 'vitest';
import { MemoryRateLimitStorage } from '../src/ratelimit.storage.js';
import { FixedWindowAlgorithm, SlidingWindowAlgorithm, TokenBucketAlgorithm } from '../src/ratelimit.algorithms.js';

describe('RL-atomicity — checkAndConsume', () => {
  it('admits exactly `limit` slots under heavy concurrency and never overshoots the counter', async () => {
    const storage = new MemoryRateLimitStorage();
    const limit = 10;

    const results = await Promise.all(
      Array.from({ length: 100 }, () => storage.checkAndConsume('k', limit, 1000))
    );

    expect(results.filter((r) => r.allowed).length).toBe(limit);
    // Denied requests must NOT increment — the counter caps at `limit`.
    expect(Math.max(...results.map((r) => r.count))).toBe(limit);

    storage.destroy();
  });

  it('FixedWindowAlgorithm.check (consume) admits at most `limit` under concurrency', async () => {
    const storage = new MemoryRateLimitStorage();
    const algo = new FixedWindowAlgorithm();
    const limit = 5;

    const results = await Promise.all(
      Array.from({ length: 50 }, () => algo.check(storage, 'api:user', limit, 60_000, true))
    );

    expect(results.filter((r) => r.allowed).length).toBe(limit);
    storage.destroy();
  });

  it('peek (consume=false) does not consume a slot', async () => {
    const storage = new MemoryRateLimitStorage();
    const algo = new FixedWindowAlgorithm();
    const limit = 3;

    // Two peeks — neither should consume.
    expect((await algo.check(storage, 'k', limit, 60_000, false)).allowed).toBe(true);
    expect((await algo.check(storage, 'k', limit, 60_000, false)).allowed).toBe(true);

    // All `limit` slots are therefore still available to real consumers.
    const consumed = await Promise.all(
      Array.from({ length: limit + 2 }, () => algo.check(storage, 'k', limit, 60_000, true))
    );
    expect(consumed.filter((r) => r.allowed).length).toBe(limit);

    storage.destroy();
  });
});

describe('RL-3b — sliding-window checkAndConsumeSlidingWindow', () => {
  it('admits exactly `limit` under concurrency and never overshoots the set', async () => {
    const storage = new MemoryRateLimitStorage();
    const limit = 8;
    const now = Date.now();

    const results = await Promise.all(
      Array.from({ length: 80 }, (_, i) =>
        storage.checkAndConsumeSlidingWindow('k', limit, now - 60_000, now, `m-${i}`, 60_000)
      )
    );

    expect(results.filter((r) => r.allowed).length).toBe(limit);
    expect(Math.max(...results.map((r) => r.count))).toBe(limit); // never exceeds the limit

    storage.destroy();
  });

  it('SlidingWindowAlgorithm.check (consume) admits at most `limit` under concurrency', async () => {
    const storage = new MemoryRateLimitStorage();
    const algo = new SlidingWindowAlgorithm();
    const limit = 5;

    const results = await Promise.all(
      Array.from({ length: 50 }, () => algo.check(storage, 'api:user', limit, 60_000, true))
    );

    expect(results.filter((r) => r.allowed).length).toBe(limit);
    storage.destroy();
  });

  it('prunes entries older than the window so a later window admits fresh requests', async () => {
    const storage = new MemoryRateLimitStorage();
    const limit = 2;
    const t0 = 1_000_000;

    // Fill the window at t0.
    expect((await storage.checkAndConsumeSlidingWindow('k', limit, t0 - 1000, t0, 'a', 60_000)).allowed).toBe(true);
    expect((await storage.checkAndConsumeSlidingWindow('k', limit, t0 - 1000, t0, 'b', 60_000)).allowed).toBe(true);
    expect((await storage.checkAndConsumeSlidingWindow('k', limit, t0 - 1000, t0, 'c', 60_000)).allowed).toBe(false);

    // Far later: the old entries fall outside the window (score <= windowStart) → pruned → admit again.
    const later = t0 + 10_000;
    const res = await storage.checkAndConsumeSlidingWindow('k', limit, later - 1000, later, 'd', 60_000);
    expect(res.allowed).toBe(true);
    expect(res.count).toBe(1); // a/b/c pruned

    storage.destroy();
  });
});

describe('RL-3c — token-bucket checkAndConsumeTokenBucket', () => {
  it('admits at most `capacity` under concurrency from a full bucket', async () => {
    const storage = new MemoryRateLimitStorage();
    const capacity = 10;
    const now = Date.now();

    // No time passes → no refill; only the initial capacity is available.
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        storage.checkAndConsumeTokenBucket('k', capacity, capacity, 60_000, now, 1, 120_000)
      )
    );

    expect(results.filter((r) => r.allowed).length).toBe(capacity);
    storage.destroy();
  });

  it('accrues FRACTIONAL refill across calls without losing sub-token elapsed (RL-2)', async () => {
    const storage = new MemoryRateLimitStorage();
    const capacity = 10;
    const refillRate = 10; // 10 tokens / 1000ms = 0.01 token/ms
    const windowMs = 1000;
    const t0 = 5_000_000;

    // Drain the bucket dry.
    for (let i = 0; i < capacity; i++) {
      expect((await storage.checkAndConsumeTokenBucket('k', capacity, refillRate, windowMs, t0, 1, 60_000)).allowed).toBe(
        true
      );
    }
    expect((await storage.checkAndConsumeTokenBucket('k', capacity, refillRate, windowMs, t0, 1, 60_000)).allowed).toBe(
      false
    );

    // Four 25ms steps = 100ms → 100*0.01 = exactly 1.0 token. If sub-token
    // elapsed were discarded each step (0.25 floored to 0), none would ever
    // admit. With fractional carry, the 4th step crosses 1.0 → exactly one admit.
    let admitted = 0;
    for (let step = 1; step <= 4; step++) {
      if ((await storage.checkAndConsumeTokenBucket('k', capacity, refillRate, windowMs, t0 + step * 25, 1, 60_000)).allowed) {
        admitted++;
      }
    }
    expect(admitted).toBe(1);

    storage.destroy();
  });

  it('TokenBucketAlgorithm.check (consume) admits at most capacity under concurrency', async () => {
    const storage = new MemoryRateLimitStorage();
    const algo = new TokenBucketAlgorithm();
    const limit = 6;

    const results = await Promise.all(
      Array.from({ length: 40 }, () => algo.check(storage, 'k', limit, 60_000, true))
    );

    expect(results.filter((r) => r.allowed).length).toBe(limit);
    storage.destroy();
  });
});
