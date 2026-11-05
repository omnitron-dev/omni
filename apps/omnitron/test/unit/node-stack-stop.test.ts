import { describe, expect, it, vi } from 'vitest';
import { NodeStackStop } from '../../src/project/node-stack-stop.js';

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
    disableResume: vi.fn(), retireInfrastructure: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn(async (reference: string) => { containers = containers.filter(container => container.id !== reference); }),
  };
  return { service: new NodeStackStop(store, ports), ports, store,
    replaceContainers: (value: typeof containers) => { containers = value; },
    resetStore: () => { data = {}; } };
}

describe('node-confirmed stack stop', () => {
  it('stops applications and disables resume while retaining infrastructure and a durable receipt', async () => {
    const { service, ports, store } = fixture();
    const plan = await service.prepare({ ...scope, keepInfrastructure: true });
    expect(plan.keepInfrastructure).toBe(true);
    const receipt = await service.execute(plan);
    expect(receipt).toMatchObject({ outcome: 'stopped', keepInfrastructure: true, removedContainers: [], keptContainers: [id] });
    expect(ports.disableResume).toHaveBeenCalledWith(runtime);
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
    expect(ports.disableResume).toHaveBeenCalledWith(runtime);
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
