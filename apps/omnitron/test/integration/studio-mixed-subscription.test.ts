import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createAuthContextWrapper, runWithAuth } from '../../src/services/auth-context.js';
import { DaemonClient } from '../../src/daemon/daemon-client.js';
import { StudioRpcService } from '../../src/studio/studio.rpc-service.js';
import { StudioLedger } from '../../src/studio/ledger.js';
import { serveStudioConnection } from '../../src/commands/studio.js';
import { studioCatalog } from '../../src/studio/adapters.js';
import type { IOmnitronStudioService, StudioTeamTool } from '../../src/shared/dto/studio.js';
import type { OmnitronAuthUser } from '../../src/shared/dto/services.js';

const providers = ['codex', 'agy'] as const;
const live = providers.every((p) => Boolean(process.env['OMNITRON_STUDIO_MIXED_' + p.toUpperCase()]));

// Opt in to one lead request, one specialist request, and one synthesis on two local subscriptions.
it.skipIf(!live)(
  'delegates to a real Antigravity member and synthesizes its recorded answer through Codex MCP',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'studio-mixed-'));
    const database = new Database(':memory:');
    const logger = createNullLogger();
    const server = new Netron(logger);
    const socket = join(scratch, 'rpc');
    const client = new DaemonClient(socket);
    const account = 'example-operator';
    const session = randomUUID();
    const human = <T>(fn: () => Promise<T>) =>
      runWithAuth(
        {
          userId: account,
          roles: ['operator'],
          permissions: [],
          metadata: { sessionId: session },
        },
        fn
      );
    const room = { project: 'consultation-sample', threadId: randomUUID() };
    const audit: { action: string; resourceId?: string }[] = [];
    const stop = new AbortController();
    const deadline = AbortSignal.timeout(190_000);
    const signal = AbortSignal.any([stop.signal, deadline]);
    const runners: Promise<void>[] = [];
    let workerFailure: unknown;
    try {
      const rpc = new StudioRpcService(
        new StudioLedger(database),
        { getWorkspaceDirectory: () => scratch } as never,
        {
          validateSession: async (id) =>
            id === session ? ({ id: account, role: 'operator' } as OmnitronAuthUser) : null,
        },
        {
          record: async (entry) => {
            audit.push({ action: entry.action, ...(entry.resourceId && { resourceId: entry.resourceId }) });
          },
        }
      );
      server.registerTransportServer('unix', {
        name: 'studio',
        options: { path: socket, mode: 0o600, invocationWrapper: createAuthContextWrapper() },
      });
      server.configureAuth(
        new AuthenticationManager(logger, {
          authenticate: async () => {
            throw Error('Use the test socket');
          },
        }),
        new AuthorizationManager(logger)
      );
      server.setTransportAuthContext('unix', {
        userId: 'omnitron-local',
        roles: ['admin'],
        permissions: [],
        metadata: { source: 'local-unix-socket' },
      });
      await server.peer.exposeService(rpc);
      await server.start();
      const adapter = await client.service<IOmnitronStudioService>('OmnitronStudio');
      const model = (p: (typeof providers)[number]) => process.env['OMNITRON_STUDIO_MODEL_' + p.toUpperCase()]!;
      const receipts: { turn: string; name: StudioTeamTool; read: unknown }[] = [];
      const nativeSessions = new Map<string, string>();
      let issued = 0;
      for (const provider of providers) {
        const executable = process.env['OMNITRON_STUDIO_MIXED_' + provider.toUpperCase()]!;
        const policy = join(scratch, provider + '.json');
        await writeFile(
          policy,
          JSON.stringify([{ id: model(provider), classes: ['general', 'reasoning'], costTier: 'economy' }]),
          { mode: 0o600 }
        );
        const catalog = await studioCatalog(provider, executable, scratch, policy);
        expect(catalog.teamTools).toBe(provider === 'codex');
        const { connection } = await adapter.connectAdapter({
          project: room.project,
          account,
          directory: scratch,
          catalog,
        });
        const observed = {
          async nextTurn(data: { connection: string }) {
            const job = await adapter.nextTurn(data);
            if (job && ++issued > 3) throw Error('Exceeded the three-turn live test budget');
            return job;
          },
          heartbeat: (data: Parameters<typeof adapter.heartbeat>[0]) => adapter.heartbeat(data),
          async finishTurn(data: Parameters<typeof adapter.finishTurn>[0]) {
            if (data.result.status === 'completed') nativeSessions.set(data.turnId, data.result.conversation);
            await adapter.finishTurn(data);
          },
          async teamTool(data: Parameters<typeof adapter.teamTool>[0]) {
            const result = await adapter.teamTool(data);
            receipts.push({ turn: data.turnId, name: data.name, read: data.arguments['turnId'] });
            return result;
          },
        };
        runners.push(
          serveStudioConnection(observed, connection, provider, executable, scratch, 1, signal).catch((error) => {
            workerFailure = error;
            stop.abort();
          })
        );
      }
      await human(() =>
        rpc.createTeam({
          ...room,
          title: 'Synthetic handoff',
          name: 'Coordinator',
          provider: 'codex',
          preferences: { role: 'analyst', result: 'analysis', requirements: {}, model: model('codex') },
          policy: { providers: ['codex', 'agy'], maxMembers: 2, maxDelegations: 1, maxCostTier: 'economy' },
        })
      );
      const { turnId } = await human(() =>
        rpc.post({
          ...room,
          turnId: randomUUID(),
          memberId: room.threadId,
          kind: 'message',
          text: 'Check team_catalog, call team_invite with provider agy and role analyst. Leave model unspecified so the approved economy policy selects it. Use the returned memberId in team_assign. Ask the analyst to invent and return one badge code, consisting of SAMPLE, a hyphen, four uppercase Latin letters, another hyphen and four digits. Leave the choice of letters and digits entirely to the analyst. End this turn after assigning. In your later synthesis, read the assignment result by turn ID with team_state and report the exact code the specialist supplied.',
        })
      );
      let history = await human(() => rpc.thread(room));
      while (
        !signal.aborted &&
        !history.turns.some((t) => t.status === 'failed' || (t.kind === 'summary' && t.status === 'completed'))
      ) {
        await delay(250);
        history = await human(() => rpc.thread(room));
        if (history.turns.length === 1 && history.turns[0]?.status === 'completed' && !history.team.tasks.length) break;
      }
      if (workerFailure) throw workerFailure;
      expect(
        history.turns.map((t) => [t.kind, t.status, t.failure]),
        'Successful MCP calls: ' + receipts.map((row) => row.name).join(', ')
      ).toEqual([
        ['message', 'completed', null],
        ['task', 'completed', null],
        ['summary', 'completed', null],
      ]);
      const [lead, specialist, summary] = history.turns;
      expect(history.team.members.find((m) => m.id === specialist!.memberId)).toMatchObject({
        provider: 'agy',
        lead: false,
      });
      expect(receipts.filter((r) => r.turn === turnId).map((r) => r.name)).toEqual(
        expect.arrayContaining(['team_catalog', 'team_invite', 'team_assign'])
      );
      expect(receipts).toContainEqual({ turn: summary!.id, name: 'team_state', read: specialist!.id });
      expect(audit.some((a) => a.action === 'studio.tool.team_assign' && a.resourceId === turnId)).toBe(true);
      expect(nativeSessions.get(lead!.id)).toBe(nativeSessions.get(summary!.id));
      const badge = specialist!.answer.match(/\bSAMPLE-[A-Z]{4}-\d{4}\b/)?.[0];
      expect(badge).toBeTruthy();
      expect(specialist!.prompt).not.toContain(badge);
      expect(summary!.answer).toContain(badge);
      expect(issued).toBe(3);
      console.info(
        'Studio mixed subscription:',
        history.turns.map((t) => ({
          kind: t.kind,
          provider: t.kind === 'task' ? 'agy' : 'codex',
          input: t.usage?.inputTokens,
          output: t.usage?.outputTokens,
        })),
        'MCP calls',
        receipts.map((r) => r.name)
      );
    } finally {
      stop.abort();
      await Promise.allSettled(runners);
      await client.disconnect();
      await server.stop();
      database.close();
      await rm(scratch, { recursive: true, force: true });
    }
  },
  220_000
);
