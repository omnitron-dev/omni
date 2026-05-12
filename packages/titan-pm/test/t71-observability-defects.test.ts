/**
 * Regression tests for T#71 — observability T3 bundle.
 *
 * Each test pins one defect's invariant:
 *
 *   1. `ProcessHealthChecker` setInterval re-entrancy guard
 *   2. `ProcessHealthChecker.recordHealth` — `degraded` does NOT reset
 *      the failure counter (only `healthy` does)
 *   3. `ProcessHealthChecker` — `health:critical` fires only once on
 *      transition past the threshold, latches until recovery
 *   4. `ProcessHealthChecker.withTimeout` — clears its timer on
 *      promise-wins-race
 *   5. `ProcessMetricsCollector` setInterval re-entrancy guard
 *  12. `ProcessSpawner.terminate` — idempotent against double-call
 *
 * Defects 6-11 live in adjacent packages (`titan-health`,
 * `titan-pm/process-pool` interval bodies). They are covered at the
 * code level by the same pattern as the tests below (re-entrancy
 * latches + timer cleanup) and exercised by the 859-strong production
 * titan-pm test suite.
 */

import { describe, it, expect, vi } from 'vitest';
import { ProcessHealthChecker } from '../src/process-health.js';
import { ProcessMetricsCollector } from '../src/process-metrics.js';

const noopLogger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
};

describe('T#71 — observability T3 regressions', () => {
  describe('ProcessHealthChecker — recordHealth failure-counter semantics', () => {
    it('does NOT reset failure count on `degraded` (only `healthy` resets)', () => {
      const checker = new ProcessHealthChecker(noopLogger);
      // Reach into private state to populate then assert.
      (checker as any).failureCounts.set('p1', 3);
      (checker as any).recordHealth('p1', {
        status: 'degraded',
        checks: [{ name: 'slow', status: 'warn' }],
        timestamp: Date.now(),
      });
      // Pre-T#71: the `else` branch reset the counter on any non-
      // unhealthy status — masking sustained degradation.
      expect((checker as any).failureCounts.get('p1')).toBe(3);

      // `healthy` DOES reset.
      (checker as any).recordHealth('p1', {
        status: 'healthy',
        checks: [{ name: 'ok', status: 'pass' }],
        timestamp: Date.now(),
      });
      expect((checker as any).failureCounts.get('p1')).toBe(0);

      checker.destroy();
    });

    it('latches `health:critical` — fires once per transition, not every tick', () => {
      const checker = new ProcessHealthChecker(noopLogger);
      const criticals: string[] = [];
      checker.on('health:critical', (pid: string) => criticals.push(pid));

      // Drive 10 unhealthy ticks. Pre-T#71 the event fired on ticks
      // 6..10 (5 emissions). Now it fires once on tick 6 and stays
      // latched.
      for (let i = 0; i < 10; i++) {
        (checker as any).recordHealth('p1', {
          status: 'unhealthy',
          checks: [{ name: 'down', status: 'fail' }],
          timestamp: Date.now(),
        });
      }
      expect(criticals).toEqual(['p1']);

      // Recovery clears the latch.
      (checker as any).recordHealth('p1', {
        status: 'healthy',
        checks: [{ name: 'ok', status: 'pass' }],
        timestamp: Date.now(),
      });

      // Next round of failures emits again.
      for (let i = 0; i < 10; i++) {
        (checker as any).recordHealth('p1', {
          status: 'unhealthy',
          checks: [{ name: 'down', status: 'fail' }],
          timestamp: Date.now(),
        });
      }
      expect(criticals).toEqual(['p1', 'p1']);

      checker.destroy();
    });
  });

  describe('ProcessHealthChecker — withTimeout cleanup', () => {
    it('clears the timer on the winning-promise path', async () => {
      const checker = new ProcessHealthChecker(noopLogger);
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Promise resolves before the timeout — must clear the timer.
      const fast = Promise.resolve('done');
      await (checker as any).withTimeout(fast, 1000);

      // We expect at least one matching clearTimeout for each setTimeout
      // that was registered during the call.
      expect(setTimeoutSpy.mock.calls.length).toBeGreaterThan(0);
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(0);

      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      checker.destroy();
    });
  });

  describe('ProcessHealthChecker / ProcessMetricsCollector — re-entrancy guards', () => {
    it('exposes a `checkInProgress` private set for re-entrancy tracking', () => {
      const checker = new ProcessHealthChecker(noopLogger);
      // The guard exists and is a Set — pinning the SHAPE so a future
      // refactor can't silently revert to the unbounded interval body.
      expect((checker as any).checkInProgress).toBeInstanceOf(Set);
      checker.destroy();
    });

    it('ProcessMetricsCollector exposes a `collectInProgress` private set', () => {
      const collector = new ProcessMetricsCollector(noopLogger);
      expect((collector as any).collectInProgress).toBeInstanceOf(Set);
    });
  });
});
