import type { IMcpToolDef } from '../types.js';
import type { DaemonClient } from '../../daemon/daemon-client.js';
import type {
  IOmnitronHealthService,
  IOmnitronLogsService,
} from '../../shared/dto/services.js';

/**
 * Monitoring, health, and metrics MCP tools.
 *
 * `health.check` and `metrics.app` used to call `daemonClient.healthCheck()`
 * and `.getAppMetrics()`, neither of which exists — the parameter was `any`,
 * so the mistake reached the agent as a TypeError at call time rather than
 * the compiler. `logs.query` passed `grep` and `lines`, which the RPC
 * ignores; the filter is `search`, the bound is `limit`, and the two extra
 * keys were dropped silently, so the agent got unfiltered logs and no reason
 * to suspect its filter had not been applied.
 */
export function createMonitoringTools(client: DaemonClient): IMcpToolDef[] {
  const health = () => client.service<IOmnitronHealthService>('OmnitronHealth');
  const logs = () => client.service<IOmnitronLogsService>('OmnitronLogs');

  return [
    {
      name: 'health.check',
      description:
        'Run health checks. With `app`, probes that one; without, probes every app plus infrastructure.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'App name (omit for the whole platform)' },
        },
      },
      handler: async (params: any) =>
        params.app ? (await health()).checkApp({ appName: params.app }) : (await health()).checkAll(),
    },
    {
      name: 'metrics.get',
      description: 'System-wide metrics: CPU, memory, event-loop latency, request counts.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => client.getMetrics({}),
    },
    {
      name: 'metrics.app',
      description: 'Metrics for one application.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'App name' } },
        required: ['name'],
      },
      handler: async (params: any) => client.getMetrics({ name: params.name }),
    },
    {
      name: 'logs.query',
      description:
        'Query stored logs. Full-text filter is `search`; page with `limit` and `offset`.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'App name (omit for every app)' },
          level: { type: 'string', description: 'Level: trace|debug|info|warn|error|fatal' },
          search: { type: 'string', description: 'Substring to match in the message' },
          traceId: { type: 'string', description: 'Correlate one request across apps' },
          from: { type: 'string', description: 'ISO timestamp — inclusive lower bound' },
          to: { type: 'string', description: 'ISO timestamp — exclusive upper bound' },
          limit: { type: 'number', description: 'Max rows', default: 100 },
          offset: { type: 'number', description: 'Rows to skip', default: 0 },
        },
      },
      handler: async (params: any) =>
        (await logs()).queryLogs({
          app: params.app,
          level: params.level,
          search: params.search,
          traceId: params.traceId,
          from: params.from,
          to: params.to,
          limit: params.limit ?? 100,
          offset: params.offset ?? 0,
        }),
    },
    {
      name: 'logs.tail',
      description: 'The most recent log entries, oldest-first — poll this for near-real-time output.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'App name (omit for every app)' },
          level: { type: 'string', description: 'Level filter' },
          search: { type: 'string', description: 'Substring to match' },
          tail: { type: 'number', description: 'Entries to return', default: 100 },
          since: { type: 'string', description: 'ISO timestamp — only entries after this' },
        },
      },
      handler: async (params: any) =>
        (await logs()).streamLogs({
          app: params.app,
          level: params.level,
          search: params.search,
          tail: params.tail ?? 100,
          since: params.since,
        }),
    },
    {
      name: 'logs.stats',
      description: 'Per-app log volume and rotation counts.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await logs()).getLogStats(),
    },
  ];
}
