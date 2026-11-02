import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ClusterSigner, type StackEffectPlan } from '../../src/cluster/stop-authority.js';
import { resumeDestinations, type ResumeDestination } from '../../src/project/installed-stack-resume.js';
import type { InstalledStackResumeResult } from '../../src/shared/dto/project.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { StackTargets } from '../../src/project/stack-targets.js';
import { installedAllocation } from '../helpers/installed-resume.js';

function fixture() {
  const signer = new ClusterSigner();
  const grant = {
    key: 'omnitron/cluster/west',
    owner: 'leader',
    incarnation: signer.incarnation,
    epoch: '2',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    remainingMs: 60_000,
  };
  const leases = { read: vi.fn(async () => grant) };
  const allocations = ['a', 'b'].map((id) => installedAllocation(leases, id));
  const operationId = randomUUID();
  const targets: ResumeDestination[] = allocations.map(({ request, node }) => {
    request.operationId = operationId;
    return {
      node: request.audience.nodeId,
      request,
      prepare: () => node.prepare(request),
      execute: (plan, permit) => node.execute({ ...request, plan, permit }),
      receipt: async () => node.receipt(request),
    };
  });
  const report: InstalledStackResumeResult = {
    project: 'sample',
    stack: 'prod',
    operationId,
    stopOperationId: randomUUID(),
    outcome: 'unconfirmed',
    nodes: [],
  };
  const persist = vi.fn(),
    authorize = (plan: StackEffectPlan) => signer.issueEffect(plan, grant);
  return {
    allocations,
    targets,
    persist,
    authorize,
    run: () => resumeDestinations(report, targets, authorize, persist),
  };
}

