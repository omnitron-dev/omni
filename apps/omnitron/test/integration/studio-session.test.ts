import 'reflect-metadata';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runWithAuth } from '../../src/services/auth-context.js';
import { StudioLedger } from '../../src/studio/ledger.js';
import { StudioRpcService } from '../../src/studio/studio.rpc-service.js';
import { handleStudioTask } from '../../src/commands/studio.js';
import { readProjectSuggestion } from '../../src/shared/dto/studio-starter.js';
import { studioCatalogFromListing } from '../../src/shared/dto/studio-policy.js';
import type { StudioSend } from '../../src/shared/dto/studio.js';
import type { OmnitronAuthUser } from '../../src/shared/dto/services.js';

const alice = (id = 'alice') => ({
  userId: id,
  roles: ['operator'],
  permissions: [],
  metadata: { sessionId: 'session-' + id },
});
const local = {
  userId: 'omnitron-local',
  roles: ['admin'],
  permissions: [],
  metadata: { source: 'local-unix-socket' },
};
const account = (id: string): OmnitronAuthUser => ({ id, username: id, role: 'operator' }) as OmnitronAuthUser;
const catalog = studioCatalogFromListing('codex', 'native', 'r1', [{ id: 'standard', label: 'Standard' }]);
const request = (): StudioSend => ({
  project: 'alpha',
  provider: 'codex',
  threadId: randomUUID(),
  turnId: randomUUID(),
  after: null,
  prompt: 'Read this small project brief.',
  preferences: { role: 'analyst', result: 'analysis', model: 'standard', requirements: {} },
});

