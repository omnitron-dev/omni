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
  readProjectSuggestion,
  STUDIO_PROVIDERS,
  type IOmnitronStudioService,
  type StudioSend,
} from '../../src/shared/dto/studio.js';

// An explicit invocation uses four synthetic turns on the selected local subscription.
for (const provider of STUDIO_PROVIDERS) {
  const executable = process.env['OMNITRON_STUDIO_LIVE_' + provider.toUpperCase()];
  it.skipIf(!executable)(
    provider + ' subscription resumes a conversation and interviews an operator for a minimal project',
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
        async function deliver(link: string, request: StudioSend) {
          const receipt = await api.send(request);
          const job = await api.nextTurn({ connection: link });
          expect(job?.turnId).toBe(receipt.turnId);
          await handleStudioTask(api, link, provider, executable!, scratch, job!, AbortSignal.timeout(190_000));
          const transcript = await api.thread({ project: request.project, threadId: request.threadId });
          const answer = transcript.turns.at(-1)!;
          expect({ status: answer.status, failure: answer.failure }).toEqual({ status: 'completed', failure: null });
          expect(answer.usage?.inputTokens).toBeGreaterThan(0);
          return answer;
        }
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
          const answer = await deliver(connection, request);
          expect(answer.answer.trim()).toBe(marker);
          previous = request.turnId;
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
          preferences: { purpose: 'project-interview', role: 'analyst', result: 'analysis', model, requirements: {} },
          prompt: 'I need a way to produce reports. I have not yet told you how they run or where to store them.',
        } satisfies StudioSend;
        const question = await deliver(planner.connection, brief);
        expect(question.answer).toContain('?');
        expect(readProjectSuggestion(question.answer)).toBeNull();
        const recommendation = await deliver(planner.connection, {
          ...brief,
          turnId: randomUUID(),
          after: brief.turnId,
          prompt:
            'I need a repeatable Xec task to store a weekly report in a local embedded SQLite file. I invoke it manually on my laptop. No server or persistent process is needed. These are all the requirements.',
        });
        const suggested = readProjectSuggestion(recommendation.answer);
        expect(suggested).toEqual({ automation: true, persistence: 'sqlite', service: 'none' });
        const { manifest } = planStarter('weekly-report', suggested!);
        expect(Object.keys(manifest.dependencies).sort()).toEqual([
          '@kysera/executor',
          '@xec-sh/core',
          'better-sqlite3',
          'kysely',
        ]);
        expect(manifest.stack).toBeNull();
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
