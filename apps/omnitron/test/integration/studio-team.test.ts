import 'reflect-metadata';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthContextWrapper, runWithAuth } from '../../src/services/auth-context.js';
import { openStudioMcp } from '../../src/studio/team-mcp.js';
import { StudioLedger } from '../../src/studio/ledger.js';
import { StudioRpcService } from '../../src/studio/studio.rpc-service.js';
import { diskSpaceFlow } from '../../src/shared/dto/flows.js';
import {
  STUDIO_PROVIDER_LIMIT,
  studioCatalogFromListing,
  type StudioModelCatalog,
} from '../../src/shared/dto/studio-policy.js';
import type { IOmnitronStudioService, StudioProvider, StudioTeamTool } from '../../src/shared/dto/studio.js';
import type { OmnitronAuthUser } from '../../src/shared/dto/services.js';

const directory = process.cwd();
const local = {
  userId: 'omnitron-local',
  roles: ['admin'],
  permissions: [],
  metadata: { source: 'local-unix-socket' },
};
const localCall = <T>(fn: () => Promise<T>) => runWithAuth(local, fn);
const asUser = <T>(fn: () => Promise<T>, id = 'a') =>
  runWithAuth({ userId: id, roles: ['operator'], permissions: [], metadata: { sessionId: 'session-' + id } }, fn);
