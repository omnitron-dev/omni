import type { IMcpToolDef } from '../types.js';

/**
 * Monitoring, health, and metrics MCP tools.
 */
export function createMonitoringTools(daemonClient: any): IMcpToolDef[] {
  return [
    {
      name: 'health.check',
      description: 'Run health checks across all apps or a specific app. Returns status, indicators, and details.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'App name (omit for all)' },
        },
      },
      handler: async (params: any) => daemonClient.healthCheck(params.app),
    },
    {
      name: 'metrics.get',
      description: 'Get system-wide metrics: CPU, memory, event loop latency, request counts.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.getMetrics(),
    },
    {
      name: 'metrics.app',
      description: 'Get metrics for a specific application.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'App name' },
        },
        required: ['name'],
      },
      handler: async (params: any) => daemonClient.getAppMetrics(params.name),
    },
    {
      name: 'logs.query',
      description: 'Query historical logs with filtering. Searches log files on disk.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'App name (omit for daemon logs)' },
          level: { type: 'string', description: 'Min log level (trace/debug/info/warn/error/fatal)' },
          grep: { type: 'string', description: 'Pattern to match in log messages' },
          lines: { type: 'number', description: 'Max lines to return', default: 100 },
          since: { type: 'string', description: 'ISO timestamp — only logs after this time' },
        },
      },
      handler: async (params: any) => daemonClient.queryLogs(params),
    },
  ];
}
