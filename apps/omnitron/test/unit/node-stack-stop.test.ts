import { describe, expect, it, vi } from 'vitest';
import { NodeStackStop } from '../../src/project/node-stack-stop.js';
import { confirmStoppedPlacement, placementProvisionIntent, type RemotePlacement } from '../../src/project/remote-placement.js';
import type { ExistingInfrastructureReview, StackStopProgress } from '../../src/shared/dto/project.js';

const scope = { project: 'sample', stack: 'prod', applications: true };
const runtime = { project: 'sample', stack: 'deployed' };
const id = 'a'.repeat(64);
function fixture() {
  let data: Record<string, unknown> = {};
  const store: any = {
    kvGetSync: (key: string) => structuredClone(data[key] ?? null),
    kvUpdateSync: vi.fn((key: string, update: (current: any) => unknown) => {
      const value = update(structuredClone(data[key] ?? null)); data[key] = structuredClone(value); return value;
    }),
  };
  let stopped = false;
  let containers = [{ id, name: 'sample-prod-redis' }];
  const execution = {
    inspectStackExecution: vi.fn(async () => ({ ...runtime, revision: stopped ? 1 : 0,
      phase: stopped ? 'stopped' : 'running', apps: [{ name: 'sample/deployed/api', generation: 'generation-1' }] })),
    stopStackExecution: vi.fn(async ({ operationId }: { operationId: string }) => {
      stopped = true;
      return { ...runtime, revision: 1, operationId, observedAt: new Date().toISOString(), stopped: ['sample/deployed/api'] };
    }),
  };
  const ports: any = {
    execution, definition: vi.fn(async () => ({ runtime, fingerprint: 'definition-1' })),
    containers: vi.fn(async () => structuredClone(containers)),
    disableResume: vi.fn(), forgetInfrastructureHold: vi.fn(), retireInfrastructure: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn(async (reference: string) => { containers = containers.filter(container => container.id !== reference); }),
  };
  return { service: new NodeStackStop(store, ports), ports, store,
    replaceContainers: (value: typeof containers) => { containers = value; },
    resetStore: () => { data = {}; } };
}

