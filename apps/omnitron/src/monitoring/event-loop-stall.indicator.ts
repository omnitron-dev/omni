/**
 * EventLoopStallIndicator — the event-loop watch, as health reports it.
 *
 * The console asks every node for its titan-health indicators, so this is
 * where a node that went quiet can say so after the fact: `degraded` while
 * its last stall is recent, with the length and the phase in the message,
 * and the numbers — the last window's p99 and max, the stalls since start
 * and the longest of them — in the details for as long as the daemon runs.
 *
 * Beside titan-health's own `event-loop` indicator, not instead of it. That
 * one measures the loop at the moment it is asked, which is the one moment a
 * stall cannot be happening: the question was answered.
 */

import { HealthIndicator, type HealthIndicatorResult } from '@omnitron-dev/titan-health';

import type { EventLoopWatch } from './event-loop-watch.js';

export class EventLoopStallIndicator extends HealthIndicator {
  readonly name = 'event-loop-stalls';

  constructor(
    private readonly watch: Pick<EventLoopWatch, 'snapshot'>,
    /** How long after a stall the daemon still reports `degraded`. */
    private readonly recentMs = 5 * 60_000,
  ) {
    super();
  }

  async check(): Promise<HealthIndicatorResult> {
    const s = this.watch.snapshot();
    const details = {
      thresholdMs: s.thresholdMs,
      window: s.window,
      stalls: s.stalls,
      lastStall: s.lastStall,
      longestStall: s.longestStall,
    };
    const window = s.window ? `last window p99 ${s.window.p99Ms} ms, max ${s.window.maxMs} ms` : 'no window read yet';

    const last = s.lastStall;
    if (last && Date.now() - Date.parse(last.to) < this.recentMs) {
      const during = last.phases.length > 0 ? `, during ${last.phases.join('; ')}` : '';
      return this.degraded(
        `The event loop stood still for ${last.stalledMs} ms at ${last.to}${during} — ${s.stalls} stall(s) over ${s.thresholdMs} ms since start; ${window}`,
        details,
      );
    }

    return this.healthy(
      s.stalls === 0
        ? `No stall over ${s.thresholdMs} ms since start; ${window}`
        : `${s.stalls} stall(s) over ${s.thresholdMs} ms since start, the longest ${s.longestStall?.stalledMs} ms at ${s.longestStall?.to}; ${window}`,
      details,
    );
  }
}
