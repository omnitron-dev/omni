/**
 * `@CircuitBreaker`'s two option names both read backwards from what they do.
 *
 * `threshold` is documented as "failures before opening", which reads as
 * consecutive. It was a tally that a success in the closed state did not
 * clear — only a half-open success did — so failures accumulated for the life
 * of the instance. Five failures five weeks apart opened the circuit exactly
 * as five in a row would, and the caller was then denied for `timeout` with a
 * perfectly healthy dependency. For a WebSocket that reconnects a few times a
 * day, or a wallet RPC that blips weekly, that is not a corner case; it is the
 * normal end state of a long-running process.
 *
 * Measured before it was changed: four failure-then-success pairs plus a fifth
 * failure left the next healthy call answering from the fallback, without
 * reaching the method at all.
 *
 * `fallback` is the other one. It is the method's error handler in EVERY
 * state, not the open circuit's substitute — the first call of a closed
 * circuit, if it throws, goes straight to it. That half is asserted here too,
 * because callers have written fallbacks returning a balance of 0 or an empty
 * list believing they were describing "the dependency is down", and shipped a
 * value indistinguishable from a measurement for every failure there is.
 */
import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../src/decorators.js';

class Probe {
  mode: 'ok' | 'fail' = 'ok';
  calls = 0;
  fallbacks = 0;

  @CircuitBreaker({ threshold: 5, timeout: 60_000, fallback: 'probeFallback' })
  async probe(): Promise<string> {
    this.calls++;
    if (this.mode === 'fail') throw new Error('dependency said no');
    return 'real';
  }

  async probeFallback(): Promise<string> {
    this.fallbacks++;
    return 'fallback';
  }
}

/** One failure, then one success. */
async function blip(p: Probe): Promise<void> {
  p.mode = 'fail';
  await p.probe();
  p.mode = 'ok';
  await p.probe();
}

describe('threshold counts failures since the last success', () => {
  it('does not open on failures a success came between', async () => {
    const p = new Probe();
    for (let i = 0; i < 8; i++) await blip(p);
    p.mode = 'ok';
    const calls = p.calls;
    expect(await p.probe()).toBe('real');
    expect(p.calls, 'the call did not reach the method').toBe(calls + 1);
  });

  it('still opens on failures in a row', async () => {
    // The control the decorator exists to provide must survive the fix.
    const p = new Probe();
    p.mode = 'fail';
    for (let i = 0; i < 5; i++) await p.probe();
    p.mode = 'ok';
    const calls = p.calls;
    expect(await p.probe()).toBe('fallback');
    expect(p.calls, 'an open circuit still called the method').toBe(calls);
  });

  it('opens on the threshold-th consecutive failure, not before', async () => {
    const p = new Probe();
    p.mode = 'fail';
    for (let i = 0; i < 4; i++) await p.probe();
    // Four failures: the circuit is still closed, so the fifth call reaches
    // the method and fails there.
    const calls = p.calls;
    await p.probe();
    expect(p.calls).toBe(calls + 1);
  });

  it('counts from zero again after a success interrupts a run', async () => {
    const p = new Probe();
    p.mode = 'fail';
    for (let i = 0; i < 4; i++) await p.probe();
    p.mode = 'ok';
    await p.probe();
    p.mode = 'fail';
    for (let i = 0; i < 4; i++) await p.probe();
    p.mode = 'ok';
    const calls = p.calls;
    expect(await p.probe()).toBe('real');
    expect(p.calls).toBe(calls + 1);
  });
});

describe('the fallback handles every failure, not only an open circuit', () => {
  it('answers for the very first failure of a closed circuit', async () => {
    // Nothing is open here: one call, one throw, and the caller receives the
    // fallback's value rather than the error. A fallback that returns a
    // plausible measurement makes every failure look like data.
    const p = new Probe();
    p.mode = 'fail';
    expect(await p.probe()).toBe('fallback');
    expect(p.fallbacks).toBe(1);
  });

  it('lets a throwing fallback reach the caller', async () => {
    // The recommended shape for anything whose value would be mistaken for a
    // measurement. If this did not hold, a caller could not refuse.
    class Refuses {
      @CircuitBreaker({ threshold: 5, timeout: 60_000, fallback: 'refuse' })
      async read(): Promise<number> {
        throw new Error('rpc down');
      }

      async refuse(): Promise<number> {
        throw new Error('refusing rather than answering a number');
      }
    }
    await expect(new Refuses().read()).rejects.toThrow('refusing');
  });

  it('rethrows the original error when no fallback is named', async () => {
    class Bare {
      @CircuitBreaker({ threshold: 5, timeout: 60_000 })
      async read(): Promise<number> {
        throw new Error('rpc down');
      }
    }
    await expect(new Bare().read()).rejects.toThrow('rpc down');
  });

  it('keeps each instance on its own tally', async () => {
    // The state is a WeakMap keyed by instance. Two wallets on one class must
    // not open each other's circuit.
    const a = new Probe();
    const b = new Probe();
    a.mode = 'fail';
    for (let i = 0; i < 5; i++) await a.probe();
    b.mode = 'ok';
    const calls = b.calls;
    expect(await b.probe()).toBe('real');
    expect(b.calls).toBe(calls + 1);
  });
});
