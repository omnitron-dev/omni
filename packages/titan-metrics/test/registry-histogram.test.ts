/**
 * Regression tests for T#62 — `MetricsRegistry.histogram()`
 * cumulative semantics + constructor bucket normalisation.
 *
 * Prometheus's `_bucket{le=X}` is the count of observations with
 * value ≤ X. That's cumulative — every bucket whose upper bound
 * covers the observation increments. `histogram_quantile()` reads
 * the difference between successive cumulative buckets to compute
 * percentiles; if the registry emitted non-cumulative counts the
 * quantile results would be wildly wrong.
 *
 * These tests pin the cumulative behaviour so a future
 * "early-break" optimisation can't silently regress it, and verify
 * the constructor normalises unsorted / duplicate / non-finite
 * bucket inputs into the ascending unique-finite list Prometheus
 * requires.
 */

import { describe, it, expect } from 'vitest';
import { MetricsRegistry } from '../src/registry.js';

function parseBucket(line: string): { le: string; count: number } | null {
  // Example: `dur_bucket{le="0.5"} 3`
  const m = line.match(/_bucket\{[^}]*le="([^"]+)"[^}]*\}\s+(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { le: m[1]!, count: parseFloat(m[2]!) };
}

function getBuckets(text: string, metric: string): { le: string; count: number }[] {
  return text
    .split('\n')
    .filter((l) => l.startsWith(`${metric}_bucket`))
    .map(parseBucket)
    .filter((x): x is { le: string; count: number } => x !== null);
}

describe('MetricsRegistry.histogram — cumulative semantics (T#62)', () => {
  it('increments every bucket whose upper bound covers the observation', () => {
    const reg = new MetricsRegistry([0.1, 0.5, 1.0, 5.0]);
    reg.histogram('dur', {}, 0.3);
    // Expected counts (cumulative): le=0.1: 0, le=0.5: 1, le=1.0: 1, le=5.0: 1, le=+Inf: 1.
    const text = reg.toPrometheusText();
    const buckets = getBuckets(text, 'dur');
    expect(buckets).toEqual([
      { le: '0.1', count: 0 },
      { le: '0.5', count: 1 },
      { le: '1', count: 1 },
      { le: '5', count: 1 },
      { le: '+Inf', count: 1 },
    ]);
  });

  it('cumulative across multiple observations', () => {
    const reg = new MetricsRegistry([0.1, 0.5, 1.0, 5.0]);
    reg.histogram('dur', {}, 0.05); // hits all from le=0.1 up
    reg.histogram('dur', {}, 0.7);  // hits from le=1.0 up
    reg.histogram('dur', {}, 3.0);  // hits from le=5.0 up
    reg.histogram('dur', {}, 50);   // only +Inf

    const text = reg.toPrometheusText();
    const buckets = getBuckets(text, 'dur');
    // Cumulative truth table:
    //   le=0.1 → 0.05                                = 1
    //   le=0.5 → 0.05                                = 1
    //   le=1.0 → 0.05, 0.7                           = 2
    //   le=5.0 → 0.05, 0.7, 3.0                      = 3
    //   le=+Inf → all four                           = 4
    expect(buckets).toEqual([
      { le: '0.1', count: 1 },
      { le: '0.5', count: 1 },
      { le: '1', count: 2 },
      { le: '5', count: 3 },
      { le: '+Inf', count: 4 },
    ]);
  });

  it('emits _sum and _count alongside the cumulative buckets', () => {
    const reg = new MetricsRegistry([1, 10]);
    reg.histogram('latency', {}, 0.5);
    reg.histogram('latency', {}, 5);
    const text = reg.toPrometheusText();
    expect(text).toMatch(/latency_sum.*5\.5/);
    expect(text).toMatch(/latency_count.*\b2\b/);
  });

  it('constructor sorts buckets in ascending order (T#62 normalisation)', () => {
    const reg = new MetricsRegistry([5.0, 0.1, 1.0, 0.5]);
    reg.histogram('dur', {}, 0.3);
    const text = reg.toPrometheusText();
    const buckets = getBuckets(text, 'dur');
    // Output must be ascending, regardless of construction order.
    const les = buckets.map((b) => b.le).filter((le) => le !== '+Inf');
    expect(les).toEqual(['0.1', '0.5', '1', '5']);
  });

  it('constructor dedupes repeated bucket values', () => {
    const reg = new MetricsRegistry([1, 1, 2, 2, 3]);
    reg.histogram('dur', {}, 1.5);
    const text = reg.toPrometheusText();
    const buckets = getBuckets(text, 'dur');
    expect(buckets.map((b) => b.le)).toEqual(['1', '2', '3', '+Inf']);
  });

  it('constructor drops non-finite bucket entries (NaN/Infinity)', () => {
    const reg = new MetricsRegistry([NaN, 1, Infinity, 2, -Infinity]);
    reg.histogram('dur', {}, 1.5);
    const text = reg.toPrometheusText();
    const buckets = getBuckets(text, 'dur');
    // Only finite bucket boundaries survive; +Inf is the registry's own.
    expect(buckets.map((b) => b.le)).toEqual(['1', '2', '+Inf']);
  });
});
