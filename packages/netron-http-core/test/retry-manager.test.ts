/**
 * RetryManager (SHARED-HTTP-CORE) — core behaviour.
 *
 * Covers retry-then-succeed, the NB-5 idempotency gate (ambiguous failures only
 * retried when idempotent), exhaustion, the self-contained circuit breaker, and
 * the neutral logger hook. Uses tiny real delays (initialDelay 1ms, jitter 0).
 */
import { describe, it, expect, vi } from 'vitest';
import { RetryManager } from '../src/retry-manager.js';

const fast = { attempts: 3, initialDelay: 1, maxDelay: 5, jitter: 0, factor: 1 } as const;

describe('RetryManager (shared)', () => {
  it('returns the result without retrying on success', async () => {
    const rm = new RetryManager();
    const fn = vi.fn(async () => 'ok');
    expect(await rm.execute(fn, { ...fast })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries an ambiguous failure when idempotent, then succeeds', async () => {
    const rm = new RetryManager();
    let n = 0;
    const fn = vi.fn(async () => {
      if (++n < 3) throw { status: 503 };
      return 'recovered';
    });
    expect(await rm.execute(fn, { ...fast, idempotent: true })).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('NB-5: does NOT retry an ambiguous 5xx when NOT idempotent', async () => {
    const rm = new RetryManager();
    const fn = vi.fn(async () => {
      throw { status: 503 };
    });
    await expect(rm.execute(fn, { ...fast, idempotent: false })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(1); // gated — no retry
  });

  it('NB-5: retries a connection-refused failure even when not idempotent (never reached server)', async () => {
    const rm = new RetryManager();
    let n = 0;
    const fn = vi.fn(async () => {
      if (++n < 2) throw { code: 'ECONNREFUSED' };
      return 'ok';
    });
    expect(await rm.execute(fn, { ...fast, idempotent: false })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries and throws the last error', async () => {
    const rm = new RetryManager();
    const fn = vi.fn(async () => {
      throw { status: 503 };
    });
    await expect(rm.execute(fn, { attempts: 2, initialDelay: 1, jitter: 0, factor: 1, idempotent: true })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('opens the circuit breaker after the failure threshold', async () => {
    const rm = new RetryManager({ circuitBreaker: { threshold: 1, windowTime: 10_000, cooldownTime: 10_000 } });
    const fn = vi.fn(async () => {
      throw { status: 503 };
    });
    // First execute fails all attempts → records a circuit failure → opens (threshold 1).
    await expect(rm.execute(fn, { attempts: 0, initialDelay: 1, jitter: 0, idempotent: true })).rejects.toBeDefined();
    expect(rm.getCircuitBreakerState()).toBe('open');
    // Next call short-circuits without invoking fn.
    fn.mockClear();
    await expect(rm.execute(fn, { ...fast, idempotent: true })).rejects.toThrow(/Circuit breaker is open/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('routes debug output through an injected logger', async () => {
    const debug = vi.fn();
    const rm = new RetryManager({ logger: { debug, warn: vi.fn() } });
    await rm.execute(async () => 'ok', { ...fast });
    expect(debug).toHaveBeenCalled(); // 'Retry attempt' debug line
  });
});
