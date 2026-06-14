/**
 * Canonical CircuitBreaker — imperative API (RESILIENCE-UNIFY)
 *
 * The auth policy engine drives the breaker imperatively
 * (`isOpen()` / `recordSuccess()` / `recordFailure()`) rather than via
 * `execute()`. After unifying onto utils/resilience's CircuitBreaker, these
 * tests lock the auth-equivalent behaviour the policy engine relies on:
 * configured with volumeThreshold:1 + failureRateThreshold:0 + successThreshold:1,
 * the breaker opens at exactly `failureThreshold` cumulative failures, any
 * success resets the count, it half-opens after `resetTimeout`, and one
 * half-open success closes it (a half-open failure reopens it).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker, CircuitState } from '../../src/utils/resilience.js';

const authConfig = {
  failureThreshold: 3,
  resetTimeout: 1000,
  successThreshold: 1,
  volumeThreshold: 1,
  failureRateThreshold: 0,
  name: 'test',
};

// A realistic epoch base; Date.now() is never 0 in production (the breaker's
// open-state check guards on a truthy lastFailureTime), so the fake clock must
// start non-zero too.
const T0 = 1_700_000_000_000;

describe('CircuitBreaker imperative API (RESILIENCE-UNIFY)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens at exactly failureThreshold cumulative failures', () => {
    const cb = new CircuitBreaker(authConfig);
    expect(cb.isOpen()).toBe(false);
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false); // 1 < 3
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false); // 2 < 3
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true); // 3 >= 3
    expect(cb.getState()).toBe(CircuitState.Open);
  });

  it('resets the failure count on any success while closed', () => {
    const cb = new CircuitBreaker(authConfig);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess(); // reset to 0
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false); // only 2 since the reset
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true); // now 3
  });

  it('half-opens after resetTimeout and closes on one success', () => {
    const cb = new CircuitBreaker(authConfig);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);

    // Before resetTimeout: still open.
    vi.setSystemTime(T0 + 999);
    expect(cb.isOpen()).toBe(true);

    // After resetTimeout: isOpen() transitions to half-open and allows a probe.
    vi.setSystemTime(T0 + 1001);
    expect(cb.isOpen()).toBe(false);
    expect(cb.getState()).toBe(CircuitState.HalfOpen);

    cb.recordSuccess();
    expect(cb.getState()).toBe(CircuitState.Closed);
    expect(cb.isOpen()).toBe(false);
  });

  it('reopens on a half-open failure', () => {
    const cb = new CircuitBreaker(authConfig);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    vi.setSystemTime(T0 + 1001);
    expect(cb.isOpen()).toBe(false); // half-open probe allowed
    expect(cb.getState()).toBe(CircuitState.HalfOpen);

    cb.recordFailure(); // probe failed
    expect(cb.getState()).toBe(CircuitState.Open);
    expect(cb.isOpen()).toBe(true);
  });

  it('still supports the execute() path unchanged', async () => {
    const cb = new CircuitBreaker(authConfig);
    await expect(cb.execute(async () => 'ok')).resolves.toBe('ok');
    cb.forceOpen();
    await expect(cb.execute(async () => 'ok')).rejects.toThrow(/is open/i);
  });
});