describe('installed allocation recovery', () => {
  it('looks up a lost receipt and never dispatches the launch twice', async () => {
    const { allocations, targets, run } = fixture();
    const first = targets[0]!;
    const send = first.execute;
    first.execute = async (...args) => {
      await send(...args);
      throw new Error('RPC disconnected');
    };
    first.receipt = async () => allocations[0]!.restartBackend().receipt(first.request);
    expect(await run()).toMatchObject({ outcome: 'running', nodes: [{ outcome: 'running' }, { outcome: 'running' }] });
    for (const { owner } of allocations) {
      expect(owner.openInstalledStack).toHaveBeenCalledOnce();
      expect(owner.resumeInstalledApp.mock.calls.map(([arg]) => arg.name)).toEqual([
        'sample/deployed/api',
        'sample/deployed/jobs',
      ]);
    }
  });
  it('validates every target before starting one, including whether the stop removed infrastructure', async () => {
    const { allocations, persist, run } = fixture();
    allocations[1]!.receipt.removedContainers.push('db');
    await expect(run()).rejects.toThrow(/removed infrastructure/);
    expect(persist).not.toHaveBeenCalled();
    expect(allocations[0]!.owner.openInstalledStack).not.toHaveBeenCalled();
  });
  it('refuses a modified installation and a permit for another placement before the owner opens', async () => {
    const { allocations, authorize } = fixture();
    const { node, request, execution, owner } = allocations[0]!;
    const plan = await node.prepare(request),
      permit = authorize(plan);
    await expect(node.execute({ ...request, stack: 'other', plan, permit })).rejects.toThrow(/another operation/);
    execution.apps[0]!.installed.artifactSha256 = 'f'.repeat(64);
    await expect(node.execute({ ...request, plan, permit })).rejects.toThrow(/changed after preparation/);
    expect(owner.openInstalledStack).not.toHaveBeenCalled();
  });
  it('preserves the first receipt and stops at an unknown node without replay', async () => {
    const { allocations, targets, run } = fixture();
    targets[1]!.execute = vi.fn(async () => {
      throw new Error('no route');
    });
    expect(await run()).toMatchObject({
      outcome: 'partial',
      nodes: [{ outcome: 'running' }, { outcome: 'unconfirmed', reason: 'no route' }],
    });
    expect(targets[1]!.execute).toHaveBeenCalledOnce();
    expect(allocations[1]!.owner.openInstalledStack).not.toHaveBeenCalled();
  });
  it('rejects a replaced stopped generation and rejects a receipt from an unrelated stop', async () => {
    const { allocations } = fixture();
    const { request, execution, node } = allocations[0]!;
    await expect(node.prepare({ ...request, stopOperationId: randomUUID() })).rejects.toThrow(/recorded stop/);
    execution.apps[0]!.generation = randomUUID();
    await expect(node.prepare(request)).rejects.toThrow(/exact stopped allocation/);
  });
  it('reports partial progress when one application on the first node was confirmed', async () => {
    const { allocations, run } = fixture();
    allocations[0]!.owner.resumeInstalledApp.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lost lease'));
    expect(await run()).toMatchObject({
      outcome: 'partial',
      nodes: [{ outcome: 'unconfirmed', apps: ['sample/deployed/api'] }, { outcome: 'skipped' }],
    });
  });
  it('rejects ambiguous application identities even if all short names match', async () => {
    const { targets, run } = fixture();
    const target = targets[0]!,
      execute = target.execute;
    target.execute = async (...args) => ({
      ...(await execute(...args)),
      apps: ['sample/deployed/api', 'unrelated/test/jobs'],
    });
    expect(await run()).toMatchObject({
      outcome: 'unconfirmed',
      nodes: [{ outcome: 'unconfirmed' }, { outcome: 'skipped' }],
    });
  });
  it('runs the operator RPC through pinned placements and protects the next reviewed stop', async () => {
    const { allocations, authorize } = fixture();
    const recipient = allocations[0]!;
    const { audience, stopOperationId, stopObservedAt } = recipient.request;
    const stop = {
      id: randomUUID(),
      phase: 'stopped',
      intentCommitted: true,
      nodes: [
        {
          node: 'edge.test:9700',
          outcome: 'stopped',
          observedAt: stopObservedAt,
          operationId: stopOperationId,
          authority: audience,
        },
      ],
    };
    const data = new Map<string, unknown>([['stack:sample/prod:last-stop', stop]]);
    const daemonStateStore = {
      kvGetSync: <T>(key: string) => structuredClone(data.get(key) ?? null) as T | null,
      kvUpdateSync: <T>(key: string, change: (previous: T | null) => T) => {
        const result = change(structuredClone(data.get(key) ?? null) as T | null);
        data.set(key, structuredClone(result));
        return result;
      },
    };
    const connector = vi.fn(async (_host, _port, _service, method, [request], options) => {
      if (method === 'prepareNodeInstalledResume') return recipient.node.prepare(request);
      if (method === 'executeNodeInstalledResume') {
        expect(options).toMatchObject({ retryOnDisconnect: false });
        return recipient.node.execute(request);
      }
      throw new Error('Unexpected RPC method: ' + method);
    });
    const service = Object.assign(Object.create(ProjectService.prototype), {
      resolveProjectStack: (scope: unknown) => scope,
      daemonStateStore,
      stackStates: new Map(),
      clusterStop: { election: { isLeader: true, authorizeEffect: authorize }, recipient: { audience } },
      installedResume: { busy: false },
      startsInFlight: new Map(),
      stopsInFlight: new Map(),
      nodeStackStop: { busy: false },
      loadProjectConfig: async () => ({
        apps: [{ name: 'api' }, { name: 'jobs' }],
        stacks: {
          prod: { type: 'cluster', nodes: [{ host: 'edge.test', nodeId: audience.nodeId }] },
        },
      }),
      resolveStacks: (config: { stacks: object }) => config.stacks,
      slaveConnector: { invokeOnSlave: connector },
    });
    const rpc = new ProjectRpcService(service);
    const scope = { project: 'sample', stack: 'prod' };
    const result = await rpc.resumeInstalledStack(scope);
    expect(result).toMatchObject({ outcome: 'running', stopOperationId: stop.id, nodes: [{ outcome: 'running' }] });
    expect(data.get('stack:sample/prod:last-resume')).toEqual(result);
    expect(data.get('stack:sample/prod:last-stop')).toHaveProperty('supersededAt');
    expect(new StackTargets(daemonStateStore).inspect(scope).nodes).toMatchObject([
      { host: 'edge.test', nodeId: audience.nodeId },
    ]);
    await expect(rpc.resumeInstalledStack(scope)).rejects.toThrow(/signed stop/);
    expect(connector).toHaveBeenCalledTimes(2);
  });
  it('retains an incomplete attempt through a backend restart and requires a new stop to dispatch again', async () => {
    const { allocations, authorize } = fixture();
    const { request, node, owner, restartBackend } = allocations[0]!;
    owner.resumeInstalledApp.mockRejectedValueOnce(new Error('owner disconnected'));
    const plan = await node.prepare(request);
    const result = await node.execute({ ...request, plan, permit: authorize(plan) });
    expect(result.outcome).toBe('unconfirmed');
    const next = restartBackend();
    expect(await next.execute({ ...request, plan, permit: authorize(plan) })).toEqual(result);
    const retry = { ...request, operationId: randomUUID() };
    const second = await next.prepare(retry);
    await expect(next.execute({ ...retry, plan: second, permit: authorize(second) })).rejects.toThrow(
      /already has a resume attempt/
    );
    expect(owner.resumeInstalledApp).toHaveBeenCalledOnce();
  });
});
