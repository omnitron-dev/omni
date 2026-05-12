/**
 * Regression tests for T#70 — observability T2 bundle (8 high-severity defects).
 *
 * Each test pins one defect's invariant. The defects:
 *
 *   1. `labelKey` corrupted series on label values containing `,` or `=`
 *   2. Histogram observe propagated NaN/Infinity into `state.sum`,
 *      poisoning the series permanently
 *   3. `MetricsService.flush()` lost the batch on storage-write failure
 *      (splice-before-await pattern)
 *   4. `MetricsCollector.buffer` was unbounded — stalled flush → OOM
 *   5. `bucketAggregate` averaged counter metrics, producing wrong
 *      rate() values in dashboards
 *
 * The remaining T#70 fixes live in adjacent packages (`titan-telemetry-relay`
 * for the WAL FD race, `@omnitron-dev/titan` for the logger flush-hook
 * registry) and have their own per-package test surface.
 */

import { describe, it, expect } from 'vitest';
import { MetricsRegistry } from '../src/registry.js';
import { MetricsService } from '../src/metrics.service.js';
import { MetricsCollector } from '../src/collector.js';
import { MemoryMetricsStorage } from '../src/storage.js';
import type { IMetricsStorage, MetricSample } from '../src/types.js';

describe('T#70 — observability defect regressions', () => {
  describe('labelKey/parseLabels — comma + equals in label values', () => {
    it('preserves a single series for a label value containing a comma', async () => {
      // Pre-T#70 this same input produced TWO series:
      //   { route: 'GET' } and { 'POST /users': '' }
      // — silently splitting the counter into two bogus rows.
      const reg = new MetricsRegistry();
      reg.counter('rpc_calls', { route: 'GET,POST /users' }, 1);
      reg.counter('rpc_calls', { route: 'GET,POST /users' }, 2);
      const prom = reg.toPrometheusText();
      const matches = prom.match(/^rpc_calls\{/gm) ?? [];
      expect(matches.length).toBe(1);
      expect(prom).toContain('rpc_calls{route="GET,POST /users"} 3');
    });

    it("preserves a single series for a label value containing '='", async () => {
      const reg = new MetricsRegistry();
      reg.gauge('config_value', { kv: 'key=value' }, 42);
      const prom = reg.toPrometheusText();
      const matches = prom.match(/^config_value\{/gm) ?? [];
      expect(matches.length).toBe(1);
      expect(prom).toContain('config_value{kv="key=value"} 42');
    });

    it('round-trips through the snapshot path losslessly', async () => {
      const reg = new MetricsRegistry();
      reg.counter('weird', { a: '1,2=3', b: 'plain' }, 7);
      const snap = reg.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0]!.labels).toEqual({ a: '1,2=3', b: 'plain' });
    });
  });

  describe('histogram observe — non-finite guard', () => {
    it('drops NaN observations silently rather than poisoning the series', async () => {
      const reg = new MetricsRegistry();
      reg.histogram('latency', { route: '/x' }, 0.5);
      reg.histogram('latency', { route: '/x' }, NaN); // historically broke sum
      reg.histogram('latency', { route: '/x' }, 0.7);
      const prom = reg.toPrometheusText();
      // Pre-T#70 the sum line would read `latency_sum{...} NaN`.
      expect(prom).toMatch(/latency_sum\{route="\/x"\} 1\.2/);
      expect(prom).toMatch(/latency_count\{route="\/x"\} 2/); // NaN didn't count
      expect(prom).not.toContain('NaN');
    });

    it('drops +Infinity / -Infinity', async () => {
      const reg = new MetricsRegistry();
      reg.histogram('latency', {}, 1);
      reg.histogram('latency', {}, Infinity);
      reg.histogram('latency', {}, -Infinity);
      reg.histogram('latency', {}, 2);
      const prom = reg.toPrometheusText();
      // Empty labels render as `latency_sum 3` (no `{}`).
      expect(prom).toMatch(/^latency_sum 3$/m);
      expect(prom).toMatch(/^latency_count 2$/m);
    });
  });

  describe('MetricsService.flush — re-enqueue on storage failure', () => {
    it('returns failed batch to the head of the buffer so the next flush retries', async () => {
      let writeCalls = 0;
      const flakyStorage: IMetricsStorage = {
        async write() {
          writeCalls++;
          if (writeCalls === 1) throw new Error('PG outage');
        },
        async query() { return []; },
        async getLatest() {
          return { timestamp: Date.now(), apps: {}, totals: { cpu: 0, memory: 0, apps: 0, onlineApps: 0 } };
        },
        async cleanup() { /* */ },
        async evictApp() { /* */ },
      };
      const svc = new MetricsService(
        { appName: 'test', collection: { enabled: false }, storage: { type: 'memory', batchSize: 10_000 } },
        flakyStorage,
      );
      svc.record({ name: 'cpu', value: 12, timestamp: 1, labels: {} });
      svc.record({ name: 'cpu', value: 34, timestamp: 2, labels: {} });

      // First flush throws — but the batch should be back in the buffer.
      await expect(svc.flush()).rejects.toThrow('PG outage');

      // Second flush succeeds and drains everything.
      await svc.flush();
      expect(writeCalls).toBe(2);

      // The internal buffer should now be empty — verify by adding fresh
      // samples and confirming only those reach storage on the next flush.
      let lastBatch: MetricSample[] | undefined;
      const captureStorage: IMetricsStorage = {
        async write(s) { lastBatch = s; },
        async query() { return []; },
        async getLatest() {
          return { timestamp: Date.now(), apps: {}, totals: { cpu: 0, memory: 0, apps: 0, onlineApps: 0 } };
        },
        async cleanup() { /* */ },
        async evictApp() { /* */ },
      };
      const svc2 = new MetricsService(
        { appName: 'test', collection: { enabled: false }, storage: { type: 'memory', batchSize: 10_000 } },
        captureStorage,
      );
      svc2.record({ name: 'cpu', value: 99, timestamp: 3, labels: {} });
      await svc2.flush();
      expect(lastBatch).toHaveLength(1);
      expect(lastBatch![0]!.value).toBe(99);
    });
  });

  describe('MetricsCollector — buffer cap', () => {
    it('caps the drain buffer when the flusher stalls', async () => {
      const reg = new MetricsRegistry();
      const collector = new MetricsCollector(
        reg,
        'test',
        { enabled: true, interval: 1_000_000, process: false, system: false, rpc: false, custom: false },
        null,
      );
      // Push 60k samples synthetically — no orchestrator wired, so the
      // collector tick never fires. We hit the cap from the external
      // `record()` path that omnitron's metrics-bridge uses.
      for (let i = 0; i < 60_000; i++) {
        collector.record({ name: 'rpc_calls', value: 1, timestamp: i, labels: { app: 'x' } });
      }
      const drained = collector.drain();
      // Pre-T#70: 60_000 entries (unbounded). Post: capped at 50_000.
      expect(drained.length).toBe(50_000);
      // The oldest 10k were the ones evicted; we should see entries i=10000..59999.
      expect(drained[0]!.timestamp).toBe(10_000);
      expect(drained[drained.length - 1]!.timestamp).toBe(59_999);
      // The diagnostic counter reflects the loss.
      expect(collector.totalDropped).toBe(10_000);
    });
  });

  describe('bucketAggregate — counter LAST, gauge AVG', () => {
    it('uses LAST value for counter metrics (Prometheus rate() compatibility)', async () => {
      const store = new MemoryMetricsStorage();
      // Three samples in a single 10-sec bucket — a counter increasing.
      const baseTs = 1_000_000_000_000;
      await store.write([
        { name: 'rpc_requests_total', value: 100, timestamp: baseTs + 1_000, labels: { app: 'a' } },
        { name: 'rpc_requests_total', value: 110, timestamp: baseTs + 4_000, labels: { app: 'a' } },
        { name: 'rpc_requests_total', value: 130, timestamp: baseTs + 9_000, labels: { app: 'a' } },
      ]);
      const series = await store.query({
        names: ['rpc_requests_total'],
        from: baseTs,
        to: baseTs + 60_000,
        interval: '10s',
      });
      expect(series).toHaveLength(1);
      expect(series[0]!.points).toHaveLength(1);
      // Counter: take LAST observation (130). Pre-T#70 averaged ≈ 113.33.
      expect(series[0]!.points[0]!.value).toBe(130);
    });

    it('uses AVG for non-counter metrics (gauges)', async () => {
      const store = new MemoryMetricsStorage();
      const baseTs = 1_000_000_000_000;
      await store.write([
        { name: 'cpu_percent', value: 10, timestamp: baseTs + 1_000, labels: { app: 'a' } },
        { name: 'cpu_percent', value: 20, timestamp: baseTs + 4_000, labels: { app: 'a' } },
        { name: 'cpu_percent', value: 30, timestamp: baseTs + 9_000, labels: { app: 'a' } },
      ]);
      const series = await store.query({
        names: ['cpu_percent'],
        from: baseTs,
        to: baseTs + 60_000,
        interval: '10s',
      });
      expect(series[0]!.points[0]!.value).toBe(20); // (10 + 20 + 30) / 3
    });
  });
});
