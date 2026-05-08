/**
 * ResilientHandle unit tests.
 *
 * Coverage:
 *   - lazy creation + caching
 *   - successful use without resets
 *   - fatal-error retry path (one reset, retry succeeds)
 *   - fatal-error → fresh instance is also broken → second failure
 *     propagates
 *   - concurrent uses during reset coalesce
 *   - cooldown prevents thrash
 *   - dispose runs on reset
 *   - onReset telemetry hook fires with the right payload
 *   - non-fatal errors don't reset
 *   - manual reset() bypasses cooldown
 */

import { describe, it, expect, vi } from 'vitest';
import { ResilientHandle } from '../../src/utils/resilience.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('ResilientHandle', () => {
  it('creates lazily on first use', async () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const h = new ResilientHandle({ name: 'x', factory, isFatal: () => false });
    expect(factory).not.toHaveBeenCalled();
    expect(h.current()).toBeNull();
    await h.use((i) => expect(i.id).toBe(1));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('caches the instance across calls', async () => {
    let n = 0;
    const factory = () => ({ id: ++n });
    const h = new ResilientHandle({ name: 'x', factory, isFatal: () => false });
    const a = await h.use((i) => i.id);
    const b = await h.use((i) => i.id);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('does not reset on non-fatal errors', async () => {
    const factory = vi.fn(() => ({ id: 1 }));
    const h = new ResilientHandle({ name: 'x', factory, isFatal: () => false });
    await expect(h.use(() => Promise.reject(new Error('non-fatal')))).rejects.toThrow('non-fatal');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(h.resets).toBe(0);
  });

  it('resets and retries once on fatal error', async () => {
    let n = 0;
    const h = new ResilientHandle({
      name: 'x',
      factory: () => ({ id: ++n }),
      isFatal: (e) => (e as Error).message.includes('FATAL'),
    });
    let firstSeen = -1;
    const result = await h.use((i) => {
      if (firstSeen === -1) {
        firstSeen = i.id;
        throw new Error('FATAL: gone');
      }
      return i.id;
    });
    expect(firstSeen).toBe(1);
    expect(result).toBe(2); // retried with fresh instance
    expect(h.resets).toBe(1);
  });

  it('propagates the second failure if the fresh instance is also broken', async () => {
    const h = new ResilientHandle({
      name: 'x',
      factory: () => ({}),
      isFatal: () => true,
    });
    const fn = vi.fn(() => Promise.reject(new Error('FATAL: forever')));
    await expect(h.use(fn)).rejects.toThrow('FATAL: forever');
    expect(fn).toHaveBeenCalledTimes(2); // tried, reset, retried, gave up
    expect(h.resets).toBe(1);
  });

  it('cooldown blocks back-to-back resets', async () => {
    const h = new ResilientHandle({
      name: 'x',
      factory: () => ({}),
      isFatal: () => true,
      resetCooldownMs: 60_000,
    });
    await expect(h.use(() => Promise.reject(new Error('FATAL')))).rejects.toThrow();
    expect(h.resets).toBe(1);
    // Second call also throws; cooldown blocks the reset, the original
    // error propagates without retrying.
    const fn = vi.fn(() => Promise.reject(new Error('FATAL')));
    await expect(h.use(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(h.resets).toBe(1);
  });

  it('manual reset() bypasses cooldown', async () => {
    let n = 0;
    const h = new ResilientHandle({
      name: 'x',
      factory: () => ({ id: ++n }),
      isFatal: () => true,
      resetCooldownMs: 60_000,
    });
    await h.use((i) => i.id);
    await h.reset();
    const id = await h.use((i) => i.id);
    expect(id).toBe(2);
  });

  it('dispose runs on reset', async () => {
    const dispose = vi.fn();
    const h = new ResilientHandle({
      name: 'x',
      factory: () => ({ marker: true }),
      isFatal: () => true,
      dispose,
      resetCooldownMs: 0,
    });
    await h.use((i) => i.marker);
    let calls = 0;
    await h.use(() => {
      calls += 1;
      if (calls === 1) throw new Error('FATAL');
      return calls;
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('onReset hook fires with attempt + lastError', async () => {
    const events: unknown[] = [];
    const h = new ResilientHandle({
      name: 'x',
      factory: () => ({}),
      isFatal: () => true,
      onReset: (info) => events.push(info),
      resetCooldownMs: 0,
    });
    let calls = 0;
    await h.use(() => {
      calls += 1;
      if (calls === 1) throw new Error('FATAL: first');
      return 'ok';
    });
    expect(events).toHaveLength(1);
    const ev = events[0] as { attempt: number; lastError: Error };
    expect(ev.attempt).toBe(1);
    expect((ev.lastError as Error).message).toBe('FATAL: first');
  });

  it('concurrent uses during initial creation coalesce on a single factory call', async () => {
    let calls = 0;
    const factory = async () => {
      calls += 1;
      await tick();
      return { id: calls };
    };
    const h = new ResilientHandle({ name: 'x', factory, isFatal: () => false });
    const [a, b, c] = await Promise.all([
      h.use((i) => i.id),
      h.use((i) => i.id),
      h.use((i) => i.id),
    ]);
    expect(calls).toBe(1);
    expect([a, b, c]).toEqual([1, 1, 1]);
  });
});
