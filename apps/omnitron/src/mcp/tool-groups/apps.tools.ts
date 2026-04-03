import type { IMcpToolDef } from '../types.js';

/**
 * App management MCP tools.
 * Bridges to DaemonService RPC for app lifecycle management.
 */
export function createAppsTools(daemonClient: any): IMcpToolDef[] {
  return [
    {
      name: 'apps.list',
      description: 'List all managed applications with their status, PID, CPU, memory, and uptime.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.list(),
    },
    {
      name: 'apps.start',
      description: 'Start an application by name. Starts all if no name provided.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'App name (omit to start all)' },
        },
      },
      handler: async (params: any) => {
        if (params.name) return daemonClient.startApp({ name: params.name });
        return daemonClient.startAll();
      },
    },
    {
      name: 'apps.stop',
      description: 'Stop an application by name. Stops all if no name provided.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'App name (omit to stop all)' },
          force: { type: 'boolean', description: 'Force kill (SIGKILL)', default: false },
        },
      },
      handler: async (params: any) => {
        if (params.name) return daemonClient.stopApp({ name: params.name, force: params.force });
        return daemonClient.stopAll();
      },
    },
    {
      name: 'apps.restart',
      description: 'Restart an application by name.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'App name' },
        },
        required: ['name'],
      },
      handler: async (params: any) => daemonClient.restartApp({ name: params.name }),
    },
    {
      name: 'apps.status',
      description: 'Get detailed status of the daemon: running apps, uptime, resource usage.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.status(),
    },
    {
      name: 'apps.logs',
      description: 'Get recent logs for an application.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'App name' },
          lines: { type: 'number', description: 'Number of lines (default: 50)', default: 50 },
          level: { type: 'string', description: 'Min log level filter' },
          grep: { type: 'string', description: 'Pattern to filter log messages' },
        },
        required: ['name'],
      },
      handler: async (params: any) => daemonClient.getLogs(params),
    },
    {
      name: 'apps.scale',
      description: 'Scale an application to a specific number of instances.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'App name' },
          count: { type: 'number', description: 'Target instance count' },
        },
        required: ['name', 'count'],
      },
      handler: async (params: any) => daemonClient.scale(params.name, params.count),
    },
    {
      name: 'apps.inspect',
      description: 'Deep diagnostics for an application: DI container state, service registry, connections.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'App name' },
        },
        required: ['name'],
      },
      handler: async (params: any) => daemonClient.inspect(params.name),
    },
  ];
}