function catalog(
  provider: StudioProvider,
  model: string,
  cost: 'economy' | 'standard',
  teamTools = true
): StudioModelCatalog {
  const result = studioCatalogFromListing(provider, provider + '-local', 'v1', [{ id: model, label: model }]);
  return {
    ...result,
    teamTools,
    models: result.models.map((m) => ({
      ...m,
      classes: ['general', 'code', 'reasoning'],
      costTier: cost,
      qualityTier: 'standard',
    })),
  };
}
const preferences = { role: 'analyst', result: 'analysis', model: 'lead-model', requirements: {} } as const;
const project = 'reports';
describe('Studio runs a mixed-provider team through the operator and connector APIs', () => {
  let db: Database.Database, rpc: StudioRpcService, lead: string, worker: string, room: string, revoked: boolean;
  const base = () => ({ project, threadId: room });
  const tool = (connection: string, turnId: string, name: StudioTeamTool, args: Record<string, unknown> = {}) =>
    localCall(() => rpc.teamTool({ connection, turnId, name, arguments: args }));
  const finish = (connection: string, turnId: string, answer: string, conversation: string) =>
    localCall(() => rpc.finishTurn({ connection, turnId, result: { status: 'completed', answer, conversation } }));
  const post = (memberId: string, text: string, kind: 'message' | 'task' = 'message') =>
    asUser(() => rpc.post({ ...base(), memberId, kind, turnId: randomUUID(), text }));
  const claim = (connection: string) => localCall(() => rpc.nextTurn({ connection }));
  beforeEach(async () => {
    db = new Database(':memory:');
    revoked = false;
    room = randomUUID();
    rpc = new StudioRpcService(
      new StudioLedger(db),
      {
        getWorkspaceDirectory: () => directory,
        resolveProjectStack: async (s: unknown) => s,
        listStacks: () => [{ name: 'dev' }],
      } as never,
      {
        validateSession: async (session) =>
          revoked ? null : ({ id: session.slice(8), role: 'operator' } as OmnitronAuthUser),
      },
      { record: async () => {} }
    );
    lead = (
      await localCall(() =>
        rpc.connectAdapter({
          directory,
          project,
          account: 'a',
          catalog: catalog('codex', 'lead-model', 'standard'),
          capacity: 2,
        })
      )
    ).connection;
    worker = (
      await localCall(() =>
        rpc.connectAdapter({
          directory,
          project,
          account: 'a',
          catalog: catalog('agy', 'compact', 'economy'),
          capacity: 2,
        })
      )
    ).connection;
    await asUser(() =>
      rpc.createTeam({
        ...base(),
        title: 'Delivery',
        name: 'Coordinator',
        provider: 'codex',
        preferences,
        policy: { providers: ['agy', 'codex'], maxDelegations: 4, maxMembers: 4, maxCostTier: 'standard' },
      })
    );
  });
  afterEach(() => db.close());

  it('connects an independently named specialist over private Netron and delegates only after its room owner approves it', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'studio-ext-'));
    const logger = createNullLogger();
    const server = new Netron(logger),
      client = new Netron(logger);
    const socket = join(scratch, 'rpc');
    const stop = new AbortController();
    const mcp = new Client({ name: 'sample-lead', version: '1' });
    let endpoint: Awaited<ReturnType<typeof openStudioMcp>> | undefined;
    const provider = 'example.org/research';
    try {
      server.registerTransportServer('unix', {
        name: 'studio',
        options: { path: socket, mode: 0o600, invocationWrapper: createAuthContextWrapper() },
      });
      server.configureAuth(
        new AuthenticationManager(logger, {
          authenticate: async () => {
            throw Error('Use the fixture socket');
          },
        }),
        new AuthorizationManager(logger)
      );
      server.setTransportAuthContext('unix', local);
      await server.peer.exposeService(rpc);
      await server.start();
      client.registerTransport('unix', () => new UnixSocketTransport());
      const peer = await client.connect('unix://' + socket, false);
      const adapter = await peer.queryInterface<IOmnitronStudioService>('OmnitronStudio');
      const registration = {
        project,
        directory,
        account: 'a',
        catalog: catalog(provider, 'specialist', 'economy', false),
      };
      const other = await adapter.connectAdapter({ ...registration, account: 'b' });
      for (const invalid of [
        { ...registration.catalog, models: [{ ...registration.catalog.models[0]!, label: '文'.repeat(90_000) }] },
        { ...registration.catalog, localSettings: 'connector only' },
        { ...registration.catalog, models: [{ ...registration.catalog.models[0]!, localSettings: 'connector only' }] },
        {
          ...registration.catalog,
          models: [
            {
              ...registration.catalog.models[0]!,
              price: { amount: 1, unit: 'request', localSettings: 'connector only' },
            },
          ],
        },
      ])
        await expect(adapter.connectAdapter({ ...registration, catalog: invalid })).rejects.toThrow('catalog');
      expect((await asUser(() => rpc.workspace({ project }))).catalogs.map((c) => c.provider)).not.toContain(provider);
      await expect(asUser(() => rpc.connectAdapter(registration))).rejects.toThrow('admin');
      const { connection } = await adapter.connectAdapter(registration);
      const privateRequest = {
        ...base(),
        threadId: randomUUID(),
        turnId: randomUUID(),
        provider,
        preferences: { ...preferences, model: 'specialist' },
        after: null,
        prompt: 'Private sample',
      } as const;
      await asUser(() => rpc.send(privateRequest));
      expect(await adapter.nextTurn(other)).toBeNull();
      expect(await adapter.nextTurn({ connection })).toMatchObject({
        turnId: privateRequest.turnId,
        prompt: privateRequest.prompt,
      });
      await adapter.finishTurn({
        connection,
        turnId: privateRequest.turnId,
        result: { status: 'completed', answer: 'Private result', conversation: 'private-local-session' },
      });
      const previous = (await asUser(() => rpc.thread(base()))).team.policy!;
      const excess = Array.from({ length: STUDIO_PROVIDER_LIMIT }, (_, i) => `example.org/model-${i}` as const);
      await expect(
        asUser(() =>
          rpc.configureTeam({
            ...base(),
            previous,
            policy: { ...previous, providers: ['codex', ...excess] },
          })
        )
      ).rejects.toThrow('team providers');
      const invite = { provider, name: 'Researcher', role: 'analyst' } as const;
      const denied = (await post(room, 'List approved providers')).turnId;
      await claim(lead);
      expect(await tool(lead, denied, 'team_catalog')).not.toContainEqual(expect.objectContaining({ provider }));
      await expect(tool(lead, denied, 'team_invite', invite)).rejects.toThrow('approved provider');
      await finish(lead, denied, 'Ready for review', 'lead-session');
      await asUser(() =>
        rpc.configureTeam({
          ...base(),
          previous,
          policy: { ...previous, providers: [...previous.providers, provider] },
        })
      );

      const leadTurn = (await post(room, 'Collect a specialist response')).turnId;
      expect((await adapter.nextTurn({ connection: lead }))?.turnId).toBe(leadTurn);
      endpoint = await openStudioMcp(stop.signal, (name, args) =>
        adapter.teamTool({ connection: lead, turnId: leadTurn, name, arguments: args })
      );
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(endpoint.url), {
          requestInit: { headers: { authorization: 'Bearer ' + endpoint.token } },
        })
      );
      const invited = await mcp.callTool({ name: 'team_invite', arguments: invite });
      expect(invited.isError).not.toBe(true);
      const memberId = (await asUser(() => rpc.thread(base()))).team.members.find((m) => m.provider === provider)!.id;
      const assigned = await mcp.callTool({ name: 'team_assign', arguments: { memberId, task: 'Check the sample' } });
      expect(assigned.isError).not.toBe(true);
      await finish(lead, leadTurn, 'Delegated', 'lead-session');
      expect(await adapter.nextTurn(other)).toBeNull();
      const job = await adapter.nextTurn({ connection });
      expect(job).toMatchObject({ prompt: 'Check the sample', model: 'specialist', conversation: null });
      expect(job?.teamTools).toBeUndefined();
      await expect(
        adapter.teamTool({ connection, turnId: job!.turnId, name: 'team_state', arguments: {} })
      ).rejects.toThrow('no team tool');
      expect(await adapter.heartbeat({ connection, turnId: job!.turnId, preview: 'Checking' })).toEqual({
        active: true,
      });
      await adapter.finishTurn({
        connection,
        turnId: job!.turnId,
        result: { status: 'completed', answer: 'Sample verified', conversation: 'member-local-session' },
      });
      const summary = await adapter.nextTurn({ connection: lead });
      expect(summary).toMatchObject({ conversation: 'lead-session' });
      expect(
        await adapter.teamTool({
          connection: lead,
          turnId: summary!.turnId,
          name: 'team_state',
          arguments: { turnId: job!.turnId },
        })
      ).toMatchObject({ answer: 'Sample verified' });
      await finish(lead, summary!.turnId, 'Specialist verified the sample', 'lead-session');
      await adapter.disconnectAdapter({ connection });
      expect((await asUser(() => rpc.thread(base()))).turns.at(-1)?.status).toBe('completed');
    } finally {
      stop.abort();
      await mcp.close();
      await endpoint?.close();
      await client.stop();
      await server.stop();
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('confirms only the exact admitted room command after its member and connector leave', async () => {
    const memberId = randomUUID();
    await asUser(() => rpc.addMember({ ...base(), memberId, name: 'Editor', provider: 'codex', preferences }));
    const message = { ...base(), turnId: randomUUID(), memberId, kind: 'task' as const, text: 'Review the table' };
    expect(await asUser(() => rpc.postReceipt(message))).toBeNull();
    const receipt = await asUser(() => rpc.post(message));
    await asUser(() => rpc.retireMember({ ...base(), memberId }));
    await localCall(() => rpc.disconnectAdapter({ connection: lead }));
    expect(await asUser(() => rpc.postReceipt(message))).toEqual(receipt);
    expect(await asUser(() => rpc.post(message))).toEqual(receipt);
    const turns = (await asUser(() => rpc.thread(base()))).turns;
    expect(turns).toMatchObject([{ id: message.turnId, status: 'cancelled' }]);
    for (const change of [{ text: 'Changed' }, { memberId: room }, { kind: 'message' as const }])
      await expect(asUser(() => rpc.postReceipt({ ...message, ...change }))).rejects.toThrow('identity');
    await expect(asUser(() => rpc.postReceipt(message, 'other-stack'))).rejects.toThrow('stack');
    await expect(asUser(() => rpc.postReceipt(message), 'another-user')).rejects.toThrow('workspace');
    await expect(asUser(() => rpc.postReceipt({ ...message, project: 'another-project' }))).rejects.toThrow(
      'workspace'
    );
    await expect(asUser(() => rpc.post({ ...message, turnId: randomUUID() }))).rejects.toThrow('Member is unavailable');
    revoked = true;
    await expect(asUser(() => rpc.postReceipt(message))).rejects.toThrow('Session');
  });

  it('enlists by role and cost, runs two workers concurrently, exchanges data, and synthesises once on the original lead session', async () => {
    const parent = (await post(room, 'Compare the two approaches')).turnId;
    expect((await claim(lead))?.teamTools).toBe(true);
    const inviteArgs = { name: 'Reviewer', role: 'reviewer' };
    const reviewer = ((await tool(lead, parent, 'team_invite', inviteArgs)) as { memberId: string }).memberId;
    expect(await tool(lead, parent, 'team_invite', inviteArgs)).toEqual({ memberId: reviewer });
    const analyst = (
      (await tool(lead, parent, 'team_invite', { name: 'Analyst', role: 'analyst' })) as { memberId: string }
    ).memberId;
    const assignment = { memberId: reviewer, task: 'Inspect the interface', requestId: randomUUID() };
    const a = (await tool(lead, parent, 'team_assign', assignment)) as { turnId: string };
    expect(await tool(lead, parent, 'team_assign', assignment)).toEqual(a);
    await expect(tool(lead, parent, 'team_assign', { ...assignment, task: 'Changed contents' })).rejects.toThrow(
      'identity'
    );
    const b = (await tool(lead, parent, 'team_assign', { memberId: analyst, task: 'Count the entry points' })) as {
      turnId: string;
    };
    const jobs = await Promise.all([claim(worker), claim(worker)]);
    // Two independent claims can race on the same oldest row. Its loser polls again without duplicating work.
    const second = jobs.every(Boolean) ? jobs[1] : await claim(worker);
    expect([jobs.find(Boolean)?.turnId, second?.turnId].sort()).toEqual([a.turnId, b.turnId].sort());
    const state = (await tool(worker, a.turnId, 'team_state')) as {
      self: string;
      lead: string;
      members: { provider: string; model: string; id: string }[];
    };
    expect(state.members.find((m) => m.id === reviewer)).toMatchObject({ provider: 'agy', model: 'compact' });
    expect(state.lead).toBe(room);
    const inbox = await asUser(() => rpc.thread({ ...base(), includeTasks: false }));
    expect(inbox.team.hasActiveTurns).toBe(true);
    expect(inbox.team.tasks).toEqual([]);
    expect(
      await tool(worker, a.turnId, 'team_note', { key: 'invariant', text: 'Use the registered project.', revision: 0 })
    ).toMatchObject({ authorId: reviewer, revision: 1 });
    await expect(
      tool(worker, b.turnId, 'team_note', { key: 'invariant', text: 'Concurrent overwrite', revision: 0 })
    ).rejects.toThrow('revision');
    await expect(tool(worker, a.turnId, 'team_assign', { memberId: analyst, task: 'Unapproved' })).rejects.toThrow(
      'lead'
    );
    await tool(worker, a.turnId, 'team_message', { memberId: analyst, text: 'I checked the first entry.' });
    await finish(lead, parent, 'Review in progress.', 'lead-private');
    await finish(worker, a.turnId, 'Interface passed.', 'review-private');
    expect(await claim(lead)).toBeNull();
    await finish(worker, b.turnId, 'Two entry points.', 'analyst-private');
    const follow = await claim(lead);
    expect(follow?.conversation).toBe('lead-private');
    expect(follow?.prompt).toContain(a.turnId);
    expect(await tool(lead, follow!.turnId, 'team_state', { turnId: a.turnId })).toMatchObject({
      answer: 'Interface passed.',
    });
    expect((await claim(worker))?.conversation).toBe('analyst-private');
    await finish(lead, follow!.turnId, 'The interface has two tested entries.', 'lead-private');
    expect(await claim(lead)).toBeNull();
    const history = await asUser(() => rpc.thread(base()));
    expect(history.turns.filter((t) => t.kind === 'summary')).toHaveLength(1);
    expect(history.team.tasks).toHaveLength(2);
    expect(history.team.notes).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain('review-private');
  });

  it('binds the bridge to its current turn, operator and team; withdrawal stops further writes', async () => {
    const job = (await post(room, 'Prepare a review')).turnId;
    await claim(lead);
    await expect(tool(worker, job, 'team_state')).rejects.toThrow('active');
    await expect(
      asUser(() => rpc.teamTool({ connection: lead, turnId: job, name: 'team_catalog', arguments: {} }))
    ).rejects.toThrow();
    await expect(asUser(() => rpc.thread(base()), 'b')).rejects.toThrow('unavailable');
    await expect(tool(lead, job, 'team_state', { turnId: randomUUID() })).rejects.toThrow('outside');
    const request = { ...base(), turnId: randomUUID(), memberId: room, kind: 'message' as const, text: 'Do not send' };
    await asUser(() => rpc.cancel(request));
    await expect(asUser(() => rpc.post(request))).rejects.toThrow('withdrawn');
    revoked = true;
    await expect(tool(lead, job, 'team_note', { key: 'x', text: 'stale', revision: 0 })).rejects.toThrow('session');
    revoked = false;
    expect((await asUser(() => rpc.thread(base()))).team.notes).toEqual([]);
    expect(await claim(lead)).toBeNull();
  });

  it('lets the lead preview and propose the same typed graph the editor opens, without activating it', async () => {
    const job = (await post(room, 'Propose a disk monitor')).turnId;
    await claim(lead);
    const definition = diskSpaceFlow('/sample', 100, 120);
    const event = { id: '1', source: 'disk', type: 'host.disk.sample', data: { freeBytes: 90, totalBytes: 300 } };
    expect(await tool(lead, job, 'flow_preview', { definition, event })).toMatchObject({
      effects: [{ kind: 'notification' }],
    });
    const proposal = (await tool(lead, job, 'flow_propose', { definition })) as { id: string };
    expect(await tool(lead, job, 'flow_propose', { definition })).toEqual(proposal);
    expect(await asUser(() => rpc.flowProposal({ ...base(), proposalId: proposal.id }))).toEqual({
      definition,
      stack: null,
    });
    await expect(asUser(() => rpc.flowProposal({ ...base(), proposalId: proposal.id }), 'b')).rejects.toThrow(
      'unavailable'
    );
    expect((await asUser(() => rpc.thread(base()))).team.proposals).toHaveLength(1);
  });

  it('starts the first shared turn in a fresh provider conversation and keeps the private journal with its owner', async () => {
    const threadId = randomUUID();
    const address = { project, threadId };
    const privateId = randomUUID();
    await asUser(() =>
      rpc.send({
        ...address,
        turnId: privateId,
        provider: 'codex',
        preferences,
        after: null,
        prompt: 'A private draft',
      })
    );
    expect((await claim(lead))?.turnId).toBe(privateId);
    await finish(lead, privateId, 'An individual response', 'individual-session');
    const policy = (await asUser(() => rpc.thread(base()))).team.policy!;
    await asUser(() => rpc.configureTeam({ ...address, previous: null, policy }));
    const share = async (text: string) => {
      const turnId = randomUUID();
      await asUser(() => rpc.post({ ...address, turnId, memberId: threadId, text, kind: 'message' }));
      const dispatched = await claim(lead);
      expect(dispatched?.turnId).toBe(turnId);
      return { turnId, conversation: dispatched!.conversation };
    };
    const first = await share('Start a joint review');
    expect(first.conversation).toBeNull();
    await expect(tool(lead, first.turnId, 'team_state', { turnId: privateId })).rejects.toThrow('outside');
    const overview = await tool(lead, first.turnId, 'team_state');
    expect(JSON.stringify(overview)).not.toContain('A private draft');
    await finish(lead, first.turnId, 'Shared result', 'team-session');
    await asUser(() => rpc.configureTeam({ ...address, previous: policy, policy: { ...policy, maxDelegations: 5 } }));
    expect((await share('Continue together')).conversation).toBe('team-session');
    expect((await asUser(() => rpc.thread(address))).turns.find((t) => t.id === privateId)?.answer).toBe(
      'An individual response'
    );
  });

  it('enforces the root budget even when the last worker messages a different adapter', async () => {
    const current = (await asUser(() => rpc.thread(base()))).team.policy!;
    await asUser(() => rpc.configureTeam({ ...base(), previous: current, policy: { ...current, maxDelegations: 1 } }));
    const job = (await post(room, 'One assignment')).turnId;
    await claim(lead);
    const { memberId } = (await tool(lead, job, 'team_invite', { name: 'Check', role: 'analyst' })) as {
      memberId: string;
    };
    const a = (await tool(lead, job, 'team_assign', { memberId, task: 'Check locally' })) as { turnId: string };
    await claim(worker);
    await expect(tool(worker, a.turnId, 'team_message', { memberId: room, text: 'Second dispatch' })).rejects.toThrow(
      'budget'
    );
    await asUser(() => rpc.retireMember({ ...base(), memberId }));
    await expect(tool(worker, a.turnId, 'team_state')).rejects.toThrow('active');
    expect((await asUser(() => rpc.thread(base()))).team.tasks[0]?.status).toBe('cancelled');
  });
});
