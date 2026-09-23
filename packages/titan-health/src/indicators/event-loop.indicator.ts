/**
 * Event Loop Health Indicator
 *
 * How the event loop has run over the last minute.
 *
 * This used to ask at the moment of the check: a 50 ms timer, and how late it
 * fired. An event loop that can answer a health check is not blocked at that
 * moment, so the answer was always the same — «lag: 0.00ms» on the omnitron
 * test node while its event-loop watch measured p99 20.9 ms beside it, and on
 * the master 139 stalls of 1 to 4.6 s in forty minutes read «responsive». It
 * measured the one instant in which nothing could be wrong.
 *
 * Now `monitorEventLoopDelay` runs all the time, and the check reads what it
 * recorded over the last minute — six buckets of ten seconds, each reset as it
 * rolls: p99 for a loop that is slow, max for one that stopped. A stall is ONE
 * sample in that histogram (the timer that should have fired many times fires
 * once, late), so it moves the maximum and not the percentile; each has its
 * own threshold.
 *
 * There was a second class here, `HighResEventLoopIndicator`, reading the
 * same histogram since the process started and never resetting it — a p99
 * since boot, which no stall of this minute can move. Nothing used it. One
 * concept, one indicator.
 *
 * @module titan/modules/health/indicators
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';

import { HealthIndicator } from '../health.indicator.js';
import type { HealthIndicatorResult, EventLoopThresholds } from '../health.types.js';

const DEFAULT_THRESHOLDS: Required<EventLoopThresholds> = {
  lagDegradedThreshold: 50,
  lagUnhealthyThreshold: 100,
  stallThreshold: 1_000,
};

/** The part of `IntervalHistogram` this reads — nanoseconds, like the original. */
export interface EventLoopDelayHistogram {
  percentile(percentile: number): number;
  readonly max: number;
  readonly count: number;
  reset(): void;
  enable(): boolean;
  disable(): boolean;
}

export interface EventLoopIndicatorOptions {
  /** The width of one bucket. */
  bucketMs?: number;
  /** How many buckets make the window, the live one included. */
  buckets?: number;
  /** The histogram to read — a court cannot stall a loop at every percentile it needs. */
  histogram?: EventLoopDelayHistogram;
  /** The clock the window is measured on. */
  now?: () => number;
}

interface Bucket {
  from: number;
  p99: number;
  max: number;
  samples: number;
}

const ms = (value: number) => `${value.toFixed(1)}ms`;

export class EventLoopHealthIndicator extends HealthIndicator {
  readonly name = 'event-loop';
  private thresholds: Required<EventLoopThresholds>;
  private readonly histogram: EventLoopDelayHistogram;
  private readonly keep: number;
  private readonly now: () => number;
  private readonly timer: NodeJS.Timeout;
  private closed: Bucket[] = [];
  private liveFrom: number;

  constructor(thresholds: EventLoopThresholds = {}, options: EventLoopIndicatorOptions = {}) {
    super();
    this.thresholds = {
      lagDegradedThreshold: thresholds.lagDegradedThreshold ?? DEFAULT_THRESHOLDS.lagDegradedThreshold,
      lagUnhealthyThreshold: thresholds.lagUnhealthyThreshold ?? DEFAULT_THRESHOLDS.lagUnhealthyThreshold,
      stallThreshold: thresholds.stallThreshold ?? DEFAULT_THRESHOLDS.stallThreshold,
    };
    this.keep = Math.max(1, options.buckets ?? 6);
    this.now = options.now ?? Date.now;
    this.histogram = options.histogram ?? monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
    this.liveFrom = this.now();
    this.timer = setInterval(() => this.roll(), options.bucketMs ?? 10_000);
    // A health indicator must never be the reason a process stays up.
    this.timer.unref?.();
  }

  /** Close the live bucket and open the next. Public so a court can roll without waiting. */
  roll(): void {
    this.closed.push(this.read());
    if (this.closed.length > this.keep - 1) this.closed.shift();
    this.histogram.reset();
    this.liveFrom = this.now();
  }

  async check(): Promise<HealthIndicatorResult> {
    const start = Date.now();
    const buckets = [...this.closed, this.read()];
    const samples = buckets.reduce((n, b) => n + b.samples, 0);
    const p99 = Math.max(...buckets.map((b) => b.p99));
    const max = Math.max(...buckets.map((b) => b.max));
    const windowS = Math.max(1, Math.round((this.now() - buckets[0]!.from) / 1000));
    const over = `over the last ${windowS} s`;
    const details = {
      window: `${windowS}s`,
      samples,
      p99: ms(p99),
      max: ms(max),
      thresholds: {
        degraded: this.thresholds.lagDegradedThreshold + 'ms',
        unhealthy: this.thresholds.lagUnhealthyThreshold + 'ms',
        stall: this.thresholds.stallThreshold + 'ms',
      },
    };
    const result = (() => {
      if (samples === 0) return this.healthy(`No event loop samples yet ${over}`, details);
      if (p99 >= this.thresholds.lagUnhealthyThreshold) {
        return this.unhealthy(`Event loop p99 ${ms(p99)} ${over} exceeds the unhealthy threshold`, details);
      }
      if (p99 >= this.thresholds.lagDegradedThreshold) {
        return this.degraded(`Event loop p99 ${ms(p99)} ${over} exceeds the degraded threshold`, details);
      }
      if (max >= this.thresholds.stallThreshold) {
        return this.degraded(`The event loop stood still for ${ms(max)} ${over} (p99 ${ms(p99)})`, details);
      }
      return this.healthy(`Event loop ${over}: p99 ${ms(p99)}, max ${ms(max)}`, details);
    })();
    return { ...result, latency: Date.now() - start };
  }

  /** Stop measuring. The timer is unref'd, so this is for tests and orderly shutdowns. */
  dispose(): void {
    clearInterval(this.timer);
    this.histogram.disable();
  }

  getThresholds(): Required<EventLoopThresholds> {
    return { ...this.thresholds };
  }

  setThresholds(thresholds: Partial<EventLoopThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  private read(): Bucket {
    const h = this.histogram;
    const any = h.count > 0;
    return { from: this.liveFrom, p99: any ? h.percentile(99) / 1e6 : 0, max: any ? h.max / 1e6 : 0, samples: h.count };
  }
}
