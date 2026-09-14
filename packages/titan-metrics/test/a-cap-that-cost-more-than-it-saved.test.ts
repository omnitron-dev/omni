/**
 * The collector's buffer cap made every record past the cap O(n).
 *
 *     this.buffer.push(sample);
 *     if (this.buffer.length > CAP) {
 *       const overflow = this.buffer.length - CAP;   // always 1
 *       this.buffer.splice(0, overflow);
 *     }
 *
 * Pushes arrive one at a time, so `overflow` is always 1 and each call moved
 * all 50,000 remaining elements down by one slot. Measured: 132µs per record
 * once the cap engages, against well under a microsecond below it — a factor
 * of several hundred, on the path every module records through.
 *
 * The timing is what makes it a defect rather than an inefficiency. The cap
 * exists for a stalled `MetricsService.flush()` — a storage outage, a GC
 * pause, a slow sync to master. That stall is exactly when the buffer reaches
 * the cap, so the protection against a stalled flusher turned into a stall of
 * its own, at the moment the process was already in trouble.
 *
 * It was found by a test timing out rather than failing: the T#70 regression
 * test pushes 60,000 samples and asserts the cap holds, and it took 6.9
 * seconds against vitest's 5-second budget. The assertions it makes were
 * right; the implementation could not reach them in time.
 *
 * The replacement is a ring: the array grows to the cap and then writes land
 * on the oldest slot. Same policy — newest `CAP` retained, oldest dropped,
 * `totalDropped` counting the losses — at O(1) per record. This file pins the
 * policy, because a ring is easy to get subtly wrong at the wrap, and the
 * error would be silent: a dashboard rendering samples in the wrong order or
 * missing a window is not a crash.
 */
import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '../src/collector.js';
import { MetricsRegistry } from '../src/registry.js';

const CAP = 50_000;

function collector(): MetricsCollector {
  return new MetricsCollector(
    new MetricsRegistry(),
    'test',
    { enabled: true, interval: 1_000_000, process: false, system: false, rpc: false, custom: false },
    null,
  );
}

function feed(c: MetricsCollector, n: number, from = 0): void {
  for (let i = from; i < from + n; i++) {
    c.record({ name: 'rpc_calls', value: 1, timestamp: i, labels: { app: 'x' } });
  }
}

describe('below the cap nothing is dropped or reordered', () => {
  it('returns every sample in order', () => {
    const c = collector();
    feed(c, 1_000);
    const out = c.drain();
    expect(out).toHaveLength(1_000);
    expect(out[0]!.timestamp).toBe(0);
    expect(out[999]!.timestamp).toBe(999);
    expect(c.totalDropped).toBe(0);
  });

  it('a buffer filled exactly to the cap drops nothing', () => {
    // The boundary the ring switches on. One off here would drop a sample
    // that fits, or fail to drop one that does not.
    const c = collector();
    feed(c, CAP);
    const out = c.drain();
    expect(out).toHaveLength(CAP);
    expect(out[0]!.timestamp).toBe(0);
    expect(out[CAP - 1]!.timestamp).toBe(CAP - 1);
    expect(c.totalDropped).toBe(0);
  });
});

describe('above the cap the oldest go, in order, and are counted', () => {
  it('one sample past the cap drops exactly the first', () => {
    const c = collector();
    feed(c, CAP + 1);
    const out = c.drain();
    expect(out).toHaveLength(CAP);
    expect(out[0]!.timestamp).toBe(1);
    expect(out[CAP - 1]!.timestamp).toBe(CAP);
    expect(c.totalDropped).toBe(1);
  });

  it('a full wrap keeps the newest window in order', () => {
    const c = collector();
    feed(c, CAP * 2);
    const out = c.drain();
    expect(out).toHaveLength(CAP);
    expect(out[0]!.timestamp).toBe(CAP);
    expect(out[CAP - 1]!.timestamp).toBe(CAP * 2 - 1);
    expect(c.totalDropped).toBe(CAP);
    // Strictly increasing across the wrap point — the property a splice gave
    // for free and a ring has to earn.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.timestamp).toBe(out[i - 1]!.timestamp! + 1);
    }
  });

  it('draining resets the ring, so the next window starts clean', () => {
    const c = collector();
    feed(c, CAP + 10);
    c.drain();
    feed(c, 5, 1_000_000);
    const out = c.drain();
    expect(out).toHaveLength(5);
    expect(out[0]!.timestamp).toBe(1_000_000);
    // The drop counter is cumulative since startup and must NOT reset: it is
    // the diagnostic that says a flusher stalled.
    expect(c.totalDropped).toBe(10);
  });
});

describe('the cost does not depend on how full the buffer is', () => {
  it('records past the cap cost about what records below it cost', () => {
    // The defect stated as a measurement. The old form was ~132µs per record
    // above the cap and sub-microsecond below — a ratio in the hundreds. The
    // bound here is deliberately loose (40x) so this is a regression alarm
    // for the algorithm, not a benchmark that fails on a busy machine.
    const warm = collector();
    feed(warm, CAP);

    const cold = collector();
    const t0 = process.hrtime.bigint();
    feed(cold, 10_000);
    const below = Number(process.hrtime.bigint() - t0);

    const t1 = process.hrtime.bigint();
    feed(warm, 10_000, CAP);
    const above = Number(process.hrtime.bigint() - t1);

    expect(above).toBeLessThan(below * 40);
  });
});
