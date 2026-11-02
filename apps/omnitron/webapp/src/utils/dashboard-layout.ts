import { METRIC_WINDOWS, type MetricWindow } from './metric-series';

export const PANEL_TYPES = {
  stat: 'Metric',
  'cpu-chart': 'CPU history',
  'memory-chart': 'Memory history',
  'app-grid': 'Application status',
  'daemon-info': 'Controller runtime',
  'alert-summary': 'Controller alerts',
  'recent-errors': 'Application failures and restarts',
} as const;
export const STAT_METRICS = {
  total_apps: 'Applications',
  online_apps: 'Online',
  errored_apps: 'Errored',
  total_cpu: 'CPU',
  total_memory: 'Memory',
  uptime: 'Controller uptime',
  restarts: 'Restarts',
} as const;
export const PANEL_SIZES = {
  small: 'Compact',
  medium: 'Third width',
  large: 'Half width',
  full: 'Full width',
} as const;
export const REFRESH_INTERVALS = [5000, 15000, 30000, 60000] as const;
export const LAYOUT_KEY = 'omnitron_dashboards_v2';

export type PanelType = keyof typeof PANEL_TYPES;
export type Size = keyof typeof PANEL_SIZES;
export type StatMetric = keyof typeof STAT_METRICS;
export interface DashboardPanel {
  id: string;
  type: PanelType;
  title: string;
  size: Size;
  config: { metric?: StatMetric; app?: string };
}
export interface DashboardConfig {
  id: string;
  name: string;
  panels: DashboardPanel[];
  refreshInterval: number;
  window: MetricWindow;
}

export const dashboardId = () => crypto.randomUUID();
export const blankBoard = (name: string): DashboardConfig => ({
  id: dashboardId(),
  name,
  panels: [],
  refreshInterval: 5000,
  window: '15m',
});
export function defaultBoard(): DashboardConfig {
  const board = blankBoard('Overview');
  const panel = (type: PanelType, title: string, size: Size, metric?: StatMetric): DashboardPanel => ({
    id: dashboardId(),
    type,
    title,
    size,
    config: metric ? { metric } : {},
  });
  board.panels = [
    panel('stat', 'Online', 'small', 'online_apps'),
    panel('stat', 'Errored', 'small', 'errored_apps'),
    panel('stat', 'CPU', 'small', 'total_cpu'),
    panel('stat', 'Memory', 'small', 'total_memory'),
    panel('cpu-chart', 'CPU history', 'large'),
    panel('memory-chart', 'Memory history', 'large'),
    panel('app-grid', 'Applications', 'large'),
    panel('daemon-info', 'Controller runtime', 'medium'),
    panel('recent-errors', 'Failures and restarts', 'medium'),
  ];
  return board;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a layout object.');
  return value as Record<string, unknown>;
}
function label(value: unknown, field: string, limit = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit)
    throw new Error(`Invalid ${field} (1–${limit} characters).`);
  return value.trim();
}
function choice<T extends object>(options: T, value: unknown, field: string): keyof T {
  if (typeof value !== 'string' || !Object.hasOwn(options, value)) throw new Error(`Unsupported ${field}.`);
  return value as keyof T;
}
function unique(items: { id: string }[]): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Duplicate layout identifiers.');
}

/** Reads existing v2 boards and validates portable layouts before they're admitted to the editor. */
export function parseBoard(input: unknown): DashboardConfig {
  const board = record(input);
  if (!Array.isArray(board.panels) || board.panels.length > 64)
    throw new Error('A dashboard supports up to 64 panels.');
  const panels = board.panels.map((entry: unknown): DashboardPanel => {
    const p = record(entry);
    const legacyUptime = p.type === 'uptime-chart';
    const type = legacyUptime ? 'stat' : choice(PANEL_TYPES, p.type, 'panel type');
    const config = record(p.config ?? {});
    return {
      id: label(p.id, 'panel id'),
      title: label(p.title, 'panel title'),
      type,
      size: choice(PANEL_SIZES, p.size, 'panel size'),
      config: {
        ...(type === 'stat' && {
          metric: legacyUptime ? 'uptime' : choice(STAT_METRICS, config.metric ?? 'online_apps', 'statistic'),
        }),
        ...(config.app && typeof config.app === 'string' ? { app: label(config.app, 'application', 256) } : {}),
      },
    };
  });
  unique(panels);
  const refreshInterval = Number(board.refreshInterval ?? 5000);
  if (!REFRESH_INTERVALS.some((value) => value === refreshInterval)) throw new Error('Unsupported refresh interval.');
  return {
    id: label(board.id, 'dashboard id'),
    name: label(board.name, 'dashboard name'),
    panels,
    refreshInterval,
    window: choice(METRIC_WINDOWS, board.window ?? '15m', 'history window'),
  };
}
export function parseBoards(raw: string): DashboardConfig[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.length || value.length > 64) throw new Error('Expected 1–64 dashboard layouts.');
  const boards = value.map(parseBoard);
  unique(boards);
  return boards;
}
export function exportBoard(board: DashboardConfig): string {
  return JSON.stringify({ format: 'omnitron.dashboard', version: 1, board }, null, 2);
}
export function importBoard(raw: string): DashboardConfig {
  if (raw.length > 128 * 1024) throw new Error('Layout exceeds 128 KiB.');
  const file = record(JSON.parse(raw));
  if (file.format !== 'omnitron.dashboard' || file.version !== 1)
    throw new Error('Unsupported dashboard layout format or version.');
  return { ...parseBoard(file.board), id: dashboardId() };
}
