/**
 * Regression tests for the infra restart circuit-breaker backoff schedule.
 *
 * Context: during the 2026-05 outage a single infra container (nominatim)
 * that could not be (re)created was retried by the health sweep every 30s
 * forever ("Service not running — auto-restarting" / "Auto-restart failed").
 * That unbounded churn — docker calls + error logging on every tick —
 * contributed to wedging the daemon's event loop until an external
 * "socket unreachable → SIGTERM" killed the whole daemon.
 *
 * `restartBackoffMs` is the fix: each consecutive failed restart waits
 * exponentially longer before the next attempt, capped so a permanently
 * broken service settles into an occasional retry rather than a hot loop.
 */

import { describe, it, expect } from 'vitest';
import { restartBackoffMs } from '../../src/infrastructure/infrastructure.service.js';

describe('restartBackoffMs — infra restart circuit-breaker', () => {
  it('starts at 30s for the first failure', () => {
    expect(restartBackoffMs(1)).toBe(30_000);
  });

  it('doubles on each consecutive failure', () => {
    expect(restartBackoffMs(2)).toBe(60_000);
    expect(restartBackoffMs(3)).toBe(120_000);
    expect(restartBackoffMs(4)).toBe(240_000);
    expect(restartBackoffMs(5)).toBe(480_000);
  });

  it('caps at 15 minutes so a broken service never hammers the supervisor', () => {
    // 2^5 * 30s = 16min would exceed the cap; everything beyond clamps.
    expect(restartBackoffMs(6)).toBe(15 * 60_000);
    expect(restartBackoffMs(50)).toBe(15 * 60_000);
    expect(restartBackoffMs(1000)).toBe(15 * 60_000);
  });

  it('is monotonically non-decreasing', () => {
    let prev = 0;
    for (let f = 1; f <= 20; f++) {
      const cur = restartBackoffMs(f);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  it('treats a zero/negative failure count as no backoff', () => {
    expect(restartBackoffMs(0)).toBe(0);
    expect(restartBackoffMs(-3)).toBe(0);
  });
});
