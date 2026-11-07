/**
 * An event loop indicator that measured the one instant nothing could be wrong.
 *
 * It scheduled a 50 ms timer when asked and reported how late it fired. A loop
 * that can answer a health check is not blocked at that moment, so the answer
 * was «lag: 0.00ms» — on the omnitron test node while its own watch measured
 * p99 20.9 ms, and on a master whose loop had stood still 139 times in forty
 * minutes. Now it reads what `monitorEventLoopDelay` recorded over the last
 * minute: p99 for a slow loop, max for a stopped one.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { EventLoopHealthIndicator, type EventLoopDelayHistogram } from '../src/indicators/event-loop.indicator.js';
import * as health from '../src/index.js';

const made: EventLoopHealthIndicator[] = [];
afterEach(() => {
  for (const i of made.splice(0)) i.dispose();
});

const indicator = (...args: ConstructorParameters<typeof EventLoopHealthIndicator>) => {
  const i = new EventLoopHealthIndicator(...args);
  made.push(i);
  return i;
};

/** A histogram whose next reading is whatever the case says, in milliseconds. */
function scripted() {
  let reading = { p99: 0, max: 0, count: 0 };
  const h: EventLoopDelayHistogram = {
    percentile: () => reading.p99 * 1e6,
    get max() { return reading.max * 1e6; },
    get count() { return reading.count; },
    reset: () => { reading = { p99: 0, max: 0, count: 0 }; },
    enable: () => true,
    disable: () => true,
  };
  return { h, set: (r: { p99: number; max: number; count: number }) => { reading = r; } };
}

describe('an event loop indicator that measured the one instant nothing could be wrong', () => {
  it('sees a stall that happened between two checks', async () => {
    const i = indicator();
    const { stallThreshold } = i.getThresholds();
    await vi.waitFor(async () => expect(Number((await i.check()).details?.['samples'])).toBeGreaterThan(0));

    // Block the real loop past the configured threshold without spinning a CPU.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stallThreshold + 200);
    const result = await vi.waitFor(async () => {
      const sample = await i.check();
      expect(Number.parseFloat(String(sample.details?.['max']))).toBeGreaterThanOrEqual(stallThreshold);
      return sample;
    });
    expect(result.status).not.toBe('healthy');
    // Which threshold says it depends on how many samples the window holds: a
    // stall is one sample, so it IS the p99 of a window of a few — as here,
    // a second after start — and leaves the p99 of a minute's hundreds alone.
    const samples = Number(result.details?.['samples']);
    if (samples >= 100 && Number.parseFloat(String(result.details?.['p99'])) < 50) {
      expect(result.message).toMatch(/^The event loop stood still for \d{4,}\.\dms over the last \d+ s/);
    }
  });

  it('reads a stall among a minute of samples as a stall, not as lag', async () => {
    const s = scripted();
    const i = indicator({}, { histogram: s.h });

    s.set({ p99: 22, max: 1_474, count: 2_900 });
    const result = await i.check();

    expect(result.status).toBe('degraded');
    expect(result.message).toMatch(/^The event loop stood still for 1474\.0ms over the last \d+ s \(p99 22\.0ms\)$/);
  });

  it('calls a loop whose p99 is high slow, by the lag thresholds', async () => {
    const s = scripted();
    const i = indicator({}, { histogram: s.h });

    s.set({ p99: 60, max: 80, count: 500 });
    expect((await i.check()).status).toBe('degraded');
    s.set({ p99: 120, max: 130, count: 500 });
    expect((await i.check()).status).toBe('unhealthy');
  });

  it('keeps a stall for its window and lets it go after', async () => {
    const s = scripted();
    const i = indicator({}, { histogram: s.h, buckets: 3 });

    s.set({ p99: 20, max: 1_500, count: 500 });
    i.roll();
    s.set({ p99: 20, max: 30, count: 500 });
    expect((await i.check()).status, 'the stall is inside the window').toBe('degraded');

    i.roll();
    i.roll();
    expect((await i.check()).status, 'three buckets later it is not').toBe('healthy');
  });

  it('says there is nothing to say before the first sample', async () => {
    const s = scripted();
    const result = await indicator({}, { histogram: s.h }).check();

    expect(result.status).toBe('healthy');
    expect(result.message).toMatch(/^No event loop samples yet/);
  });

  it('is the only event-loop indicator titan-health offers', () => {
    expect(Object.keys(health).filter((k) => /EventLoop.*Indicator/.test(k))).toEqual(['EventLoopHealthIndicator']);
  });
});