describe('node-confirmed stack stop', () => {
  it('recovers an acknowledged provision on the same placement after a lost reply and receiver restart', async () => {
    const { service, store, ports, replaceContainers } = fixture();
    const logical = { project: scope.project, stack: scope.stack };
    const definition = 'e'.repeat(64);
    ports.definition.mockResolvedValue({ runtime, fingerprint: definition });
    const plan = await service.prepare(scope);
    const stopped = await service.execute(plan);
    const node = { nodeId: 'recipient', host: 'receiver.invalid', port: 9700, pin: 'b'.repeat(64) };
    const stop: StackStopProgress = { id: 'controller-stop', phase: 'stopped', intentCommitted: true, startedAt: stopped.observedAt,
      completedAt: stopped.observedAt, nodes: [{ node: 'receiver.invalid:9700', outcome: 'stopped', nodeId: node.nodeId,
        operationId: plan.operationId, observedAt: stopped.observedAt, execution: stopped.applications!, definition }] };
    const placement: RemotePlacement = { registration: definition, origin: node, from: node, originCommit: null, activated: false,
      sourceStop: stop, selected: { ...node, release: 'one', prepared: definition, manifestSha256: definition },
      receipt: { ...logical, generation: 1, fromNodeId: node.nodeId, toNodeId: node.nodeId, release: 'one',
        digest: 'd'.repeat(64), stopId: stop.id } };
    const intent = placementProvisionIntent(placement)!;
    expect(placementProvisionIntent({ ...placement, from: { ...node, pin: 'c'.repeat(64) } })).toBeUndefined();
    const record = await service.preparePlacementProvision(logical, intent);
    const members = [{ name: 'sample-prod-store', id: '1'.repeat(64) }, { name: 'sample-prod-cache', id: '2'.repeat(64) }];
    replaceContainers(members);
    const review: ExistingInfrastructureReview = { protocol: 1, mode: 'preserve', scope: logical, digest: definition, checks: [],
      containers: members.map(container => ({ ...container, fingerprint: definition })) };
    await expect(record({ ...review, containers: review.containers.slice(1) })).rejects.toThrow(/inventory changed/);
    await record(review);
    const recipient = new NodeStackStop(store, ports);
    replaceContainers([...members].reverse());
    const current = await recipient.inspect(scope);
    expect(() => confirmStoppedPlacement(logical, node, stop, current, intent)).not.toThrow();
    expect(() => confirmStoppedPlacement(logical, node, stop, current)).toThrow(/empty container inventory/);
    expect(() => confirmStoppedPlacement(logical, node, stop, current, { ...intent, placementDigest: definition })).toThrow(/empty container inventory/);
    expect(() => confirmStoppedPlacement(logical, node, stop, current, { ...intent, stopOperationId: 'other' })).toThrow(/empty container inventory/);
    await (await recipient.preparePlacementProvision(logical, intent))(review);
    replaceContainers([{ ...members[0]!, id: '3'.repeat(64) }, members[1]!]);
    expect(() => confirmStoppedPlacement(logical, node, stop, { ...current, containers: [] }, intent)).toThrow(/empty container inventory/);
    const changed = await recipient.inspect(scope);
    expect(() => confirmStoppedPlacement(logical, node, stop, changed, intent)).toThrow(/empty container inventory/);
    await expect(recipient.preparePlacementProvision(logical, intent)).rejects.toThrow(/physical containers/);
    replaceContainers(members);
    ports.execution.inspectStackExecution.mockResolvedValue({ ...runtime, phase: 'stopped', revision: 7, apps: [] });
    const superseded = await recipient.inspect(scope);
    expect(() => confirmStoppedPlacement(logical, node, stop, superseded, intent)).toThrow(/stopped execution generation/);
    await expect(recipient.preparePlacementProvision(logical, intent)).rejects.toThrow(/stopped execution/);
  });
  it('invalidates a pending provision when the receiver prepares a different stop', async () => {
    const { service, replaceContainers } = fixture();
    const logical = { project: scope.project, stack: scope.stack };
    const first = await service.prepare(scope);
    await service.execute(first);
    const intent = { placementDigest: 'a'.repeat(64), stopOperationId: first.operationId };
    const record = await service.preparePlacementProvision(logical, intent);
    const member = { id: '1'.repeat(64), name: 'sample-prod-store', fingerprint: 'f'.repeat(64) };
    replaceContainers([member]);
    const next = await service.prepare(scope);
    expect(next.operationId).not.toBe(first.operationId);
    await expect(record({ protocol: 1, mode: 'preserve', digest: member.fingerprint, containers: [member], checks: [], scope: logical }))
      .rejects.toThrow(/completed stop/);
    await service.execute(next);
    await expect(service.preparePlacementProvision(logical, intent)).rejects.toThrow(/original completed full stop/);
    expect(await service.inspect(scope)).not.toHaveProperty('provisioned');
  });
  it('ends a keep only after a verified full stop of the same allocation, including on a reopened journal', async () => {
    const { service, ports, store } = fixture();
    const heldAt = '1970-01-01T00:00:00.000Z';
    await service.execute(await service.prepare({ ...scope, keepInfrastructure: true }));
    expect(ports.forgetInfrastructureHold).not.toHaveBeenCalled();
    expect(service.retiredInfrastructureAfter(scope, runtime, heldAt)).toBe(false);
    const plan = await service.prepare(scope);
    expect(service.retiredInfrastructureAfter(scope, runtime, heldAt)).toBe(false);
    const stopped = await service.execute(plan);
    expect(ports.forgetInfrastructureHold).toHaveBeenCalledExactlyOnceWith(runtime);
    const replacement = new NodeStackStop(store, ports);
    expect(replacement.retiredInfrastructureAfter(scope, runtime, heldAt)).toBe(true);
    expect(replacement.retiredInfrastructureAfter(scope, runtime, stopped.observedAt)).toBe(false);
    expect(replacement.retiredInfrastructureAfter(scope, { ...runtime, stack: 'other' }, heldAt)).toBe(false);
    expect(replacement.retiredInfrastructureAfter({ ...scope, stack: 'other' }, runtime, heldAt)).toBe(false);
    await replacement.execute(plan);
    expect(ports.forgetInfrastructureHold).toHaveBeenCalledTimes(1);
  });
  it('stops applications and disables resume while retaining infrastructure and a durable receipt', async () => {
    const { service, ports, store } = fixture();
    const plan = await service.prepare({ ...scope, keepInfrastructure: true });
    expect(plan.keepInfrastructure).toBe(true);
    const receipt = await service.execute(plan);
    expect(receipt).toMatchObject({ outcome: 'stopped', keepInfrastructure: true, removedContainers: [], keptContainers: [id] });
    expect(ports.disableResume).toHaveBeenCalledWith(runtime, true);
    expect(ports.execution.stopStackExecution).toHaveBeenCalledOnce();
    expect(ports.retireInfrastructure).not.toHaveBeenCalled();
    expect(ports.removeContainer).not.toHaveBeenCalled();
    expect(await new NodeStackStop(store, ports).execute(plan)).toEqual(receipt);
    expect(ports.execution.stopStackExecution).toHaveBeenCalledOnce();
  });
  it('refuses a changed retention mode before any stop or intent mutation', async () => {
    const { service, ports } = fixture();
    const plan = await service.prepare({ ...scope, keepInfrastructure: true });
    await expect(service.execute({ ...plan, keepInfrastructure: false })).rejects.toThrow('retention mode changed');
    const { keepInfrastructure: _retention, ...withoutRetention } = plan;
    await expect(service.execute(withoutRetention)).rejects.toThrow('retention mode changed');
    expect(ports.disableResume).not.toHaveBeenCalled();
    expect(ports.execution.stopStackExecution).not.toHaveBeenCalled();
  });
  it('does not claim retained infrastructure after a container disappears before the stop', async () => {
    const { service, ports, replaceContainers } = fixture();
    const plan = await service.prepare({ ...scope, keepInfrastructure: true });
    replaceContainers([]);
    await expect(service.execute(plan)).rejects.toThrow('ownership changed');
    expect(ports.execution.stopStackExecution).not.toHaveBeenCalled();
    expect(ports.retireInfrastructure).not.toHaveBeenCalled();
  });
  it('reconciles changed retained infrastructure instead of replaying a completed stop', async () => {
    const { service, ports, replaceContainers } = fixture();
    const plan = await service.prepare({ ...scope, keepInfrastructure: true });
    await service.execute(plan);
    replaceContainers([{ id: 'b'.repeat(64), name: 'replacement' }]);
    await expect(service.execute(plan)).rejects.toThrow('Retained stack infrastructure changed');
    expect(ports.execution.stopStackExecution).toHaveBeenCalledOnce();
    expect(ports.removeContainer).not.toHaveBeenCalled();
  });
  it('observes a node without replacing a challenge or writing its journal', async () => {
    const { service, store } = fixture();
    const plan = await service.prepare(scope);
    store.kvUpdateSync.mockClear();
    expect(await service.inspect(scope)).toMatchObject({ execution: plan.execution, containers: plan.containers });
    expect(store.kvUpdateSync).not.toHaveBeenCalled();
    expect((await service.execute(plan)).outcome).toBe('stopped');
  });
  it('prepares without stopping anything, then acknowledges only observed absence', async () => {
    const { service, ports } = fixture();
    const plan = await service.prepare(scope);
    expect(ports.execution.stopStackExecution).not.toHaveBeenCalled();
    expect(ports.removeContainer).not.toHaveBeenCalled();
    const receipt = await service.execute(plan);
    expect(receipt).toMatchObject({ outcome: 'stopped', operationId: plan.operationId, removedContainers: [id] });
    expect(ports.disableResume).toHaveBeenCalledWith(runtime, undefined);
    expect(ports.removeContainer).toHaveBeenCalledWith(id);
    expect(ports.execution.stopStackExecution.mock.invocationCallOrder[0]).toBeLessThan(ports.retireInfrastructure.mock.invocationCallOrder[0]);
    expect(ports.retireInfrastructure.mock.invocationCallOrder[0]).toBeLessThan(ports.removeContainer.mock.invocationCallOrder[0]);
  });
  it('reconciles a lost acknowledgement after backend replacement without replaying effects', async () => {
    const { service, ports, store } = fixture();
    const plan = await service.prepare(scope);
    const first = await service.execute(plan);
    const replacement = new NodeStackStop(store, ports);
    expect(await replacement.execute(plan)).toEqual(first);
    expect(ports.execution.stopStackExecution).toHaveBeenCalledOnce();
    expect(ports.removeContainer).toHaveBeenCalledOnce();
  });
  it('retains failure and blocks deployment until a retry confirms every container', async () => {
    const { service, ports } = fixture();
    const plan = await service.prepare(scope);
    ports.removeContainer.mockRejectedValueOnce(new Error('Docker unavailable'));
    await expect(service.execute(plan)).rejects.toThrow('Docker unavailable');
    expect(() => service.assertMutable(scope)).toThrow('unconfirmed stop');
    expect((await service.execute(plan)).outcome).toBe('stopped');
    expect(() => service.assertMutable(scope)).not.toThrow();
  });
  it('keeps infrastructure when any application exit is unconfirmed', async () => {
    const { service, ports } = fixture();
    const plan = await service.prepare(scope);
    ports.execution.stopStackExecution.mockRejectedValue(new Error('worker remains alive'));
    await expect(service.execute(plan)).rejects.toThrow('worker remains alive');
    expect(ports.retireInfrastructure).not.toHaveBeenCalled();
    expect(ports.removeContainer).not.toHaveBeenCalled();
  });
  it('retains the deployment suspension while preparing a replacement for a failed stop', async () => {
    const { service, ports } = fixture();
    const old = await service.prepare(scope);
    ports.removeContainer.mockRejectedValueOnce(new Error('Docker unavailable'));
    await expect(service.execute(old)).rejects.toThrow('Docker unavailable');
    const replacement = await service.prepare(scope);
    expect(() => service.assertMutable(scope)).toThrow('unconfirmed stop');
    await expect(service.execute(old)).rejects.toThrow('superseded');
    await service.execute(replacement);
    expect(() => service.assertMutable(scope)).not.toThrow();
  });
  it('refuses an old allocation definition before any effects', async () => {
    const { service, ports } = fixture();
    const plan = await service.prepare(scope);
    ports.definition.mockResolvedValue({ runtime, fingerprint: 'new-definition' });
    await expect(service.execute(plan)).rejects.toThrow('allocation changed');
    expect(ports.disableResume).not.toHaveBeenCalled();
    expect(ports.execution.stopStackExecution).not.toHaveBeenCalled();
  });
  it('does not delete a new container that was not in the accepted plan', async () => {
    const { service, ports, replaceContainers } = fixture();
    const plan = await service.prepare(scope);
    replaceContainers([{ id: 'b'.repeat(64), name: 'sample-prod-redis' }]);
    await expect(service.execute(plan)).rejects.toThrow('ownership changed');
    expect(ports.removeContainer).not.toHaveBeenCalled();
  });
  it('refuses an expired plan and a superseded operation identity', async () => {
    const { service, ports } = fixture();
    const plan = await service.prepare(scope);
    const now = vi.spyOn(Date, 'now').mockReturnValue(plan.expiresAt + 1);
    await expect(service.execute(plan)).rejects.toThrow('expired');
    now.mockRestore();
    await service.prepare(scope);
    await expect(service.execute(plan)).rejects.toThrow('superseded');
    expect(ports.execution.stopStackExecution).not.toHaveBeenCalled();
  });
  it('does not acknowledge a stale receipt after the allocation has been started again', async () => {
    const { service, ports } = fixture();
    const plan = await service.prepare(scope);
    await service.execute(plan);
    ports.execution.inspectStackExecution.mockResolvedValue({ ...runtime, revision: 2, phase: 'running', apps: [] });
    await expect(service.execute(plan)).rejects.toThrow('changed after');
    expect(ports.execution.stopStackExecution).toHaveBeenCalledOnce();
  });
  it('refuses mutation if the durable intent cannot be recorded', async () => {
    const { service, ports, store } = fixture();
    const plan = await service.prepare(scope);
    store.kvUpdateSync.mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    await expect(service.execute(plan)).rejects.toThrow('disk unavailable');
    expect(ports.execution.stopStackExecution).not.toHaveBeenCalled();
    expect(ports.removeContainer).not.toHaveBeenCalled();
  });
  it('cannot prepare an unbound legacy allocation', async () => {
    const { service, ports } = fixture();
    ports.definition.mockRejectedValue(new Error('unverified allocation owner'));
    await expect(service.prepare(scope)).rejects.toThrow('unverified');
    expect(ports.execution.stopStackExecution).not.toHaveBeenCalled();
  });
});
