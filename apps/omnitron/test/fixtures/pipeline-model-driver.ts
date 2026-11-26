import 'reflect-metadata';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { PassThrough } from 'node:stream';
import { sql } from 'kysely';
import { waitFor } from '@omnitron-dev/testing/async';
import type { TraceSubject } from '@omnitron-dev/testing/helpers';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { DaemonClient } from '../../src/daemon/daemon-client.js';
import { McpBridge } from '../../src/mcp/mcp-bridge.js';
import { createManagementTools } from '../../src/mcp/tool-groups/management.tools.js';
import { AuditService } from '../../src/services/audit.service.js';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { PipelineRpcService } from '../../src/services/pipeline.rpc-service.js';
import { PipelineService } from '../../src/services/pipeline.service.js';
import type { Pipeline, PipelineRun } from '../../src/shared/dto/pipelines.js';
import type { IOmnitronPipelinesService } from '../../src/shared/dto/services.js';
import { testExecution } from './execution.js';
import { createPipelineTestDatabase } from './pipeline-database.js';

export const lanes = ['alpha', 'beta'] as const;
export type Lane = typeof lanes[number];
export type Operation = 'prepare' | 'start' | 'run';
export type PipelineAction = `${Lane}.${Operation}` | 'audit.off' | 'audit.on';
export interface PipelineObservation {
  runs: Array<{ run: string; definition: string; status: string; actor: string }>;
  effects: string[];
  intents: Array<{ run: string; action: string; actor: string | null }>;
  reply: { run: string; definition: string; status: string; reviewBound: boolean } | { refused: string } | 'audit-unavailable' | null;
}

const ids = { alpha: '026de8a9-abc6-4002-aa00-000000000001', beta: '026de8a9-abc6-4002-aa00-000000000002' };

/** Dedicated duplex pipes carry the same newline-delimited JSON as the CLI's stdio. */
async function managementClient(daemon: DaemonClient) {
  const input = new PassThrough(), output = new PassThrough();
  const bridge = new McpBridge(input, output);
  bridge.registerTools(createManagementTools(daemon));
  const running = bridge.start();
  const client = new Client({ name: 'pipeline-consumer', version: '1' });
  async function close() {
    try { await client.close(); } finally {
      input.end();
      try { await running; } finally { input.destroy(); output.destroy(); }
    }
  }
  try {
    await client.connect(new StdioServerTransport(output, input));
  } catch (error) { await close(); throw error; }
  return {
    async call(name: string, args: Record<string, unknown>): Promise<{ receipt: PipelineRun } | { refused: string }> {
      const reply = await client.callTool({ name, arguments: args });
      const first = reply.content[0];
      if (first?.type !== 'text') throw Error('Expected an MCP text result');
      return reply.isError ? { refused: first.text } : { receipt: JSON.parse(first.text) };
    },
    close,
  };
}

