/**
 * EventLoopWatch — when this daemon's event loop stood still, for how long,
 * and what it was in the middle of.
 *
 * Test node, 2026-09-22 21:17:41–51 UTC: the master's heartbeat `ping` went
 * unanswered for its ten seconds, the master dropped the connection, and a
 * deployment reading its credentials through that drop configured six apps
 * with the wrong password. The master's own loop was running — it logged at
 * 46.2, 49.4 and 50.9 s inside the window — so the silence was the node's,
 * and nothing on the node could say whether its loop had stopped, or for how
 * long, or during what. This is that instrument.
 *
 * Two measurements, for two questions:
 *
 *   - a STALL — the loop not running for longer than `thresholdMs` — is seen
 *     the moment it runs again, by a timer that notices it fired late, and
 *     logged then: with the span it covers and the phases in progress. At the
 *     end of a window the phase would already be the one after;
 *   - the WINDOW — `monitorEventLoopDelay` over the last `windowMs`: p99 and
 *     max, reset each window — is kept for health, where the console reads it.
 *
 * Not «warn when p99 exceeds a second», which was the first idea. A stall is
 * ONE sample in that histogram — sampling every 20 ms, a 1.5 s stall is some
 * seventy-five firings that never happen and one that happens late — so it
 * moves the maximum and leaves the percentile where it was. Measured: one
 * 1.5 s stall in a 4.5 s window, 139 samples, p50 22 ms, p99 25.6 ms, max
 * 1 505.8 ms. A p99 threshold would not have seen the node go quiet.
 *
 * The gap is measured on the monotonic clock. A laptop master that sleeps for
 * an hour has not stalled for an hour, and a wall-clock gap would say it had
 * on every lid it opened. Wall time is used only to name the moments.
 *
 * And each stall says what the PROCESS was doing meanwhile, by the CPU time
 * it used across the gap — which turns «probably starved» into a reading.
 * The first live runs logged ten stalls of 1.1–2.0 s on the dev-laptop master,
 * every one while test suites ran at load 44–73, and the explanation stayed a
 * guess. Measured on that laptop (16 cores), CPU per wall-clock second:
 *
 *     busy-wait on the loop                 0.98   its own work
 *     Atomics.wait / execSync('sleep 1')    0.00   off the CPU
 *     busy-wait + a spinning worker thread  1.93   other threads too
 *
 * `process.cpuUsage()` counts every thread of the process — worker threads,
 * GC helpers, the libuv pool — and no child process. So «off the CPU» is
 * either not being scheduled or WAITING synchronously: a sync spawn's child
 * does its work on another process's account, which is how the `execSync`
 * wedge of 2026-09-14 would read here.
 */

import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'node:perf_hooks';

import { activePhases } from '../project/deploy-phases.js';

export type CpuVerdict = 'off-cpu' | 'on-cpu' | 'on-cpu-in-parallel';

/**
 * What the CPU time across a stall says about it. The bounds sit between the
 * calibration points above: 0.00, 0.98 and 1.93.
 */
export function cpuVerdict(cpuMs: number, stalledMs: number): CpuVerdict {
  const share = stalledMs > 0 ? cpuMs / stalledMs : 0;
  if (share < 0.5) return 'off-cpu';
  if (share <= 1.2) return 'on-cpu';
  return 'on-cpu-in-parallel';
}

/** The verdict in words, with the figure it rests on. */
export function describeCpu(stall: Pick<EventLoopStall, 'cpuMs' | 'cpu'>): string {
  if (stall.cpu === 'off-cpu') {
    return `off the CPU for most of it (${stall.cpuMs} ms of CPU): not scheduled, or waiting synchronously — a sync spawn, sync I/O`;
  }
  if (stall.cpu === 'on-cpu') {
    return `on the CPU for most of it (${stall.cpuMs} ms of CPU): its own synchronous work or a GC pause`;
  }
  return `more CPU than wall time (${stall.cpuMs} ms): other threads of this process — GC helpers, workers, the libuv pool — ran alongside`;
}

export interface EventLoopStall {
  /** The last moment the loop was seen running. */
  from: string;
  /** When it ran again. */
  to: string;
  /** Between the two: how long nothing on this loop ran, a timer included. */
  stalledMs: number;
  /** What this process was in the middle of — empty when nothing had a name. */
  phases: string[];
  /** CPU time this process used across the gap, every thread of it. */
  cpuMs: number;
  cpu: CpuVerdict;
}

export interface EventLoopWindow {
  from: string;
  to: string;
  p99Ms: number;
  maxMs: number;
  samples: number;
}