describe('Studio assignment and delivery', () => {
  let db: Database.Database, directory: string, rpc: StudioRpcService, connection: string, now: number;
  let revoked: boolean;
  const localCall = <T>(fn: () => Promise<T>) => runWithAuth(local, fn);
  const human = <T>(fn: () => Promise<T>, id = 'alice') => runWithAuth(alice(id), fn);
  beforeEach(async () => {
    now = 100_000;
    revoked = false;
    directory = mkdtempSync(join(tmpdir(), 'studio-test-'));
    db = new Database(':memory:');
    const projects = {
      getWorkspaceDirectory: () => directory,
      resolveProjectStack: async <T>(s: T) => s,
      listStacks: () => [{ name: 'dev' }],
    };
    rpc = new StudioRpcService(
      new StudioLedger(db, () => now),
      projects as never,
      {
        validateSession: async (id) => (!revoked && id.startsWith('session-') ? account(id.slice(8)) : null),
      },
      { record: async () => {} }
    );
    connection = (await localCall(() => rpc.connectAdapter({ project: 'alpha', account: 'alice', catalog, directory })))
      .connection;
  });
  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('admits one turn, retains only its response, measures actual usage and supports a reviewed follow-up', async () => {
    const data = request();
    await human(() => rpc.send(data));
    await human(() => rpc.send(data));
    const job = await localCall(() => rpc.nextTurn({ connection }));
    expect(job?.prompt).toBe(data.prompt);
    expect(await localCall(() => rpc.nextTurn({ connection }))).toBeNull();
    expect(await localCall(() => rpc.heartbeat({ connection, turnId: data.turnId, preview: 'working' }))).toEqual({
      active: true,
    });
    const read = () => rpc.thread({ project: data.project, threadId: data.threadId });
    expect((await human(read)).turns[0]?.answer).toBe('working');
    await localCall(() =>
      rpc.finishTurn({
        connection,
        turnId: data.turnId,
        result: {
          status: 'completed',
          answer: 'A short response.',
          conversation: 'native-thread',
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: null, charge: null },
        },
      })
    );
    const review = {
      project: data.project,
      threadId: data.threadId,
      turnId: data.turnId,
      previous: null,
      note: 'Checked against the example.',
      outcome: 'accepted' as const,
    };
    await human(() => rpc.review(review));
    await expect(human(() => rpc.review(review))).rejects.toThrow('current review');
    expect((await human(read)).turns[0]).toMatchObject({
      status: 'completed',
      usage: { totalTokens: null },
      review: { outcome: 'accepted' },
    });
    await human(() => rpc.send({ ...data, after: data.turnId, turnId: randomUUID(), prompt: 'Continue.' }));
    expect((await localCall(() => rpc.nextTurn({ connection })))?.conversation).toBe('native-thread');
  });

  it('keeps human accounts, project registrations, selected stacks and connector authority distinct', async () => {
    const data = request();
    await human(() => rpc.send(data));
    await expect(human(() => rpc.thread({ project: 'alpha', threadId: data.threadId }), 'bob')).rejects.toThrow(
      'unavailable'
    );
    await expect(human(() => rpc.thread({ project: 'beta', threadId: data.threadId }))).rejects.toThrow('unavailable');
    expect(
      await human(() => rpc.cancel({ project: 'alpha', threadId: data.threadId, turnId: data.turnId }), 'bob')
    ).toEqual({ status: 'withdrawn' });
    expect((await human(() => rpc.thread({ project: 'alpha', threadId: data.threadId }))).turns[0]?.status).toBe(
      'queued'
    );
    const browserAdmin = { ...alice(), roles: ['admin'] };
    await expect(runWithAuth(browserAdmin, () => rpc.nextTurn({ connection }))).rejects.toThrow();
    await expect(human(() => rpc.send({ ...request(), stack: 'missing' }))).rejects.toThrow('known stack');
    await expect(
      human(() => rpc.send({ ...request(), preferences: { role: 'analyst', result: 'patch', requirements: {} } }))
    ).rejects.toThrow('responsibility');
    await expect(
      localCall(() => rpc.connectAdapter({ project: 'alpha', account: 'alice', catalog, directory: tmpdir() }))
    ).rejects.toThrow('directory');
  });

  it('rechecks session authority before sharing a queued prompt with the provider', async () => {
    const data = request();
    await human(() => rpc.send(data));
    revoked = true;
    expect(await localCall(() => rpc.nextTurn({ connection }))).toBeNull();
    revoked = false;
    expect((await human(() => rpc.thread({ project: data.project, threadId: data.threadId }))).turns[0]).toMatchObject({
      status: 'failed',
      failure: 'authorization',
    });
  });

  it('retains partial output across disconnect and never redispatches a claimed turn', async () => {
    const data = request();
    await human(() => rpc.send(data));
    await localCall(() => rpc.nextTurn({ connection }));
    await localCall(() => rpc.heartbeat({ connection, turnId: data.turnId, preview: 'partial' }));
    now += 46_000;
    const next = (await localCall(() => rpc.connectAdapter({ project: 'alpha', account: 'alice', catalog, directory })))
      .connection;
    expect(await localCall(() => rpc.nextTurn({ connection: next }))).toBeNull();
    expect((await human(() => rpc.thread({ project: 'alpha', threadId: data.threadId }))).turns[0]).toMatchObject({
      status: 'interrupted',
      answer: 'partial',
    });
    await expect(
      localCall(() =>
        rpc.finishTurn({
          connection,
          turnId: data.turnId,
          result: { status: 'completed', answer: 'late', conversation: 'native' },
        })
      )
    ).rejects.toThrow('expired');
  });

  it('cancels claimed work and discards late provider results', async () => {
    const data = request();
    await human(() => rpc.send(data));
    await localCall(() => rpc.nextTurn({ connection }));
    await human(() => rpc.cancel({ project: 'alpha', threadId: data.threadId, turnId: data.turnId }));
    expect((await localCall(() => rpc.heartbeat({ connection, turnId: data.turnId }))).active).toBe(false);
    await localCall(() =>
      rpc.finishTurn({
        connection,
        turnId: data.turnId,
        result: { status: 'completed', answer: 'late', conversation: 'thread' },
      })
    );
    expect((await human(() => rpc.thread({ project: 'alpha', threadId: data.threadId }))).turns[0]).toMatchObject({
      status: 'cancelled',
      answer: '',
    });
  });

  it('allows an interview before the first registered project and keeps it outside project history', async () => {
    const planning = await localCall(() =>
      rpc.connectAdapter({ project: null, account: 'alice', catalog, directory: null })
    );
    const data = { ...request(), project: null };
    await human(() => rpc.send(data));
    expect(await localCall(() => rpc.nextTurn({ connection }))).toBeNull();
    expect((await localCall(() => rpc.nextTurn(planning)))?.turnId).toBe(data.turnId);
    expect((await human(() => rpc.workspace({ project: 'alpha' }))).threads).toEqual([]);
    await expect(human(() => rpc.send({ ...request(), project: null, stack: 'dev' }))).rejects.toThrow();
  });

  it('withdraws an unacknowledged request even if its original delivery arrives later', async () => {
    const data = request();
    await expect(human(() => rpc.cancel(data))).resolves.toEqual({ status: 'withdrawn' });
    await expect(human(() => rpc.send(data))).rejects.toThrow('withdrawn');
    expect(await localCall(() => rpc.nextTurn({ connection }))).toBeNull();
    await human(() => rpc.send({ ...data, turnId: randomUUID() }));
    expect((await localCall(() => rpc.nextTurn({ connection })))?.prompt).toBe(data.prompt);
  });

  it('paginates equal timestamps and long conversations inside the selected workspace and stack', async () => {
    const all: string[] = [];
    const complete = async (data: StudioSend) => {
      await human(() => rpc.send(data));
      expect((await localCall(() => rpc.nextTurn({ connection })))?.turnId).toBe(data.turnId);
      await localCall(() =>
        rpc.finishTurn({
          connection,
          turnId: data.turnId,
          result: { status: 'completed', answer: 'Done.', conversation: 'native' },
        })
      );
    };
    for (let i = 0; i < 43; i++) {
      const task = request();
      if (i % 2 === 0) task.stack = 'dev';
      await complete(task);
      all.push(task.threadId);
    }
    const first = await human(() => rpc.workspace({ project: 'alpha' }));
    const second = await human(() => rpc.workspace({ project: 'alpha', before: first.older! }));
    expect(first.threads).toHaveLength(40);
    expect(second.older).toBeNull();
    expect([...first.threads, ...second.threads].map((t) => t.id).sort()).toEqual(all.sort());
    const scoped = await human(() => rpc.workspace({ project: 'alpha', stack: 'dev' }));
    expect(scoped.threads).toHaveLength(22);
    expect(scoped.threads.every((t) => t.stack === 'dev')).toBe(true);
    const conversation = request();
    const ids = [conversation.turnId];
    await complete(conversation);
    for (let i = 0; i < 12; i++) {
      const id = randomUUID();
      await complete({ ...conversation, after: ids.at(-1)!, turnId: id });
      ids.push(id);
    }
    const current = await human(() => rpc.thread(conversation));
    const earlier = await human(() => rpc.thread({ ...conversation, before: current.beforeTurn! }));
    expect(current.turns).toHaveLength(8);
    expect(earlier.beforeTurn).toBeNull();
    expect([...earlier.turns, ...current.turns].map((t) => t.id)).toEqual(ids);
    await expect(human(() => rpc.thread({ ...conversation, before: randomUUID() }))).rejects.toThrow('cursor');
  });

  it('bounds the connector queue while retaining receipts for an identical retry', async () => {
    const initial = request();
    await human(() => rpc.send(initial));
    for (let i = 1; i < 16; i++) await human(() => rpc.send(request()));
    await expect(human(() => rpc.send(request()))).rejects.toThrow('queue is full');
    await expect(human(() => rpc.send(initial))).resolves.toMatchObject({ turnId: initial.turnId });
    await human(() => rpc.cancel(initial));
    await expect(human(() => rpc.send(request()))).resolves.toHaveProperty('turnId');
  });

  it.skipIf(process.platform === 'win32')('stops the connector on lost confirmation of an active turn', async () => {
    const data = request();
    await human(() => rpc.send(data));
    const task = await localCall(() => rpc.nextTurn({ connection }));
    const binary = join(directory, 'provider');
    writeFileSync(binary, '#!/usr/bin/env node\nsetTimeout(() => {}, 10000);\n', { mode: 0o700 });
    const localRpc = Object.create(rpc) as StudioRpcService;
    localRpc.heartbeat = async () => {
      throw Error('Private connection lost');
    };
    await expect(
      handleStudioTask(localRpc, connection, 'codex', binary, directory, task!, AbortSignal.timeout(5000))
    ).rejects.toThrow('could not confirm');
    await localCall(() => rpc.disconnectAdapter({ connection }));
    expect((await human(() => rpc.thread(data))).turns[0]?.status).toBe('interrupted');
  });

  it('passes only one validated project recommendation to the wizard', () => {
    const needs = { automation: false, persistence: 'sqlite', service: 'none' };
    const block = '```json\n' + JSON.stringify(needs) + '\n```';
    expect(readProjectSuggestion('A local database fits.\n' + block)).toEqual(needs);
    expect(readProjectSuggestion(block + '\n' + block)).toBeNull();
    expect(readProjectSuggestion(JSON.stringify({ ...needs, command: 'extra' }))).toBeNull();
    expect(readProjectSuggestion(JSON.stringify({ ...needs, persistence: 'none' }))).toBeNull();
  });
});
