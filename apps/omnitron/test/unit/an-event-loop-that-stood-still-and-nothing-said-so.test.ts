/**
 * An event loop that stood still, and nothing said so.
 *
 * Test node, 2026-09-22 21:17:41–51 UTC: the master's heartbeat went
 * unanswered for ten seconds and the master dropped the connection mid-
 * deployment. The master's own loop was running — it logged inside the
 * window — so the silence was the node's, and the node had no instrument
 * that could say its loop had stopped, for how long, or during what.
 *
 * The watch is run here on this process's real loop, stopped for real with a
 * busy wait. What the machine itself does to the loop is not ours to decide —
 * a suite under load can stop it too — so the cases that claim silence ask an
 * independent 10 ms timer what it saw, and when the machine did stall the
 * loop past the threshold, they require the warning instead: then it is true.
 */

import { performance } from 'node:perf_hooks';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { EventLoopWatch } from '../../src/monitoring/event-loop-watch.js';
import { EventLoopStallIndicator } from '../../src/monitoring/event-loop-stall.indicator.js';
import { activePhases, duringPhase, reportPhases } from '../../src/project/deploy-phases.js';

const THRESHOLD = 1_000;

/** Stop this loop for `ms`, as synchronous work does. */
const busy = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // the loop stands still here
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The longest gap an independent 10 ms timer saw while `run` ran. */
async function independentGap(run: () => Promise<void>): Promise<number> {
  let last = performance.now();
  let max = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
  }, 10);
  try {
    await run();
  } finally {
    clearInterval(timer);
  }
  return Math.max(max, performance.now() - last);
}

const watches: EventLoopWatch[] = [];
afterEach(() => {
  for (const w of watches.splice(0)) w.stop();
  vi.restoreAllMocks();
});

function watch(options: { windowMs?: number } = {}) {
  const warns: Array<{ fields: Record<string, unknown>; msg: string }> = [];
  const w = new EventLoopWatch(
    { warn: (fields, msg) => void warns.push({ fields, msg }) },
    { thresholdMs: THRESHOLD, tickMs: 50, windowMs: options.windowMs ?? 60_000 },
  );
  watches.push(w);
  w.start();
  return { w, warns };
}

describe('an event loop that stood still', () => {
  it('is said as soon as the loop runs again — for how long, from when, and during what', async () => {
    const { w, warns } = watch();

    await duringPhase('daos/test: reading credentials from 10.0.0.9', async () => {
      busy(1_300);
      await sleep(150);
    });

    // Within 150 ms of the loop running again, and the window is a minute
    // long: a warning read off the window would not exist yet — and would
    // name whatever phase came after.
    expect(warns).toHaveLength(1);
    const stall = warns[0]!.fields as { stalledMs: number; from: string; to: string; phases: string[] };
    expect(stall.stalledMs).toBeGreaterThanOrEqual(1_300);
    expect(stall.phases).toEqual(['daos/test: reading credentials from 10.0.0.9']);
    expect(Date.parse(stall.to) - Date.parse(stall.from)).toBeGreaterThanOrEqual(1_300);

    // And health says it, in words the console shows.
    const health = await new EventLoopStallIndicator(w).check();
    expect(health.status).toBe('degraded');
    expect(health.message).toMatch(/stood still for \d+ ms .* during daos\/test: reading credentials from 10\.0\.0\.9/);
    expect((health.details as { stalls: number }).stalls).toBe(1);
  });

  it('is not a stall when it is shorter than the threshold', async () => {
    const { warns } = watch();

    const gap = await independentGap(async () => {
      busy(300);
      await sleep(100);
    });

    if (gap - 50 <= THRESHOLD) expect(warns).toEqual([]);
    else expect(warns.length, `the machine itself held the loop ${Math.round(gap)} ms`).toBeGreaterThan(0);
  });

  it('says nothing on an idle loop, and health says there was nothing', async () => {
    const { w, warns } = watch({ windowMs: 100 });

    const gap = await independentGap(() => sleep(500));

    if (gap - 50 <= THRESHOLD) {
      expect(warns).toEqual([]);
      const health = await new EventLoopStallIndicator(w).check();
      expect(health.status).toBe('healthy');
      expect(health.message).toMatch(/^No stall over 1000 ms since start; last window p99 [\d.]+ ms, max [\d.]+ ms$/);
    } else {
      expect(warns.length, `the machine itself held the loop ${Math.round(gap)} ms`).toBeGreaterThan(0);
    }
  });

  it('does not call a clock that jumped a stalled loop', async () => {
    // A laptop master that slept an hour, or a clock NTP corrected: the wall
    // moves, the loop did not stop. Only the monotonic clock can tell.
    const { warns } = watch();
    const real = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => real() + 3_600_000);

    const gap = await independentGap(() => sleep(300));

    if (gap - 50 <= THRESHOLD) expect(warns).toEqual([]);
  });
});

describe('the window health reads', () => {
  it('holds a stall in its own window and not in the next', async () => {
    const { w } = watch();
    // The histogram's first firing only sets its baseline, so a stall before
    // it is not recorded (measured: 1.2 s right after `enable()` — max 32.9
    // ms; after 100 ms of running — 1 236.3 ms). The watch's own stalls come
    // from its ticker, which has its baseline from `start()`.
    await sleep(100);

    busy(1_200);
    await sleep(60);
    const stalled = w.closeWindow()!;
    expect(stalled.maxMs).toBeGreaterThanOrEqual(1_200);

    const gap = await independentGap(() => sleep(150));
    const next = w.closeWindow()!;
    expect(next.samples).toBeGreaterThan(0);
    // Reset per window: a figure that never falls says nothing after it rises.
    if (gap - 50 <= THRESHOLD) expect(next.maxMs).toBeLessThan(THRESHOLD);
  });

  it('reports the stalls since start after the degraded spell is over', async () => {
    const { w } = watch();
    busy(1_200);
    await sleep(100);

    // No longer recent: healthy, and still counting.
    const health = await new EventLoopStallIndicator(w, 0).check();
    expect(health.status).toBe('healthy');
    expect(health.message).toMatch(/^1 stall\(s\) over 1000 ms since start, the longest \d+ ms at /);
  });
});

describe('the phase a stall is named by', () => {
  it('is a deployment\'s current phase, by whose deployment it is, for as long as it runs', () => {
    const phases = reportPhases({ info() {} }, { project: 'daos', stack: 'test' });

    phases.enter('reading credentials from 10.0.0.9');
    expect(activePhases()).toEqual(['daos/test: reading credentials from 10.0.0.9']);
    phases.enter('delivering 6 artifact(s) to 10.0.0.9');
    expect(activePhases()).toEqual(['daos/test: delivering 6 artifact(s) to 10.0.0.9']);
    phases.done();
    expect(activePhases()).toEqual([]);
  });

  it('is gone when work run as a phase ends, thrown or not', async () => {
    await expect(
      duringPhase('provisioning daos/test for the master', async () => {
        expect(activePhases()).toEqual(['provisioning daos/test for the master']);
        throw new Error('docker: no space left on device');
      }),
    ).rejects.toThrow(/no space left/);
    expect(activePhases()).toEqual([]);
  });
});