export interface EventLoopWatchOptions {
  /** A stall longer than this is logged. */
  thresholdMs?: number;
  /** How often the histogram is read and reset. */
  windowMs?: number;
  /** How often the watch checks that it is still being run. */
  tickMs?: number;
  /** What is in progress, asked at the moment a stall ends. */
  phases?: () => string[];
}

interface WarnLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const round = (ms: number) => Math.round(ms * 10) / 10;

export class EventLoopWatch {
  readonly thresholdMs: number;
  private readonly windowMs: number;
  private readonly tickMs: number;
  private readonly phases: () => string[];

  private histogram: IntervalHistogram | null = null;
  private ticker: NodeJS.Timeout | null = null;
  private windowTimer: NodeJS.Timeout | null = null;
  /** `performance.now()` at the last tick — monotonic, see above. */
  private lastTick = 0;
  /** `process.cpuUsage()` at the last tick. */
  private lastCpu: NodeJS.CpuUsage = { user: 0, system: 0 };
  private windowFrom = 0;

  private lastWindow: EventLoopWindow | null = null;
  private lastStall: EventLoopStall | null = null;
  private longestStall: EventLoopStall | null = null;
  private stallCount = 0;

  constructor(
    private readonly logger: WarnLogger,
    options: EventLoopWatchOptions = {},
  ) {
    this.thresholdMs = options.thresholdMs ?? 1_000;
    this.windowMs = options.windowMs ?? 10_000;
    this.tickMs = options.tickMs ?? 100;
    this.phases = options.phases ?? activePhases;
  }

  start(): void {
    if (this.ticker) return;
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
    this.lastTick = performance.now();
    this.lastCpu = process.cpuUsage();
    this.windowFrom = Date.now();
    this.ticker = setInterval(() => this.tick(), this.tickMs);
    this.windowTimer = setInterval(() => this.closeWindow(), this.windowMs);
    // An instrument must never be the reason a process stays up.
    this.ticker.unref();
    this.windowTimer.unref();
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (this.windowTimer) clearInterval(this.windowTimer);
    this.ticker = null;
    this.windowTimer = null;
    this.histogram?.disable();
    this.histogram = null;
  }

  /** What health reports: the last window, and the stalls since start. */
  snapshot(): {
    thresholdMs: number;
    window: EventLoopWindow | null;
    stalls: number;
    lastStall: EventLoopStall | null;
    longestStall: EventLoopStall | null;
  } {
    return {
      thresholdMs: this.thresholdMs,
      window: this.lastWindow,
      stalls: this.stallCount,
      lastStall: this.lastStall,
      longestStall: this.longestStall,
    };
  }

  private tick(): void {
    const now = performance.now();
    const gap = now - this.lastTick;
    this.lastTick = now;
    const cpuNow = process.cpuUsage();
    const cpuMs = Math.round((cpuNow.user - this.lastCpu.user + cpuNow.system - this.lastCpu.system) / 1000);
    this.lastCpu = cpuNow;
    // Late by more than the threshold: the timer's own period is not a stall.
    if (gap - this.tickMs <= this.thresholdMs) return;

    const wallNow = Date.now();
    const stalledMs = Math.round(gap);
    const stall: EventLoopStall = {
      from: new Date(wallNow - gap).toISOString(),
      to: new Date(wallNow).toISOString(),
      stalledMs,
      phases: this.phases(),
      cpuMs,
      cpu: cpuVerdict(cpuMs, stalledMs),
    };
    this.stallCount += 1;
    this.lastStall = stall;
    if (!this.longestStall || stall.stalledMs > this.longestStall.stalledMs) this.longestStall = stall;

    this.logger.warn(
      { ...stall, thresholdMs: this.thresholdMs },
      'The event loop stood still — nothing on this daemon ran meanwhile: no RPC answered, no heartbeat returned',
    );
  }

  /** Read the window and start the next one. Public for the court, which cannot wait ten seconds. */
  closeWindow(): EventLoopWindow | null {
    const histogram = this.histogram;
    if (!histogram) return null;
    const now = Date.now();
    this.lastWindow = {
      from: new Date(this.windowFrom).toISOString(),
      to: new Date(now).toISOString(),
      p99Ms: round(histogram.percentile(99) / 1e6),
      maxMs: round(histogram.max / 1e6),
      samples: histogram.count,
    };
    this.windowFrom = now;
    // Per window, not since start: one stall an hour ago is not this minute's
    // maximum, and a figure that never falls says nothing after its first rise.
    histogram.reset();
    return this.lastWindow;
  }
}
