/**
 * `Retry-After` told every denied caller to wait the maximum.
 *
 * The sliding window returned `Math.ceil(windowMs / 1000)` — the WINDOW
 * LENGTH — no matter how much of the window had already elapsed. A sliding
 * window does not reset one full window from now; it frees a slot the moment
 * its oldest entry ages out.
 *
 * Measured on the platform's 15-minute sign-in budget: a caller twenty seconds
 * from being let back in was told "try again in 900 seconds", and
 * `ratelimit.middleware` puts that number straight into the `Retry-After`
 * header, so a client that honours it waits a quarter of an hour it did not
 * owe. That is a sign-in on a platform people reach over Tor.
 *
 * The two sibling algorithms in the same file already answered honestly
 * (`windowEnd - now`, `timeToRefill`); this one was the outlier.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { SlidingWindowAlgorithm, TokenBucketAlgorithm } from '../src/ratelimit.algorithms.js';
import { MemoryRateLimitStorage } from '../src/ratelimit.storage.js';

const WINDOW = 60_000;
const LIMIT = 3;

describe('a sliding window reports when it actually frees a slot', () => {
  let storage: MemoryRateLimitStorage;
  let algo: SlidingWindowAlgorithm;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    storage = new MemoryRateLimitStorage();
    algo = new SlidingWindowAlgorithm();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const consume = () => algo.check(storage, 'k', LIMIT, WINDOW, true);

  it('counts down as the window ages, instead of repeating its length', async () => {
    for (let i = 0; i < LIMIT; i++) await consume();

    const immediately = await consume();
    expect(immediately.allowed).toBe(false);
    expect(immediately.retryAfter, 'the full window, at the moment of filling').toBe(60);

    vi.advanceTimersByTime(45_000);
    const later = await consume();
    expect(later.allowed).toBe(false);
    expect(later.retryAfter, 'forty-five seconds in, fifteen remain').toBe(15);

    vi.advanceTimersByTime(10_000);
    const nearlyThere = await consume();
    expect(nearlyThere.retryAfter, 'fifty-five seconds in, five remain').toBe(5);
  });

  it('never reports zero, which a client would read as "immediately"', async () => {
    for (let i = 0; i < LIMIT; i++) await consume();
    vi.advanceTimersByTime(WINDOW - 1);

    const result = await consume();
    if (!result.allowed) {
      expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    }
  });

  it('lets the caller back in once the oldest entry ages out', async () => {
    for (let i = 0; i < LIMIT; i++) await consume();
    expect((await consume()).allowed).toBe(false);

    vi.advanceTimersByTime(WINDOW + 1);
    expect((await consume()).allowed, 'the window expired and nothing was let through').toBe(true);
  });

  it('reports the same truth on a non-consuming peek', async () => {
    // The sign-in path peeks rather than consumes, so the peek is the branch
    // that produces the number a user is shown.
    for (let i = 0; i < LIMIT; i++) await consume();
    vi.advanceTimersByTime(30_000);

    const peek = await algo.check(storage, 'k', LIMIT, WINDOW, false);
    expect(peek.allowed).toBe(false);
    expect(peek.retryAfter).toBe(30);
  });

  it('points resetAt at the same moment', async () => {
    for (let i = 0; i < LIMIT; i++) await consume();
    const at = Date.now();
    vi.advanceTimersByTime(20_000);

    const denied = await algo.check(storage, 'k', LIMIT, WINDOW, false);
    expect(denied.resetAt).toBe(at + WINDOW);
  });

  it('falls back to the window length when storage cannot say', async () => {
    // A refusal must stay a refusal: a storage that cannot answer must not
    // turn it into an error, and the fallback errs long rather than short.
    for (let i = 0; i < LIMIT; i++) await consume();
    vi.spyOn(storage, 'oldestScoreInSortedSet').mockRejectedValue(new Error('down'));

    const denied = await algo.check(storage, 'k', LIMIT, WINDOW, false);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBe(60);
  });
});

describe('MemoryRateLimitStorage.oldestScoreInSortedSet', () => {
  it('answers null for a set that does not exist', async () => {
    const storage = new MemoryRateLimitStorage();
    expect(await storage.oldestScoreInSortedSet('nothing')).toBeNull();
  });

  it('finds the lowest score regardless of insertion order', async () => {
    const storage = new MemoryRateLimitStorage();
    await storage.addToSortedSet('k', 300, 'c');
    await storage.addToSortedSet('k', 100, 'a');
    await storage.addToSortedSet('k', 200, 'b');

    expect(await storage.oldestScoreInSortedSet('k')).toBe(100);
  });
});

describe('a token bucket reports time to ONE token, not to a full bucket', () => {
  /**
   * `retryAfter` reused `resetAt`'s number — the time to refill the bucket to
   * CAPACITY. They answer different questions. A caller asks "when may I try
   * again", which is when one token exists.
   *
   * With capacity 100 and a 100-per-minute refill, an empty bucket has a token
   * in 0.6 s and is full in 60. Telling the caller 60 is a hundredfold
   * over-statement, and the middleware puts it into `Retry-After` verbatim.
   */
  let storage: MemoryRateLimitStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    storage = new MemoryRateLimitStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not quote the time to a full bucket', async () => {
    const algo = new TokenBucketAlgorithm(100); // 100 tokens per window
    for (let i = 0; i < 100; i++) await algo.check(storage, 'b', 100, 60_000, true);

    const denied = await algo.check(storage, 'b', 100, 60_000, true);
    expect(denied.allowed).toBe(false);

    // One token arrives in 600 ms → 1 s after rounding. A full bucket is 60 s
    // away, and `resetAt` still says so — that is its own question.
    expect(denied.retryAfter, 'this is the time to a FULL bucket, not to one token').toBe(1);
    expect(denied.resetAt - Date.now()).toBeGreaterThan(50_000);
  });

  it('still refuses, and still recovers on schedule', async () => {
    const algo = new TokenBucketAlgorithm(60); // one token per second
    for (let i = 0; i < 60; i++) await algo.check(storage, 'c', 60, 60_000, true);
    expect((await algo.check(storage, 'c', 60, 60_000, true)).allowed).toBe(false);

    vi.advanceTimersByTime(1_100);
    expect((await algo.check(storage, 'c', 60, 60_000, true)).allowed, 'a token should have arrived').toBe(true);
  });

  it('never reports zero', async () => {
    const algo = new TokenBucketAlgorithm(60);
    for (let i = 0; i < 60; i++) await algo.check(storage, 'd', 60, 60_000, true);

    const denied = await algo.check(storage, 'd', 60, 60_000, true);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
  });
});
