/**
 * MemoryRateLimitStorage TTL / expiry tests (RL-1).
 *
 * The in-memory backend is the foundation every algorithm rests on, and its
 * TTL handling is correctness-critical: a wrong unit or boundary means rate
 * limits that never reset or reset instantly. (A real seconds-vs-milliseconds
 * TTL bug previously expired fixed-window entries almost immediately — see the
 * note in FixedWindowAlgorithm.check.) These lock the ms unit, the exclusive
 * expiry boundary, and the distinct refresh semantics of checkAndConsume
 * (window-stable) vs increment (sliding).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRateLimitStorage } from '../src/ratelimit.storage.js';

const T0 = 1_700_000_000_000;

describe('MemoryRateLimitStorage TTL/expiry (RL-1)', () => {
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

  it('interprets ttl as MILLISECONDS', async () => {
    await storage.set('k', 5, 100); // 100 ms

    vi.setSystemTime(T0 + 99);
    expect(await storage.get('k')).toBe(5); // not yet expired

    vi.setSystemTime(T0 + 101);
    expect(await storage.get('k')).toBeNull(); // expired ~100 ms later, not ~100 s
  });

  it('expiry boundary is exclusive — valid at exactly expiresAt', async () => {
    await storage.set('k', 1, 100);

    vi.setSystemTime(T0 + 100); // expiresAt === now → `expiresAt < now` is false
    expect(await storage.get('k')).toBe(1);
  });

  it('checkAndConsume sets TTL only on first create — later hits do NOT extend the window', async () => {
    await storage.checkAndConsume('w', 5, 100); // creates window at T0, ttl 100

    vi.setSystemTime(T0 + 60);
    await storage.checkAndConsume('w', 5, 100); // a later hit must not push expiry to T0+160

    vi.setSystemTime(T0 + 101);
    // The window created at T0 has expired despite the T0+60 hit → counter cleared.
    expect(await storage.get('w')).toBeNull();
  });

  it('increment refreshes TTL on each call when ttl is supplied (sliding)', async () => {
    await storage.increment('i', 100); // expiry T0+100

    vi.setSystemTime(T0 + 60);
    await storage.increment('i', 100); // refreshes expiry to T0+160

    vi.setSystemTime(T0 + 120); // past the original T0+100, before T0+160
    expect(await storage.get('i')).toBe(2); // still alive because it was refreshed
  });

  it('get() lazily deletes an expired key, and a fresh write starts over', async () => {
    await storage.set('k', 9, 50);

    vi.setSystemTime(T0 + 51);
    expect(await storage.get('k')).toBeNull(); // expired + lazily deleted

    expect(await storage.increment('k', 50)).toBe(1); // re-created from zero
  });

  it('delete() removes a key immediately', async () => {
    await storage.set('k', 3, 10_000);
    await storage.delete('k');
    expect(await storage.get('k')).toBeNull();
  });
});