export async function openPipelineTrace(): Promise<TraceSubject<PipelineAction, PipelineObservation>> {
  const directory = await mkdtemp(join(tmpdir(), 'omv-'));
  const cleanup: Array<() => Promise<unknown>> = [() => rm(directory, { recursive: true, force: true })];
  const close = async () => {
    const errors: unknown[] = [];
    for (const release of cleanup.splice(0).reverse()) {
      try { await release(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Pipeline fixture teardown failed');
  };
  try {
    const logfile = join(directory, 'effects');
    await writeFile(logfile, '');
    const db = createPipelineTestDatabase();
    cleanup.push(() => db.destroy());
    await sql`CREATE TABLE omnitron_audit_log (
      id INTEGER PRIMARY KEY, action TEXT NOT NULL, actorId TEXT, actorType TEXT NOT NULL,
      resourceType TEXT NOT NULL, resourceId TEXT, details TEXT, ipAddress TEXT)`.execute(db);
    const logger = createNullLogger();
    const audit = new AuditService(logger, db), unavailable = new AuditService(logger, null);
    let auditSink = audit;
    const pipelines = new PipelineService(db, logger, testExecution);
    cleanup.push(() => pipelines.dispose());
    const definitions = new Map<Lane, Pipeline>();
    for (const lane of lanes) {
      definitions.set(lane, await pipelines.createPipeline({ name: lane, steps: [{
        name: 'record', cwd: directory, run: `printf '%s\\n' ${lane} >> effects`,
      }] }));
    }
    const server = new Netron(logger);
    cleanup.push(() => server.stop());
    const socket = join(directory, 'rpc');
    server.registerTransportServer('unix', { name: 'model', options: {
      path: socket, mode: 0o600, invocationWrapper: createAuthContextWrapper(),
    } });
    server.configureAuth(new AuthenticationManager(logger, {
      authenticate: async () => { throw Error('Use the private fixture socket'); },
    }), new AuthorizationManager(logger));
    server.setTransportAuthContext('unix', {
      userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' },
    });
    const rpc = new PipelineRpcService(pipelines, { validateSession: async () => null }, {
      record: (entry, required) => auditSink.record(entry, required),
    });
    await server.peer.exposeService(rpc);
    await server.start();
    const client = new DaemonClient(socket);
    cleanup.push(() => client.disconnect());
    const service = await client.service<IOmnitronPipelinesService>('OmnitronPipelines');
    const tools = await managementClient(client);
    cleanup.push(() => tools.close());
    const runName = (id: string | null) => lanes.find(lane => ids[lane] === id) ?? String(id);
    const definitionName = (id: string) => lanes.find(lane => definitions.get(lane)!.id === id) ?? id;
    const digests = new Map<Lane, string>();
    let reply: PipelineObservation['reply'] = null;
    return {
      async act(action) {
        if (action === 'audit.off' || action === 'audit.on') {
          auditSink = action === 'audit.on' ? audit : unavailable;
          return;
        }
        const [lane, operation] = action.split('.') as [Lane, Operation];
        const definition = definitions.get(lane)!;
        const request = { runId: ids[lane], params: { batch: lane } };
        const result = await tools.call('pipeline.' + operation, operation === 'start'
          ? { ...request, expectedDigest: digests.get(lane) }
          : { ...request, id: definition.id, expectedRevision: definition.revision });
        if ('refused' in result) {
          reply = result.refused === 'Error: Audit storage is required for this operation' ? 'audit-unavailable' : result;
        } else {
          const { receipt } = result;
          const digest = receipt.review?.digest;
          reply = {
            run: runName(receipt.id), definition: definitionName(receipt.pipelineId),
            status: receipt.status === 'running' || receipt.status === 'success' ? 'started' : receipt.status,
            reviewBound: !!digest && /^[a-f0-9]{64}$/.test(digest) && (!digests.has(lane) || digests.get(lane) === digest) &&
              receipt.review?.definitionRevision === definition.revision,
          };
          if (digest && !digests.has(lane)) digests.set(lane, digest);
        }
        await waitFor(() => pipelines.activeRunCount() === 0, { interval: 5, timeout: 5_000, message: 'local Xec run did not settle' });
      },
      async observe() {
        const history = await service.listRuns();
        const intents = await db.selectFrom('omnitron_audit_log').select(['resourceId', 'action', 'actorId']).orderBy('id').execute();
        return {
          runs: history.map(row => ({ run: runName(row.id), definition: definitionName(row.pipelineId),
            status: row.status, actor: row.triggeredBy })).sort((a, b) => a.run.localeCompare(b.run)),
          effects: (await readFile(logfile, 'utf8')).split('\n').filter(Boolean),
          intents: intents.map(row => ({ run: runName(row.resourceId), action: row.action, actor: row.actorId })),
          reply,
        };
      },
      close,
    };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Pipeline fixture setup and teardown failed'); }
    throw error;
  }
}
