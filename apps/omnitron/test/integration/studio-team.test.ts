import 'reflect-metadata';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runWithAuth } from '../../src/services/auth-context.js';
import { StudioLedger } from '../../src/studio/ledger.js';
import { StudioRpcService } from '../../src/studio/studio.rpc-service.js';
import { diskSpaceFlow } from '../../src/shared/dto/flows.js';
import { studioCatalogFromListing, type StudioModelCatalog } from '../../src/shared/dto/studio-policy.js';
import type { IOmnitronStudioService, StudioTeamTool } from '../../src/shared/dto/studio.js';
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
  provider: 'codex' | 'agy',
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
  let db: Database.Database, rpc: IOmnitronStudioService, lead: string, worker: string, room: string, revoked: boolean;
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
    expect(await asUser(() => rpc.flowProposal({ ...base(), proposalId: proposal.id }))).toEqual({definition,stack:null});
    await expect(asUser(() => rpc.flowProposal({ ...base(), proposalId: proposal.id }), 'b')).rejects.toThrow(
      'unavailable'
    );
    expect((await asUser(() => rpc.thread(base()))).team.proposals).toHaveLength(1);
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
