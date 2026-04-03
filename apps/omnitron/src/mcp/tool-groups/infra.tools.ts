import type { IMcpToolDef } from '../types.js';

/**
 * Infrastructure management MCP tools.
 * Docker compose, database, Redis operations.
 */
export function createInfraTools(daemonClient: any): IMcpToolDef[] {
  return [
    {
      name: 'infra.up',
      description: 'Provision all infrastructure services (Docker Compose up).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.infraUp(),
    },
    {
      name: 'infra.down',
      description: 'Stop all infrastructure services.',
      inputSchema: {
        type: 'object',
        properties: {
          volumes: { type: 'boolean', description: 'Also remove volumes', default: false },
        },
      },
      handler: async (params: any) => daemonClient.infraDown({ volumes: params.volumes }),
    },
    {
      name: 'infra.status',
      description: 'Get status of all infrastructure services (PostgreSQL, Redis, etc.).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => daemonClient.infraStatus(),
    },
    {
      name: 'infra.logs',
      description: 'Get logs from an infrastructure service.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Service name (e.g. "postgres", "redis")' },
          lines: { type: 'number', description: 'Number of lines', default: 50 },
        },
      },
      handler: async (params: any) => daemonClient.infraLogs(params),
    },
    {
      name: 'infra.psql',
      description: 'Execute a SQL query against PostgreSQL.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL query to execute' },
          database: { type: 'string', description: 'Database name (default: main)' },
        },
        required: ['query'],
      },
      handler: async (params: any) => daemonClient.infraPsql(params),
    },
    {
      name: 'infra.redis',
      description: 'Execute a Redis command.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Redis command (e.g. "INFO", "KEYS *")' },
        },
        required: ['command'],
      },
      handler: async (params: any) => daemonClient.infraRedis(params),
    },
    {
      name: 'infra.migrate',
      description: 'Run database migrations for an application.',
      inputSchema: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'App name (omit for all)' },
        },
      },
      handler: async (params: any) => daemonClient.infraMigrate(params),
    },
  ];
}
