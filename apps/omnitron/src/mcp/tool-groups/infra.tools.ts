import type { IMcpToolDef } from '../types.js';
import type { DaemonClient } from '../../daemon/daemon-client.js';
import type {
  IOmnitronInfraService,
  IOmnitronLogsService,
} from '../../shared/dto/services.js';

/**
 * Infrastructure management MCP tools.
 *
 * Every handler reaches its RPC service through `client.service<T>(name)` —
 * the same path the CLI uses. The previous version called methods like
 * `daemonClient.infraUp()` that `DaemonClient` does not have: the parameter
 * was typed `any`, so nothing checked, and each tool failed at call time with
 * `TypeError: daemonClient.infraUp is not a function`. Verified against a
 * running daemon before this rewrite.
 *
 * `infra.psql` and `infra.redis` are gone rather than repaired. They took a
 * raw SQL string and a raw Redis command from an agent and offered no RPC
 * that executes either — `OmnitronInfra` exposes container lifecycle and
 * connection info, nothing that runs a query. Reinstating them would mean
 * building an arbitrary-statement endpoint reachable by anyone the agent
 * talks to, which is a decision for an operator, not a repair.
 */
export function createInfraTools(client: DaemonClient): IMcpToolDef[] {
  const infra = () => client.service<IOmnitronInfraService>('OmnitronInfra');
  const logs = () => client.service<IOmnitronLogsService>('OmnitronLogs');

  return [
    {
      name: 'infra.status',
      description:
        'State of every managed infrastructure container (PostgreSQL, Redis, MinIO, …): image, status, ports, health.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await infra()).getState(),
    },
    {
      name: 'infra.containers',
      description: 'List managed infrastructure containers.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await infra()).listContainers(),
    },
    {
      name: 'infra.connection',
      description:
        'Resolved host, port and credentials for a logical service — what an app would be given for it.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Logical service name, e.g. "postgres", "redis"' },
        },
        required: ['service'],
      },
      handler: async (params: any) => (await infra()).getConnectionInfo({ service: params.service }),
    },
    {
      name: 'infra.start',
      description: 'Start a managed infrastructure container.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Container name' } },
        required: ['name'],
      },
      handler: async (params: any) => (await infra()).startContainer({ name: params.name }),
    },
    {
      name: 'infra.stop',
      description: 'Stop a managed infrastructure container.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Container name' },
          timeout: { type: 'number', description: 'Seconds to wait before killing' },
        },
        required: ['name'],
      },
      handler: async (params: any) =>
        (await infra()).stopContainer({ name: params.name, timeout: params.timeout }),
    },
    {
      name: 'infra.logs',
      description: 'Tail the logs of one infrastructure container.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Container name' },
          tail: { type: 'number', description: 'Lines to return', default: 50 },
        },
        required: ['name'],
      },
      handler: async (params: any) =>
        (await infra()).getContainerLogs({ name: params.name, tail: params.tail ?? 50 }),
    },
    {
      name: 'infra.log_stats',
      description: 'Log ingestion counters: rows stored, rows dropped, buffer depth.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (await logs()).getIngestionStats(),
    },
  ];
}
