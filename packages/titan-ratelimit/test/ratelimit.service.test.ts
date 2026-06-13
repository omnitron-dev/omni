/**
 * Orchestration tests for RateLimitService (RL-1).
 *
 * The algorithms themselves are covered by ratelimit.algorithms.test.ts; this
 * suite exercises the SERVICE layer that ties an algorithm + storage + config
 * together — the previously untested glue where integration bugs live: tier
 * resolution, limit precedence (options > tier > default), storage-key
 * namespacing, the `enabled` short-circuit, enforce()'s throw, getStatus()'s
 * non-consuming read, reset(), and statistics.
 *
 * Real MemoryRateLimitStorage + the real fixed-window algorithm (deterministic
 * count semantics) under a faked clock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimitService, RateLimitExceededError } from '../src/ratelimit.service.js';
import { MemoryRateLimitStorage } from '../src/ratelimit.storage.js';
import type { IRateLimitModuleOptions } from '../src/ratelimit.types.js';

const T0 = 1_700_000_000_000;

function makeService(options: Partial<IRateLimitModuleOptions> = {}) {
  const storage = new MemoryRateLimitStorage();
  const service = new RateLimitService(storage, {
    strategy: 'fixed-window',
    defaultLimit: 3,
    defaultWindowMs: 60_000,
    ...options,
  } as IRateLimitModuleOptions);
  return { storage, service };
}

describe('RateLimitService orchestration (RL-1)', () => {
  let storage: MemoryRateLimitStorage;
  let service: RateLimitService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    service?.destroy();
    vi.useRealTimers();
  });

  it('consume() counts down remaining and denies past the default limit', async () => {
    ({ storage, service } = makeService({ defaultLimit: 3 }));

    const r1 = await service.consume('user:1');
    const r2 = await service.consume('user:1');
    const r3 = await service.consume('user:1');
    const r4 = await service.consume('user:1');

    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
    expect(r3.remaining).toBe(0);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false); // 4th over the limit of 3
    expect(r4.limit).toBe(3);
  });

  it('enabled:false short-circuits to always-allowed at the default limit', async () => {
    ({ storage, service } = makeService({ enabled: false, defaultLimit: 7 }));

    for (let i = 0; i < 20; i++) {
      const r = await service.consume('spam');
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(7);
      expect(r.limit).toBe(7);
    }
  });

  it('getStatus() reports state without consuming a token', async () => {
    ({ storage, service } = makeService({ defaultLimit: 3 }));

    const s1 = await service.getStatus('user:2');
    const s2 = await service.getStatus('user:2');
    // Neither read consumed, so remaining is unchanged across calls.
    expect(s1.remaining).toBe(3);
    expect(s2.remaining).toBe(3);

    // And a real consume afterwards starts from the full budget.
    const c = await service.consume('user:2');
    expect(c.remaining).toBe(2);
  });

  it('enforce() throws RateLimitExceededError (carrying the result) once exhausted', async () => {
    ({ storage, service } = makeService({ defaultLimit: 1 }));

    await service.enforce('user:3'); // 1st allowed
    await expect(service.enforce('user:3')).rejects.toBeInstanceOf(RateLimitExceededError);

    const err = await service.enforce('user:3').then(
      () => null,
      (e) => e as RateLimitExceededError,
    );
    expect(err).toBeInstanceOf(RateLimitExceededError);
    expect(err!.result.allowed).toBe(false);
    expect(err!.message).toContain('user:3');
  });

  it('applies a named tier: limit + burst is the effective ceiling', async () => {
    ({ storage, service } = makeService({
      defaultLimit: 3,
      tiers: { premium: { limit: 5, windowMs: 60_000, burst: 2 } },
    }));

    // premium tier → effectiveLimit = 5 + 2 = 7 allowed before denial.
    let lastAllowed = true;
    let allowedCount = 0;
    for (let i = 0; i < 8; i++) {
      const r = await service.consume('u', { tier: 'premium' });
      if (r.allowed) allowedCount++;
      lastAllowed = r.allowed;
      if (r.allowed) expect(r.tier).toBe('premium');
    }
    expect(allowedCount).toBe(7);
    expect(lastAllowed).toBe(false); // 8th denied
  });

  it('limit precedence: explicit options.limit overrides tier and default', async () => {
    ({ storage, service } = makeService({
      defaultLimit: 100,
      tiers: { basic: { limit: 50, windowMs: 60_000 } },
    }));

    // options.limit:1 wins over tier(50) and default(100).
    const a = await service.consume('u', { tier: 'basic', limit: 1 });
    const b = await service.consume('u', { tier: 'basic', limit: 1 });
    expect(a.allowed).toBe(true);
    expect(a.limit).toBe(1);
    expect(b.allowed).toBe(false);
  });

  it('namespaces buckets by tier so different tiers/keys do not share a budget', async () => {
    ({ storage, service } = makeService({
      defaultLimit: 1,
      tiers: { t1: { limit: 1, windowMs: 60_000 }, t2: { limit: 1, windowMs: 60_000 } },
    }));

    // Same logical key, different tier → independent buckets (buildKey adds tier).
    expect((await service.consume('k', { tier: 't1' })).allowed).toBe(true);
    expect((await service.consume('k', { tier: 't2' })).allowed).toBe(true);
    // Re-consuming t1 is now exhausted, but t2 was untouched by t1.
    expect((await service.consume('k', { tier: 't1' })).allowed).toBe(false);
  });

  it('reset() clears a key so its budget is restored', async () => {
    ({ storage, service } = makeService({ defaultLimit: 1 }));

    expect((await service.consume('user:4')).allowed).toBe(true);
    expect((await service.consume('user:4')).allowed).toBe(false);

    await service.reset('user:4');

    expect((await service.consume('user:4')).allowed).toBe(true);
  });

  it('getStats() tracks totals and per-tier breakdown', async () => {
    ({ storage, service } = makeService({
      defaultLimit: 1,
      tiers: { vip: { limit: 1, windowMs: 60_000 } },
    }));

    await service.consume('a', { tier: 'vip' }); // allowed
    await service.consume('a', { tier: 'vip' }); // denied
    await service.consume('b');                  // allowed (no tier)

    const stats = service.getStats();
    expect(stats.totalChecks).toBe(3);
    expect(stats.totalAllowed).toBe(2);
    expect(stats.totalDenied).toBe(1);
    expect(stats.byTier?.get('vip')).toEqual({ checks: 2, allowed: 1, denied: 1 });
  });
});
