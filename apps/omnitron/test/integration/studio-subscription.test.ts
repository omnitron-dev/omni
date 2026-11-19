import 'reflect-metadata';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { DaemonClient } from '../../src/daemon/daemon-client.js';
import { StudioRpcService } from '../../src/studio/studio.rpc-service.js';
import { StudioLedger } from '../../src/studio/ledger.js';
import { handleStudioTask } from '../../src/commands/studio.js';
import { studioCatalog } from '../../src/studio/adapters.js';
import { planStarter } from '../../src/project/starter-plan.js';
import {
  projectInterview,
  readProjectSuggestion,
  STUDIO_PROVIDERS,
  type IOmnitronStudioService,
  type StudioSend,
} from '../../src/shared/dto/studio.js';

// An explicit invocation uses three synthetic turns on the selected local subscription.
for (const provider of STUDIO_PROVIDERS) {
  const executable = process.env['OMNITRON_STUDIO_LIVE_' + provider.toUpperCase()];
  it.skipIf(!executable)(
    provider + ' subscription retains conversation context across two private Netron requests',
    async () => {
      const scratch = await mkdtemp(join(tmpdir(), 'studio-live-'));
      const database = new Database(':memory:');
      const logger = createNullLogger();
      const server = new Netron(logger);
      const socket = join(scratch, 'rpc');
      const client = new DaemonClient(socket);
      try {
        server.registerTransportServer('unix', {
          name: 'studio',
          options: { path: socket, mode: 0o600, invocationWrapper: createAuthContextWrapper() },
        });
        server.configureAuth(
          new AuthenticationManager(logger, {
            authenticate: async () => {
              throw Error('Use the private test socket');
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
        const projects = { getWorkspaceDirectory: () => scratch };
        await server.peer.exposeService(
          new StudioRpcService(
            new StudioLedger(database),
            projects as never,
            { validateSession: async () => null },
            { record: async () => {} }
          )
        );
        await server.start();
        const api = await client.service<IOmnitronStudioService>('OmnitronStudio');
        const catalog = await studioCatalog(provider, executable!, scratch);
        const model = process.env['OMNITRON_STUDIO_MODEL_' + provider.toUpperCase()];
        if (!model || !catalog.models.some((entry) => entry.id === model))
          throw Error('Select one current model for the subscription check');
        const { connection } = await api.connectAdapter({
          project: 'sample',
          account: 'omnitron-local',
          directory: scratch,
          catalog,
        });
        const threadId = randomUUID();
        let previous: string | null = null;
        const marker = 'Orbit-' + randomUUID().slice(0, 6);
        for (const prompt of [
          'Remember this marker and reply with that marker only: ' + marker,
          'Repeat only the marker from my previous message.',
        ]) {
          const request: StudioSend = {
            project: 'sample',
            threadId,
            turnId: randomUUID(),
            after: previous,
            provider,
            prompt,
            preferences: { role: 'analyst', result: 'analysis', model, requirements: {} },
          };
          const receipt = await api.send(request);
          const job = await api.nextTurn({ connection });
          expect(job?.turnId).toBe(receipt.turnId);
          await handleStudioTask(api, connection, provider, executable!, scratch, job!, AbortSignal.timeout(190_000));
          const { turns } = await api.thread({ project: 'sample', threadId });
          const answer = turns.at(-1)!;
          expect({ status: answer.status, failure: answer.failure }).toEqual({ status: 'completed', failure: null });
          expect(answer.answer.trim()).toBe(marker);
          expect(answer.usage?.inputTokens).toBeGreaterThan(0);
          previous = receipt.turnId;
        }
        await api.disconnectAdapter({ connection });
        const planner = await api.connectAdapter({
          project: null,
          account: 'omnitron-local',
          directory: null,
          catalog,
        });
        const brief = {
          project: null,
          threadId: randomUUID(),
          turnId: randomUUID(),
          after: null,
          provider,
          preferences: { role: 'analyst', result: 'analysis', model, requirements: {} },
          prompt:
            projectInterview +
            '\nI need a repeatable Xec task to record one report in an embedded SQLite database on my laptop. I will invoke it manually. No server or persistent process is needed.',
        } satisfies StudioSend;
        await api.send(brief);
        const job = await api.nextTurn(planner);
        expect(job?.turnId).toBe(brief.turnId);
        await handleStudioTask(
          api,
          planner.connection,
          provider,
          executable!,
          scratch,
          job!,
          AbortSignal.timeout(190_000)
        );
        const [recommendation] = (await api.thread({ project: null, threadId: brief.threadId })).turns;
        expect(recommendation?.status).toBe('completed');
        const suggested = readProjectSuggestion(recommendation!.answer);
        expect(suggested).toEqual({ automation: true, persistence: 'sqlite', service: 'none' });
        const { manifest } = planStarter('weekly-report', suggested!);
        expect(Object.keys(manifest.dependencies).sort()).toEqual([
          '@kysera/executor',
          '@xec-sh/core',
          'better-sqlite3',
          'kysely',
        ]);
        expect(manifest.stack).toBeNull();
        expect(recommendation!.usage?.inputTokens).toBeGreaterThan(0);
        await api.disconnectAdapter(planner);
      } finally {
        try {
          await client.disconnect();
        } finally {
          await server.stop();
          database.close();
          await rm(scratch, { recursive: true, force: true });
        }
      }
    },
    420_000
  );
}
