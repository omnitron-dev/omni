import { describe, it, expect } from 'vitest';
import { FailureTracker } from '../../src/utils/failure-tracker.js';

/**
 * Unit tests for the FailureTracker — the shared spam-suppression
 * primitive used by titan-lock, titan-pm process pools, and any
 * other infrastructure module that emits inside a hot retry loop.
 *
 * The contract under test:
 *   - First failure transitions a category from healthy → failing
 *     and decides `first`.
 *   - Each subsequent failure below the threshold decides
 *     `continuing` with a monotonically-growing count.
 *   - The first failure at-or-above the threshold decides
 *     `persistent` exactly once per streak.
 *   - All failures after that decide `suppress` until recovery.
 *   - The first success closing a streak decides `recovery` once;
 *     further successes return null.
 *   - State is per-category and bounded — categories with no
 *     active failures get swept after `cleanupAfterMs`.
 */

describe('FailureTracker', () => {
  it('decides `first` on the initial failure of a category', () => {
    const t = new FailureTracker({ now: () => 1000 });
    const d = t.recordFailure('k');
    expect(d.level).toBe('first');
    expect(d.count).toBe(1);
    expect(d.elapsedMs).toBe(0);
  });

  it('decides `continuing` for failures 2..N-1 with a growing count', () => {
    let t0 = 1000;
    const t = new FailureTracker({ persistentThreshold: 5, now: () => t0 });
    t.recordFailure('k'); // first
    t0 = 1100;
    const d2 = t.recordFailure('k');
    expect(d2.level).toBe('continuing');
    expect(d2.count).toBe(2);
    expect(d2.elapsedMs).toBe(100);
    t0 = 1500;
    const d3 = t.recordFailure('k');
    expect(d3.level).toBe('continuing');
    expect(d3.count).toBe(3);
    expect(d3.elapsedMs).toBe(500);
  });

  it('decides `persistent` exactly once when the threshold is crossed', () => {
    const t = new FailureTracker({ persistentThreshold: 3, now: () => 0 });
    expect(t.recordFailure('k').level).toBe('first');
    expect(t.recordFailure('k').level).toBe('continuing');
    expect(t.recordFailure('k').level).toBe('persistent');
    expect(t.recordFailure('k').level).toBe('suppress');
    expect(t.recordFailure('k').level).toBe('suppress');
  });

  it('decides `recovery` on the first success after a streak', () => {
    let t0 = 0;
    const t = new FailureTracker({ persistentThreshold: 100, now: () => t0 });
    t.recordFailure('k');
    t0 = 50;
    t.recordFailure('k');
    t0 = 200;
    const r = t.recordSuccess('k');
    expect(r).not.toBeNull();
    expect(r!.level).toBe('recovery');
    expect(r!.count).toBe(2);
    expect(r!.elapsedMs).toBe(200);
  });

  it('returns null for `recordSuccess` when no failure was active', () => {
    const t = new FailureTracker();
    expect(t.recordSuccess('k')).toBeNull();
    expect(t.recordSuccess('k')).toBeNull();
  });

  it('restarts the streak after recovery (next failure is `first` again)', () => {
    const t = new FailureTracker({ persistentThreshold: 2, now: () => 0 });
    t.recordFailure('k');
    t.recordFailure('k');
    t.recordSuccess('k');
    const next = t.recordFailure('k');
    expect(next.level).toBe('first');
    expect(next.count).toBe(1);
  });

  it('isolates state per category', () => {
    const t = new FailureTracker({ persistentThreshold: 2, now: () => 0 });
    expect(t.recordFailure('a').level).toBe('first');
    expect(t.recordFailure('b').level).toBe('first');
    expect(t.recordFailure('a').level).toBe('persistent');
    expect(t.recordFailure('b').level).toBe('persistent');
    expect(t.recordSuccess('a')!.level).toBe('recovery');
    // b is independently still failing
    expect(t.recordFailure('b').level).toBe('suppress');
  });

  it('exposes a snapshot of currently failing categories', () => {
    let t0 = 1000;
    const t = new FailureTracker({ now: () => t0 });
    t.recordFailure('a');
    t.recordFailure('a');
    t.recordFailure('b');
    t0 = 1500;
    const snap = t.snapshot().sort((x, y) => x.category.localeCompare(y.category));
    expect(snap).toEqual([
      { category: 'a', count: 2, elapsedMs: 500 },
      { category: 'b', count: 1, elapsedMs: 500 },
    ]);
  });

  it('clear() forgets all state', () => {
    const t = new FailureTracker();
    t.recordFailure('a');
    t.recordFailure('b');
    t.clear();
    expect(t.snapshot()).toEqual([]);
    // After clear, the next failure on `a` is a fresh `first`.
    expect(t.recordFailure('a').level).toBe('first');
  });

  it('does not double-emit `persistent` if threshold is recrossed without recovery', () => {
    const t = new FailureTracker({ persistentThreshold: 2, now: () => 0 });
    t.recordFailure('k');
    expect(t.recordFailure('k').level).toBe('persistent');
    // Many more failures — none should re-emit persistent.
    for (let i = 0; i < 50; i++) {
      expect(t.recordFailure('k').level).toBe('suppress');
    }
  });
});
