import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCpu,
  metricLines,
  metricScope,
  resourceTotal,
  seriesInScope,
  seriesKey,
} from '../../webapp/src/utils/metric-series.js';
import type { MetricsTimeSeries, IStackInfo } from '../../src/shared/dto/services.js';

const series = (app: string, name = 'cpu_percent', labels = {}): MetricsTimeSeries => ({
  name,
  app,
  labels,
  points: [
    { timestamp: 30_000, value: 125 },
    { timestamp: 0, value: 0 },
  ],
});

describe('honest chart readings', () => {
  it('excludes other projects, bare daemon readings and child processes by default', () => {
    const lines = metricLines(
      [series('sample/dev/main'), series('other/dev/main'), series('omnitron'), series('sample/dev/main/http')],
      'cpu_percent',
      'sample/dev/',
      false,
      {},
      10_000
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.peak).toBe(125);
    expect(lines[0]!.data).toEqual([
      { x: 0, y: 0 },
      { x: 10_000, y: null },
      { x: 30_000, y: 125 },
    ]);
  });
  it('treats memory independently from absent CPU and retains fractional bytes', () => {
    const lines = metricLines(
      [series('sample/dev/main', 'memory_bytes')],
      'memory_bytes',
      'sample/',
      false,
      {},
      10_000
    );
    expect(lines).toHaveLength(1);
    expect(formatBytes(512 * 1024)).toBe('512 KiB');
    expect(formatBytes(-1)).toBe('—');
    expect(formatCpu(0)).toBe('0.0%');
    expect(resourceTotal([0, 1])).toBe(1);
    expect(resourceTotal([100, -1])).toBeNull();
  });
  it('distinguishes stack names and label sets without changing identity between metrics', () => {
    const a = series('sample/dev/main');
    const b = series('sample/test/main');
    const lines = metricLines([a, b], 'cpu_percent', 'sample/', false, {}, 10_000);
    expect(new Set(lines.map((line) => line.name)).size).toBe(2);
    expect(seriesKey(a)).toBe(seriesKey({ ...a, name: 'memory_bytes' } as MetricsTimeSeries));
    expect(seriesKey({ ...a, labels: { source: 'daemon', node: 'one' } })).toBe(
      seriesKey({ ...a, labels: { node: 'one', source: 'daemon' } })
    );
  });
  it('rejects invalid readings without turning them into zero or mutating input', () => {
    const input = series('sample/dev/main');
    input.points.push({ timestamp: 50_000, value: -1 }, { timestamp: NaN, value: 10 });
    const original = structuredClone(input);
    const [line] = metricLines([input], 'cpu_percent', '', true, {}, 10_000);
    expect(line?.count).toBe(2);
    expect(line?.average).toBe(62.5);
    expect(input).toEqual(original);
  });
  it('resolves remote stack aliases by reporting node, never by app name alone', () => {
    const stacks = [
      { name: 'test', type: 'remote', apps: [{ handleKey: 'sample/deployed/main' }], nodes: [{ host: 'node.test' }] },
    ] as IStackInfo[];
    const scope = metricScope('sample', 'test', stacks, [
      { host: 'node.test', id: 'test-id' },
      { host: 'node.prod', id: 'prod-id' },
    ]);
    expect(seriesInScope(series('sample/deployed/main', 'cpu_percent', { node: 'test-id' }), scope)).toBe(true);
    expect(seriesInScope(series('sample/deployed/main/http', 'cpu_percent', { node: 'test-id' }), scope)).toBe(true);
    expect(seriesInScope(series('sample/deployed/main', 'cpu_percent', { node: 'prod-id' }), scope)).toBe(false);
    expect(seriesInScope(series('sample/deployed/main'), scope)).toBe(false);
  });
});
