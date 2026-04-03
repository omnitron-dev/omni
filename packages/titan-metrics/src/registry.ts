/**
 * Titan Metrics — In-Memory Metric Registry
 *
 * Pure TypeScript metrics store. Zero external dependencies.
 * Supports counters, gauges, and histograms with label sets.
 *
 * @module titan-metrics
 */

import type {
  MetricType,
  MetricDefinition,
  MetricSample,
  HistogramState,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

interface CounterState {
  value: number;
}

interface GaugeState {
  value: number;
}

interface MetricEntry {
  definition: MetricDefinition;
  /** Map from serialised label key → metric state */
  series: Map<string, CounterState | GaugeState | HistogramState>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/** Stable serialisation of a labels object for map keys */
function labelKey(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map(k => `${k}=${labels[k]}`).join(',');
}

/** Parse a label key back to an object */
function parseLabels(key: string): Record<string, string> {
  if (key === '') return {};
  const out: Record<string, string> = {};
  const parts = key.split(',');
  for (const part of parts) {
    const eq = part.indexOf('=');
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

/** Escape a Prometheus label value */
function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Format labels for Prometheus text */
function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// MetricsRegistry
// ---------------------------------------------------------------------------

export class MetricsRegistry {
  private readonly metrics = new Map<string, MetricEntry>();
  private readonly histogramBuckets: number[];

  constructor(buckets?: number[]) {
    this.histogramBuckets = buckets ?? DEFAULT_HISTOGRAM_BUCKETS;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /** Register (or retrieve) a metric definition */
  define(def: MetricDefinition): void {
    if (this.metrics.has(def.name)) return;
    this.metrics.set(def.name, { definition: def, series: new Map() });
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  /** Increment a counter by delta (default 1) */
  counter(name: string, labels: Record<string, string> = {}, delta = 1): void {
    const entry = this.ensureMetric(name, 'counter', 'Auto-registered counter');
    const key = labelKey(labels);
    const state = entry.series.get(key) as CounterState | undefined;
    if (state) {
      state.value += delta;
    } else {
      entry.series.set(key, { value: delta });
    }
  }

  /** Set a gauge to an absolute value */
  gauge(name: string, labels: Record<string, string> = {}, value: number): void {
    const entry = this.ensureMetric(name, 'gauge', 'Auto-registered gauge');
    const key = labelKey(labels);
    const state = entry.series.get(key) as GaugeState | undefined;
    if (state) {
      state.value = value;
    } else {
      entry.series.set(key, { value });
    }
  }

  /** Observe a histogram value */
  histogram(name: string, labels: Record<string, string> = {}, value: number): void {
    const entry = this.ensureMetric(name, 'histogram', 'Auto-registered histogram');
    const key = labelKey(labels);
    let state = entry.series.get(key) as HistogramState | undefined;
    if (!state) {
      const buckets = [...this.histogramBuckets];
      state = { buckets, counts: new Array<number>(buckets.length + 1).fill(0), sum: 0, count: 0 };
      entry.series.set(key, state);
    }
    state.sum += value;
    state.count++;
    for (let i = 0; i < state.buckets.length; i++) {
      if (value <= state.buckets[i]!) {
        state.counts[i]!;
        state.counts[i] = (state.counts[i] ?? 0) + 1;
      }
    }
    // +Inf bucket (last element)
    const infIdx = state.buckets.length;
    state.counts[infIdx] = (state.counts[infIdx] ?? 0) + 1;
  }

  /** Record a generic MetricSample (auto-routes to counter/gauge/histogram) */
  record(sample: MetricSample): void {
    const entry = this.metrics.get(sample.name);
    const type = entry?.definition.type ?? 'gauge';
    switch (type) {
      case 'counter':
        this.counter(sample.name, sample.labels, sample.value);
        break;
      case 'histogram':
        this.histogram(sample.name, sample.labels, sample.value);
        break;
      default:
        this.gauge(sample.name, sample.labels, sample.value);
    }
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  /** Return all current metric values as MetricSample[] */
  snapshot(): MetricSample[] {
    const now = Date.now();
    const out: MetricSample[] = [];
    for (const [, entry] of this.metrics) {
      const def = entry.definition;
      if (def.type === 'histogram') {
        for (const [key, raw] of entry.series) {
          const labels = parseLabels(key);
          const state = raw as HistogramState;
          out.push({ name: `${def.name}_sum`, value: state.sum, timestamp: now, labels });
          out.push({ name: `${def.name}_count`, value: state.count, timestamp: now, labels });
        }
      } else {
        for (const [key, raw] of entry.series) {
          const labels = parseLabels(key);
          const state = raw as CounterState | GaugeState;
          out.push({ name: def.name, value: state.value, timestamp: now, labels });
        }
      }
    }
    return out;
  }

  /** Format all metrics as Prometheus exposition text */
  toPrometheusText(): string {
    const lines: string[] = [];

    for (const [, entry] of this.metrics) {
      const def = entry.definition;
      lines.push(`# HELP ${def.name} ${def.help}`);
      lines.push(`# TYPE ${def.name} ${def.type}`);

      if (def.type === 'histogram') {
        for (const [key, raw] of entry.series) {
          const labels = parseLabels(key);
          const state = raw as HistogramState;
          for (let i = 0; i < state.buckets.length; i++) {
            const bl = { ...labels, le: String(state.buckets[i]) };
            lines.push(`${def.name}_bucket${formatLabels(bl)} ${state.counts[i]}`);
          }
          const infLabels = { ...labels, le: '+Inf' };
          lines.push(`${def.name}_bucket${formatLabels(infLabels)} ${state.counts[state.buckets.length]}`);
          lines.push(`${def.name}_sum${formatLabels(labels)} ${state.sum}`);
          lines.push(`${def.name}_count${formatLabels(labels)} ${state.count}`);
        }
      } else {
        for (const [key, raw] of entry.series) {
          const labels = parseLabels(key);
          const state = raw as CounterState | GaugeState;
          lines.push(`${def.name}${formatLabels(labels)} ${state.value}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /** Reset all metric values (useful for testing) */
  reset(): void {
    for (const entry of this.metrics.values()) {
      entry.series.clear();
    }
  }

  /** Clear all metric definitions and values */
  clear(): void {
    this.metrics.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ensureMetric(name: string, type: MetricType, help: string): MetricEntry {
    let entry = this.metrics.get(name);
    if (!entry) {
      entry = { definition: { name, type, help }, series: new Map() };
      this.metrics.set(name, entry);
    }
    return entry;
  }
}
