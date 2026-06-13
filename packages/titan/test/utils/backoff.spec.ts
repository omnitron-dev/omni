import { describe, it, expect } from 'vitest';
import { computeBackoff } from '../../src/utils/backoff.js';

describe('computeBackoff', () => {
  it('returns baseMs for attempt 0', () => {
    expect(computeBackoff({ attempt: 0, baseMs: 100, maxMs: 10_000 })).toBe(100);
  });

  it('doubles for each attempt by default (factor=2)', () => {
    const opts = { baseMs: 100, maxMs: 1_000_000 };
    expect(computeBackoff({ ...opts, attempt: 1 })).toBe(200);
    expect(computeBackoff({ ...opts, attempt: 2 })).toBe(400);
    expect(computeBackoff({ ...opts, attempt: 3 })).toBe(800);
    expect(computeBackoff({ ...opts, attempt: 10 })).toBe(102_400);
  });

  it('caps at maxMs', () => {
    expect(computeBackoff({ attempt: 100, baseMs: 100, maxMs: 5_000 })).toBe(5_000);
  });

  it('respects configurable factor (factor=3)', () => {
    expect(computeBackoff({ attempt: 2, baseMs: 100, maxMs: 100_000, factor: 3 })).toBe(900);
  });

  it('grows monotonically until cap', () => {
    let prev = -1;
    let capped = false;
    for (let i = 0; i < 20; i++) {
      const d = computeBackoff({ attempt: i, baseMs: 100, maxMs: 5_000 });
      if (d === 5_000 && capped) {
        // Stays capped — also monotonic in the weak sense.
        expect(d).toBeGreaterThanOrEqual(prev);
      } else {
        expect(d).toBeGreaterThanOrEqual(prev);
        if (d === 5_000) capped = true;
      }
      prev = d;
    }
  });

  it('treats negative attempt as 0', () => {
    expect(computeBackoff({ attempt: -5, baseMs: 100, maxMs: 10_000 })).toBe(100);
  });

  it('treats non-integer attempt by floor', () => {
    expect(computeBackoff({ attempt: 2.9, baseMs: 100, maxMs: 100_000 })).toBe(400); // floor(2.9)=2 → 400
  });

  it('handles base 0 cleanly', () => {
    expect(computeBackoff({ attempt: 5, baseMs: 0, maxMs: 10_000 })).toBe(0);
  });

  it('adds jitter within [0, jitter*delay)', () => {
    const samples = Array.from({ length: 1000 }, () =>
      computeBackoff({ attempt: 1, baseMs: 100, maxMs: 100_000, jitter: 0.5 })
    );
    // Without jitter the value is 200; with 0.5 jitter the
    // upper bound is 300 (exclusive).
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(200);
      expect(s).toBeLessThan(300);
    }
    // And the sampling should spread — not all identical.
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(100);
  });

  it('produces deterministic output when given a deterministic RNG', () => {
    const random = () => 0.5; // midpoint of jitter range
    const d = computeBackoff({
      attempt: 1,
      baseMs: 100,
      maxMs: 100_000,
      jitter: 0.3,
      random,
    });
    expect(d).toBe(200 + 200 * 0.3 * 0.5); // 230
  });

  it('clamps jitter > 1 to 1', () => {
    const random = () => 0.999;
    const d = computeBackoff({
      attempt: 0,
      baseMs: 100,
      maxMs: 10_000,
      jitter: 999, // wildly out of range
      random,
    });
    // jitter clamped to 1 → upper bound = 100 + 100 = 200
    expect(d).toBeLessThanOrEqual(200);
  });

  it('clamps jitter < 0 to 0', () => {
    const d = computeBackoff({
      attempt: 1,
      baseMs: 100,
      maxMs: 10_000,
      jitter: -1,
    });
    expect(d).toBe(200); // no jitter applied
  });

  it('falls back to factor=2 for invalid factor', () => {
    expect(computeBackoff({ attempt: 2, baseMs: 100, maxMs: 100_000, factor: NaN })).toBe(400);
    expect(computeBackoff({ attempt: 2, baseMs: 100, maxMs: 100_000, factor: 0 })).toBe(400);
    expect(computeBackoff({ attempt: 2, baseMs: 100, maxMs: 100_000, factor: -1 })).toBe(400);
  });

  describe("jitterMode 'centered' (netron reconnect shape, RESILIENCE-UNIFY)", () => {
    const base = { attempt: 1, baseMs: 100, maxMs: 100_000, jitter: 0.5, jitterMode: 'centered' as const };

    it('random=0.5 → no offset (mean stays at the exponential value)', () => {
      // jittered = exp + (0.5 - 0.5) * exp * jitter = exp
      expect(computeBackoff({ ...base, random: () => 0.5 })).toBe(200);
    });

    it('random=0 → downward jitter (−0.5 of the envelope)', () => {
      // jittered = 200 + (0 - 0.5) * 200 * 0.5 = 200 − 50 = 150
      expect(computeBackoff({ ...base, random: () => 0 })).toBe(150);
    });

    it('random→1 → upward jitter (+0.5 of the envelope)', () => {
      // jittered = 200 + (0.999... − 0.5) * 200 * 0.5 ≈ 200 + ~50
      const d = computeBackoff({ ...base, random: () => 0.999999 });
      expect(d).toBeGreaterThan(249);
      expect(d).toBeLessThanOrEqual(250);
    });

    it('clamps the jittered result UP to minMs', () => {
      // downward jitter → 150, but minMs=190 floors it
      expect(computeBackoff({ ...base, minMs: 190, random: () => 0 })).toBe(190);
    });

    it('clamps the jittered result DOWN to maxMs', () => {
      // exp capped at 210, upward jitter would reach ~260, maxMs floors it to 210
      expect(computeBackoff({ ...base, maxMs: 210, random: () => 1 })).toBe(210);
    });

    it('matches the legacy inline netron formula across a sweep', () => {
      // The transports previously computed:
      //   exp = min(base*factor^attempt, max)
      //   delay = clamp(exp + exp*jf*(rand-0.5), base, max)
      const rng = (() => { let s = 0; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
      for (let attempt = 0; attempt < 12; attempt++) {
        const r = rng();
        const baseDelay = 1000, maxDelay = 30000, jf = 0.3, factor = 2;
        const exp = Math.min(baseDelay * Math.pow(factor, attempt), maxDelay);
        const legacy = Math.max(baseDelay, Math.min(exp + exp * jf * (r - 0.5), maxDelay));
        const unified = computeBackoff({
          attempt, baseMs: baseDelay, maxMs: maxDelay, factor, jitter: jf,
          jitterMode: 'centered', minMs: baseDelay, random: () => r,
        });
        expect(unified).toBeCloseTo(legacy, 9);
      }
    });
  });
});
