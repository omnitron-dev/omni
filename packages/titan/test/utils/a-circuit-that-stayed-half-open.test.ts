/**
 * A circuit that stayed half-open.
 *
 * `execute()` lets one probe through a half-open circuit and marks it in
 * flight; the mark was cleared only if the circuit was STILL half-open when
 * the probe settled. A probe's result always moves it — a failure reopens it,
 * a success closes it — so the mark outlived every probe. The next time the
 * circuit half-opened, its first probe was refused as «testing recovery», no
 * probe could ever run, and the circuit stayed half-open for the life of the
 * process.
 *
 * On daos/test (2026-09-25) geo's Nominatim client opened while a recreated
 * Nominatim container was starting (08:34:44), probed once and failed
 * (08:35:44), half-opened again (08:36:44) — and from then on every geocode
 * answered «circuit breaker is open» while Nominatim itself answered in
 * milliseconds. The existing spec drives only the imperative API
 * (`isOpen()`/`recordSuccess()`/`recordFailure()`), which never touches the
 * mark.
 *
 * Held here: after a probe of either outcome, the next half-open episode
 * lets its probe run; while a probe is in flight, a second call is still
 * refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircuitBreaker, CircuitState } from '../../src/utils/resilience.js';

const T0 = 1_700_000_000_000;
const config = {
  name: 'nominatim',
  failureThreshold: 1,
  resetTimeout: 30_000,
  successThreshold: 1,
  volumeThreshold: 1,
};

const fail = () => Promise.reject(new Error('upstream down'));
const ok = () => Promise.resolve('ok');

describe('a half-open circuit after a probe has run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a failed probe reopens it, and the next half-open episode probes again', async () => {
    const cb = new CircuitBreaker(config);
    await expect(cb.execute(fail)).rejects.toThrow('upstream down');
    expect(cb.getState()).toBe(CircuitState.Open);

    vi.setSystemTime(T0 + 30_000);
    await expect(cb.execute(fail)).rejects.toThrow('upstream down'); // the probe ran, and failed
    expect(cb.getState()).toBe(CircuitState.Open);

    vi.setSystemTime(T0 + 60_000);
    const probe = vi.fn(ok);
    await expect(cb.execute(probe)).resolves.toBe('ok');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(cb.getState()).toBe(CircuitState.Closed);
  });

  it('a successful probe closes it, and a later half-open episode probes again', async () => {
    const cb = new CircuitBreaker(config);
    await expect(cb.execute(fail)).rejects.toThrow();
    vi.setSystemTime(T0 + 30_000);
    await expect(cb.execute(ok)).resolves.toBe('ok');
    expect(cb.getState()).toBe(CircuitState.Closed);

    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitState.Open);
    vi.setSystemTime(T0 + 60_000);
    const probe = vi.fn(ok);
    await expect(cb.execute(probe)).resolves.toBe('ok');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(cb.getState()).toBe(CircuitState.Closed);
  });

  it('while a probe is in flight, a second call is refused and does not run', async () => {
    const cb = new CircuitBreaker(config);
    await expect(cb.execute(fail)).rejects.toThrow();
    vi.setSystemTime(T0 + 30_000);

    let settle!: (v: string) => void;
    const inFlight = cb.execute(() => new Promise<string>((r) => (settle = r)));
    const second = vi.fn(ok);
    await expect(cb.execute(second)).rejects.toThrow(/testing recovery/);
    expect(second).not.toHaveBeenCalled();

    settle('ok');
    await expect(inFlight).resolves.toBe('ok');
    expect(cb.getState()).toBe(CircuitState.Closed);
  });
});
