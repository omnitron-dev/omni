/**
 * Correctness tests for the three rate-limiting algorithms.
 *
 * These algorithms gate every Netron RPC (and the health probes) but previously
 * had ZERO test coverage. Tested against the real MemoryRateLimitStorage with
 * a faked clock so refill / window-slide behaviour is deterministic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SlidingWindowAlgorithm,
  FixedWindowAlgorithm,
  TokenBucketAlgorithm,
  createAlgorithm,
} from '../src/ratelimit.algorithms.js';
import { MemoryRateLimitStorage } from '../src/ratelimit.storage.js';

const T0 = 1_700_000_000_000; // fixed epoch base for deterministic windows

describe('ratelimit algorithms', () => {
  let storage: MemoryRateLimitStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    storage = new MemoryRateLimitStorage();
  });

  afterEach(() => {
    storage.destroy();
    vi.useRealTimers();
  });

  describe('SlidingWindowAlgorithm', () => {
    it('allows exactly `limit` requests then denies, with correct remaining', async () => {
      const algo = new SlidingWindowAlgorithm();
      for (let i = 0; i < 5; i++) {
        const r = await algo.check(storage, 'k', 5, 60_000, true);
        expect(r.allowed).toBe(true);
        expect(r.remaining).toBe(5 - (i + 1));
      }
      const denied = await algo.check(storage, 'k', 5, 60_000, true);
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);
      expect(denied.retryAfter).toBe(60);
    });

    it('peek (consume=false) does not consume a slot', async () => {
      const algo = new SlidingWindowAlgorithm();
      await algo.check(storage, 'k', 5, 60_000, true);
      const peek1 = await algo.check(storage, 'k', 5, 60_000, false);
      const peek2 = await algo.check(storage, 'k', 5, 60_000, false);
      expect(peek1.remaining).toBe(4);
      expect(peek2.remaining).toBe(4);
    });

    it('slides — entries older than the window free up slots', async () => {
      const algo = new SlidingWindowAlgorithm();
      for (let i = 0; i < 5; i++) await algo.check(storage, 'k', 5, 60_000, true);
      expect((await algo.check(storage, 'k', 5, 60_000, true)).allowed).toBe(false);
      vi.setSystemTime(T0 + 61_000); // past the 60s window
      expect((await algo.check(storage, 'k', 5, 60_000, true)).allowed).toBe(true);
    });
  });

  describe('FixedWindowAlgorithm', () => {
    it('allows `limit` per window then denies', async () => {
      const algo = new FixedWindowAlgorithm();
      for (let i = 0; i < 3; i++) {
        expect((await algo.check(storage, 'k', 3, 60_000, true)).allowed).toBe(true);
      }
      const denied = await algo.check(storage, 'k', 3, 60_000, true);
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);
    });

    it('resets at the next window boundary', async () => {
      const algo = new FixedWindowAlgorithm();
      for (let i = 0; i < 3; i++) await algo.check(storage, 'k', 3, 60_000, true);
      expect((await algo.check(storage, 'k', 3, 60_000, true)).allowed).toBe(false);
      // Advance into the next aligned window.
      const nextWindow = (Math.floor(T0 / 60_000) + 1) * 60_000;
      vi.setSystemTime(nextWindow + 10);
      expect((await algo.check(storage, 'k', 3, 60_000, true)).allowed).toBe(true);
    });
  });

  describe('TokenBucketAlgorithm', () => {
    it('starts full, allows a burst up to capacity then denies', async () => {
      const algo = new TokenBucketAlgorithm();
      for (let i = 0; i < 10; i++) {
        expect((await algo.check(storage, 'k', 10, 60_000, true)).allowed).toBe(true);
      }
      expect((await algo.check(storage, 'k', 10, 60_000, true)).allowed).toBe(false);
    });

    it('peek reports the TRUE available token count (regression: no off-by-one)', async () => {
      const algo = new TokenBucketAlgorithm();
      const peek = await algo.check(storage, 'k', 10, 60_000, false);
      expect(peek.allowed).toBe(true);
      expect(peek.remaining).toBe(10); // a full bucket peeked must read 10, not 9
    });

    it('refills continuously over elapsed time', async () => {
      const algo = new TokenBucketAlgorithm();
      for (let i = 0; i < 10; i++) await algo.check(storage, 'k', 10, 60_000, true);
      expect((await algo.check(storage, 'k', 10, 60_000, true)).allowed).toBe(false);
      vi.setSystemTime(T0 + 30_000); // half a window → ~5 tokens refilled
      const r = await algo.check(storage, 'k', 10, 60_000, true);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBeGreaterThanOrEqual(3);
    });

    it('caps refill at bucket capacity', async () => {
      const algo = new TokenBucketAlgorithm();
      await algo.check(storage, 'k', 10, 60_000, true); // 9 left
      vi.setSystemTime(T0 + 10 * 60_000); // 10 windows later — would overflow without cap
      const peek = await algo.check(storage, 'k', 10, 60_000, false);
      expect(peek.remaining).toBe(10); // capped at limit, not 9 + 100
    });
  });

  describe('createAlgorithm', () => {
    it('instantiates each strategy', () => {
      expect(createAlgorithm('sliding-window')).toBeInstanceOf(SlidingWindowAlgorithm);
      expect(createAlgorithm('fixed-window')).toBeInstanceOf(FixedWindowAlgorithm);
      expect(createAlgorithm('token-bucket')).toBeInstanceOf(TokenBucketAlgorithm);
    });

    it('throws on an unknown strategy', () => {
      expect(() => createAlgorithm('nope' as never)).toThrow(/Unknown rate limit strategy/);
    });
  });
});
