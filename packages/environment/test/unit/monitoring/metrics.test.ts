import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../../src/monitoring/metrics.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  it('should increment counter', () => {
    collector.incrementCounter('requests', 1);
    const metric = collector.getMetric('requests');
    expect(metric?.value).toBe(1);
    expect(metric?.type).toBe('counter');
  });

  it('should set gauge', () => {
    collector.setGauge('memory', 1024);
    const metric = collector.getMetric('memory');
    expect(metric?.value).toBe(1024);
    expect(metric?.type).toBe('gauge');
  });

  it('should observe histogram', () => {
    collector.observeHistogram('latency', 100);
    collector.observeHistogram('latency', 200);
    const metric = collector.getMetric('latency');
    expect(metric?.type).toBe('histogram');
    expect(metric?.value).toBe(150); // Average
  });

  it('should get histogram stats', () => {
    collector.observeHistogram('latency', 100);
    collector.observeHistogram('latency', 200);
    collector.observeHistogram('latency', 300);
    const stats = collector.getHistogramStats('latency');
    expect(stats?.count).toBe(3);
    expect(stats?.min).toBe(100);
    expect(stats?.max).toBe(300);
    expect(stats?.avg).toBe(200);
  });

  it('should handle labels', () => {
    collector.incrementCounter('requests', 1, { method: 'GET' });
    collector.incrementCounter('requests', 1, { method: 'POST' });
    const metrics = collector.getMetricsByName('requests');
    expect(metrics).toHaveLength(2);
  });

  it('should get all metrics', () => {
    collector.incrementCounter('counter1');
    collector.setGauge('gauge1', 100);
    expect(collector.getAllMetrics()).toHaveLength(2);
  });

  it('should clear metrics', () => {
    collector.incrementCounter('test');
    collector.clear();
    expect(collector.getAllMetrics()).toHaveLength(0);
  });
});
