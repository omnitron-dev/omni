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
import { FixedWindowAlgorithm } from '../src/ratelimit.algorithms.js';

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
