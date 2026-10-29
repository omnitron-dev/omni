import type { MetricsTimeSeries, IStackInfo } from '@omnitron-dev/omnitron/dto/services';

export interface MetricScope {
  localPrefixes: string[];
  remote: Array<{ handle: string; nodeIds: string[] }>;
}

/** Remote deployments can have a different stack name on their reporting node. */
export function metricScope(
  project: string,
  stack: string | null,
  stacks: IStackInfo[],
  nodes: Array<{ id: string; host: string }>
): MetricScope {
  const selected = stacks.filter((item) => !stack || item.name === stack);
  return {
    localPrefixes: selected.filter((item) => item.type === 'local').map((item) => `${project}/${item.name}/`),
    remote: selected
      .filter((item) => item.type !== 'local')
      .flatMap((item) =>
        item.apps.map((app) => ({
          handle: app.handleKey,
          nodeIds: nodes.filter((node) => item.nodes.some((host) => host.host === node.host)).map((node) => node.id),
        }))
      ),
  };
}

export function seriesInScope(series: Pick<MetricsTimeSeries, 'app' | 'labels'>, scope: MetricScope): boolean {
  const node = series.labels?.node;
  return node
    ? scope.remote.some(
        (item) =>
          item.nodeIds.includes(node) && (series.app === item.handle || series.app.startsWith(`${item.handle}/`))
      )
    : scope.localPrefixes.some((prefix) => series.app.startsWith(prefix));
}

export const METRIC_WINDOWS = {
  '5m': { label: '5 minutes', duration: 5 * 60_000, interval: '10s', bucket: 10_000 },
  '15m': { label: '15 minutes', duration: 15 * 60_000, interval: '30s', bucket: 30_000 },
  '1h': { label: '1 hour', duration: 60 * 60_000, interval: '1m', bucket: 60_000 },
} as const;
export type MetricWindow = keyof typeof METRIC_WINDOWS;

export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = value === 0 ? 0 : Math.max(0, Math.min(4, Math.floor(Math.log(value) / Math.log(1024))));
  return `${(value / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index > 0 ? 1 : 0 })} ${units[index]}`;
}

export const formatCpu = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) || value < 0 ? '—' : `${value.toFixed(1)}%`;

export function seriesLabel(
  series: { app: string; labels?: Record<string, string> },
  nodeNames: Record<string, string>
): string {
  const parts = series.app.split('/');
  const app = parts.length >= 4 ? parts.slice(2).join('/') : parts[parts.length - 1]!;
  const node = series.labels?.node;
  return node ? `${app} · ${nodeNames[node] ?? node}` : app;
}

/** Same process keeps its identity and colour across CPU/memory and refreshes. */
export const seriesKey = (series: Pick<MetricsTimeSeries, 'app' | 'labels'>) =>
  JSON.stringify([series.app, Object.entries(series.labels ?? {}).sort(([a], [b]) => a.localeCompare(b))]);

export interface MetricLine {
  id: string;
  name: string;
  data: Array<{ x: number; y: number | null }>;
  latest: number;
  lastAt: number;
  average: number;
  peak: number;
  count: number;
}

/** Scope by namespace before naming. Bare daemon metrics never belong to a project. */
export function metricLines(
  series: MetricsTimeSeries[],
  name: string,
  prefix: string,
  includeProcesses: boolean,
  nodeNames: Record<string, string>,
  bucket: number,
  scope?: MetricScope
): MetricLine[] {
  const selected = series.filter(
    (s) =>
      s.name === name &&
      (scope ? seriesInScope(s, scope) : !prefix || s.app.startsWith(prefix)) &&
      (includeProcesses || s.app.split('/').length < 4)
  );
  const names = selected.map((s) => seriesLabel(s, nodeNames));
  return selected
    .flatMap((s, index) => {
      const points = s.points
        .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.value) && p.value >= 0)
        .sort((a, b) => a.timestamp - b.timestamp);
      if (!points.length) return [];
      const data: MetricLine['data'] = [];
      for (const [i, p] of points.entries()) {
        // Missing buckets are absence, not a long interpolated line.
        if (i > 0 && p.timestamp - points[i - 1]!.timestamp > bucket * 1.5) {
          data.push({ x: points[i - 1]!.timestamp + bucket, y: null });
        }
        data.push({ x: p.timestamp, y: p.value });
      }
      const baseName = names[index]!;
      const duplicate = names.filter((n) => n === baseName).length > 1;
      const labels = Object.entries(s.labels ?? {})
        .filter(([k]) => k !== 'node')
        .sort(([a], [b]) => a.localeCompare(b));
      return [
        {
          id: seriesKey(s),
          name: duplicate
            ? `${s.app}${s.labels?.node ? ` · ${nodeNames[s.labels.node] ?? s.labels.node}` : ''}${labels.length ? ` · ${labels.map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}`
            : baseName,
          data,
          latest: points.at(-1)!.value,
          lastAt: points.at(-1)!.timestamp,
          average: points.reduce((sum, p) => sum + p.value, 0) / points.length,
          peak: Math.max(...points.map((p) => p.value)),
          count: points.length,
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A resource total is unknown if any selected application has no valid reading. */
export function resourceTotal(values: Array<number | null | undefined>): number | null {
  return values.some((v) => v == null || !Number.isFinite(v) || v < 0)
    ? null
    : (values as number[]).reduce((sum, value) => sum + value, 0);
}
